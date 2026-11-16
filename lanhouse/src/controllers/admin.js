'use strict';

/*
 * Painel administrativo: visão geral, clientes, computadores e agendamentos.
 * Todas as rotas deste arquivo exigem perfil "admin" (middleware apiExigirAdmin, verificado no backend).
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const regras = require('../config/regras');
const { ErroHttp } = require('../utils/erros');
const { agoraNoFuso, ehData, somarDias } = require('../utils/tempo');
const {
  STATUS_COMPUTADOR,
  STATUS_RESERVA,
  validarUsuario,
  validarComputador,
  idDaRota,
  escaparLike,
  limparTexto,
} = require('../utils/validacao');
const { RODADAS_BCRYPT } = require('./auth');
const { concluirVencidas, serializar, cancelarReserva } = require('./reservas');

/* ===================================================================================== */
/*  VISÃO GERAL                                                                          */
/* ===================================================================================== */
async function resumo(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  const [[contagens]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM usuarios WHERE perfil = 'cliente') AS clientes,
       (SELECT COUNT(*) FROM computadores) AS computadores,
       (SELECT COUNT(*) FROM computadores WHERE status = 'disponivel') AS computadores_disponiveis,
       (SELECT COUNT(*) FROM agendamentos) AS agendamentos,
       (SELECT COUNT(*) FROM agendamentos WHERE status <> 'cancelado' AND inicio >= ? AND inicio <= ?) AS agendamentos_hoje,
       (SELECT COUNT(*) FROM agendamentos WHERE status = 'confirmado') AS confirmados`,
    [`${ag.data} 00:00:00`, `${ag.data} 23:59:59`]
  );

  const [agendaHoje] = await pool.execute(
    `SELECT a.id, a.usuario_id, a.computador_id, a.inicio, a.fim, a.duracao_min, a.status,
            a.cancelado_por, a.criado_em,
            c.nome AS computador_nome, c.descricao AS computador_descricao,
            u.nome AS cliente_nome, u.email AS cliente_email
       FROM agendamentos a
       JOIN computadores c ON c.id = a.computador_id
       JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.inicio >= ? AND a.inicio <= ? AND a.status <> 'cancelado'
      ORDER BY a.inicio, c.nome`,
    [`${ag.data} 00:00:00`, `${ag.data} 23:59:59`]
  );

  const [computadores] = await pool.execute('SELECT id, nome, status FROM computadores ORDER BY nome');
  const [emUso] = await pool.execute(
    "SELECT DISTINCT computador_id FROM agendamentos WHERE status = 'confirmado' AND inicio <= ? AND fim > ?",
    [ag.dt, ag.dt]
  );
  const idsEmUso = new Set(emUso.map((l) => l.computador_id));

  res.json({
    agora: { data: ag.data, hora: ag.hora.slice(0, 5) },
    contagens,
    agenda_hoje: agendaHoje.map((l) => serializar(l, ag, { comCliente: true })),
    salao: computadores.map((c) => ({
      id: c.id,
      nome: c.nome,
      estado: c.status !== 'disponivel' ? c.status : idsEmUso.has(c.id) ? 'em_uso' : 'livre',
    })),
  });
}

/* ===================================================================================== */
/*  CLIENTES                                                                             */
/* ===================================================================================== */
function serializarCliente(l) {
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    ativo: l.ativo === 1,
    criado_em: l.criado_em,
    total_reservas: l.total_reservas ?? 0,
    reservas_futuras: l.reservas_futuras ?? 0,
  };
}

const SELECT_CLIENTE = `
  SELECT u.id, u.nome, u.email, u.ativo, u.criado_em,
         (SELECT COUNT(*) FROM agendamentos a WHERE a.usuario_id = u.id) AS total_reservas,
         (SELECT COUNT(*) FROM agendamentos a
           WHERE a.usuario_id = u.id AND a.status = 'confirmado' AND a.fim > ?) AS reservas_futuras
    FROM usuarios u`;

async function buscarCliente(id, ag) {
  const [linhas] = await pool.execute(`${SELECT_CLIENTE} WHERE u.id = ? AND u.perfil = 'cliente'`, [ag.dt, id]);
  return linhas[0] ? serializarCliente(linhas[0]) : null;
}

async function listarClientes(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  const busca = limparTexto(req.query.busca).slice(0, 100);
  const params = [ag.dt];
  let filtro = '';
  if (busca) {
    const like = `%${escaparLike(busca)}%`;
    filtro = 'AND (u.nome LIKE ? OR u.email LIKE ?)';
    params.push(like, like);
  }

  // Somente perfil "cliente": administradores nunca aparecem (nem podem ser alterados) por esta tela
  const [linhas] = await pool.execute(
    `${SELECT_CLIENTE} WHERE u.perfil = 'cliente' ${filtro} ORDER BY u.nome LIMIT 500`,
    params
  );
  res.json({ clientes: linhas.map(serializarCliente) });
}

async function obterCliente(req, res) {
  const id = idDaRota(req.params.id);
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  const cliente = await buscarCliente(id, ag);
  if (!cliente) throw new ErroHttp(404, 'Cliente não encontrado.');

  const [reservas] = await pool.execute(
    `SELECT a.id, a.usuario_id, a.computador_id, a.inicio, a.fim, a.duracao_min, a.status,
            a.cancelado_por, a.criado_em,
            c.nome AS computador_nome, c.descricao AS computador_descricao
       FROM agendamentos a JOIN computadores c ON c.id = a.computador_id
      WHERE a.usuario_id = ? ORDER BY a.inicio DESC LIMIT 50`,
    [id]
  );

  res.json({ cliente, reservas: reservas.map((l) => serializar(l, ag)) });
}

async function criarCliente(req, res) {
  const dados = validarUsuario(req.body, { senhaObrigatoria: true });
  const ag = agoraNoFuso(regras.fuso);
  const senhaHash = await bcrypt.hash(dados.senha, RODADAS_BCRYPT);

  let id;
  try {
    const [r] = await pool.execute(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, 'cliente', 1)",
      [dados.nome, dados.email, senhaHash]
    );
    id = r.insertId;
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      throw new ErroHttp(409, 'Este e-mail já está cadastrado.', { campos: { email: 'Este e-mail já está cadastrado.' } });
    }
    throw erro;
  }
  res.status(201).json({ cliente: await buscarCliente(id, ag) });
}

async function atualizarCliente(req, res) {
  const id = idDaRota(req.params.id);
  const dados = validarUsuario(req.body, { senhaObrigatoria: false });
  const ativo = req.body && req.body.ativo === false ? 0 : 1;
  const ag = agoraNoFuso(regras.fuso);
  const senhaHash = dados.senha ? await bcrypt.hash(dados.senha, RODADAS_BCRYPT) : null;

  const conexao = await pool.getConnection();
  let canceladas = 0;
  try {
    await conexao.beginTransaction();

    const [atual] = await conexao.execute(
      "SELECT id, ativo FROM usuarios WHERE id = ? AND perfil = 'cliente' FOR UPDATE",
      [id]
    );
    if (!atual.length) throw new ErroHttp(404, 'Cliente não encontrado.');

    try {
      if (senhaHash) {
        await conexao.execute('UPDATE usuarios SET nome = ?, email = ?, ativo = ?, senha_hash = ? WHERE id = ?', [
          dados.nome,
          dados.email,
          ativo,
          senhaHash,
          id,
        ]);
      } else {
        await conexao.execute('UPDATE usuarios SET nome = ?, email = ?, ativo = ? WHERE id = ?', [
          dados.nome,
          dados.email,
          ativo,
          id,
        ]);
      }
    } catch (erro) {
      if (erro.code === 'ER_DUP_ENTRY') {
        throw new ErroHttp(409, 'Este e-mail já está cadastrado.', { campos: { email: 'Este e-mail já está cadastrado.' } });
      }
      throw erro;
    }

    // Ao desativar um cliente, as reservas futuras dele são canceladas (evita máquina reservada para quem não pode entrar)
    if (atual[0].ativo === 1 && ativo === 0) {
      const [r] = await conexao.execute(
        `UPDATE agendamentos SET status = 'cancelado', cancelado_por = 'admin', cancelado_em = ?
          WHERE usuario_id = ? AND status = 'confirmado' AND fim > ?`,
        [ag.dt, id, ag.dt]
      );
      canceladas = r.affectedRows;
    }

    await conexao.commit();
  } catch (erro) {
    try {
      await conexao.rollback();
    } catch {
      // ignorado
    }
    throw erro;
  } finally {
    conexao.release();
  }

  res.json({ cliente: await buscarCliente(id, ag), reservas_canceladas: canceladas });
}

async function excluirCliente(req, res) {
  const id = idDaRota(req.params.id);

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const [clientes] = await conexao.execute(
      "SELECT id FROM usuarios WHERE id = ? AND perfil = 'cliente' FOR UPDATE",
      [id]
    );
    if (!clientes.length) throw new ErroHttp(404, 'Cliente não encontrado.');

    // Regra de integridade: quem tem reservas (de qualquer status) não é excluído, para preservar o histórico.
    // Nesse caso o administrador deve DESATIVAR o cadastro.
    const [reservas] = await conexao.execute('SELECT COUNT(*) AS n FROM agendamentos WHERE usuario_id = ?', [id]);
    if (reservas[0].n > 0) {
      throw new ErroHttp(
        409,
        `Este cliente tem ${reservas[0].n} reserva(s) no histórico e não pode ser excluído. Desative o cadastro para preservar o histórico.`,
        { codigo: 'TEM_RESERVAS' }
      );
    }

    await conexao.execute("DELETE FROM usuarios WHERE id = ? AND perfil = 'cliente'", [id]);
    await conexao.commit();
  } catch (erro) {
    try {
      await conexao.rollback();
    } catch {
      // ignorado
    }
    throw erro;
  } finally {
    conexao.release();
  }

  res.json({ mensagem: 'Cliente excluído.' });
}

/* ===================================================================================== */
/*  COMPUTADORES                                                                         */
/* ===================================================================================== */
const SELECT_COMPUTADOR = `
  SELECT c.id, c.nome, c.descricao, c.status, c.criado_em,
         (SELECT COUNT(*) FROM agendamentos a
           WHERE a.computador_id = c.id AND a.status = 'confirmado' AND a.fim > ?) AS reservas_futuras
    FROM computadores c`;

async function buscarComputador(id, ag) {
  const [linhas] = await pool.execute(`${SELECT_COMPUTADOR} WHERE c.id = ?`, [ag.dt, id]);
  return linhas[0] || null;
}

async function listarComputadores(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);
  const [linhas] = await pool.execute(`${SELECT_COMPUTADOR} ORDER BY c.nome`, [ag.dt]);
  res.json({ computadores: linhas });
}

async function criarComputador(req, res) {
  const dados = validarComputador(req.body, { statusObrigatorio: false });
  const status = dados.status || 'disponivel';
  const ag = agoraNoFuso(regras.fuso);

  let id;
  try {
    const [r] = await pool.execute('INSERT INTO computadores (nome, descricao, status) VALUES (?, ?, ?)', [
      dados.nome,
      dados.descricao,
      status,
    ]);
    id = r.insertId;
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      throw new ErroHttp(409, 'Já existe um computador com esse nome.', { campos: { nome: 'Já existe um computador com esse nome.' } });
    }
    throw erro;
  }
  res.status(201).json({ computador: await buscarComputador(id, ag) });
}

async function atualizarComputador(req, res) {
  const id = idDaRota(req.params.id);
  const dados = validarComputador(req.body, { statusObrigatorio: true });
  const ag = agoraNoFuso(regras.fuso);

  try {
    const [r] = await pool.execute('UPDATE computadores SET nome = ?, descricao = ?, status = ? WHERE id = ?', [
      dados.nome,
      dados.descricao,
      dados.status,
      id,
    ]);
    if (r.affectedRows === 0) throw new ErroHttp(404, 'Computador não encontrado.');
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      throw new ErroHttp(409, 'Já existe um computador com esse nome.', { campos: { nome: 'Já existe um computador com esse nome.' } });
    }
    throw erro;
  }
  res.json({ computador: await buscarComputador(id, ag) });
}

async function alterarStatusComputador(req, res) {
  const id = idDaRota(req.params.id);
  const status = req.body && req.body.status;
  if (!STATUS_COMPUTADOR.includes(status)) throw new ErroHttp(400, 'Escolha um status válido.');
  const ag = agoraNoFuso(regras.fuso);

  const [r] = await pool.execute('UPDATE computadores SET status = ? WHERE id = ?', [status, id]);
  if (r.affectedRows === 0) throw new ErroHttp(404, 'Computador não encontrado.');

  // Reservas futuras NÃO são canceladas automaticamente: o administrador decide caso a caso
  res.json({ computador: await buscarComputador(id, ag) });
}

/* ===================================================================================== */
/*  AGENDAMENTOS                                                                         */
/* ===================================================================================== */
async function listarAgendamentos(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  const { data, status } = req.query;
  const busca = limparTexto(req.query.busca).slice(0, 100);

  const condicoes = [];
  const params = [];

  if (data !== undefined && data !== '') {
    if (!ehData(data)) throw new ErroHttp(400, 'Data inválida.');
    condicoes.push('a.inicio >= ? AND a.inicio < ?');
    params.push(`${data} 00:00:00`, `${somarDias(data, 1)} 00:00:00`);
  }
  if (busca) {
    const like = `%${escaparLike(busca)}%`;
    condicoes.push('(u.nome LIKE ? OR u.email LIKE ?)');
    params.push(like, like);
  }
  if (status !== undefined && status !== '') {
    if (!STATUS_RESERVA.includes(status)) throw new ErroHttp(400, 'Status inválido.');
    condicoes.push('a.status = ?');
    params.push(status);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const [linhas] = await pool.execute(
    `SELECT a.id, a.usuario_id, a.computador_id, a.inicio, a.fim, a.duracao_min, a.status,
            a.cancelado_por, a.criado_em,
            c.nome AS computador_nome, c.descricao AS computador_descricao,
            u.nome AS cliente_nome, u.email AS cliente_email
       FROM agendamentos a
       JOIN usuarios u ON u.id = a.usuario_id
       JOIN computadores c ON c.id = a.computador_id
       ${where}
      ORDER BY a.inicio DESC, a.id DESC
      LIMIT 500`,
    params
  );

  res.json({
    agora: { data: ag.data, hora: ag.hora.slice(0, 5) },
    agendamentos: linhas.map((l) => serializar(l, ag, { comCliente: true })),
  });
}

async function cancelarAgendamento(req, res) {
  const id = idDaRota(req.params.id);
  await cancelarReserva(id, { porAdmin: true });
  res.json({ mensagem: 'Reserva cancelada.' });
}

module.exports = {
  resumo,
  listarClientes,
  obterCliente,
  criarCliente,
  atualizarCliente,
  excluirCliente,
  listarComputadores,
  criarComputador,
  atualizarComputador,
  alterarStatusComputador,
  listarAgendamentos,
  cancelarAgendamento,
};
