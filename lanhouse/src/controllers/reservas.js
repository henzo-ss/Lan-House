'use strict';

/*
 * Reservas: disponibilidade, criação, listagem e cancelamento.
 *
 * COMO O SISTEMA IMPEDE RESERVAS CONFLITANTES (inclusive requisições simultâneas):
 *   Cada reserva é criada dentro de uma TRANSAÇÃO que primeiro trava a linha do computador
 *   (SELECT ... FOR UPDATE). Se duas pessoas tentam reservar a mesma máquina no mesmo instante,
 *   a segunda espera a primeira terminar e só então confere os conflitos, já enxergando a
 *   reserva da primeira. Dois períodos conflitam quando: inicio_existente < fim_novo E fim_existente > inicio_novo.
 */
const { pool } = require('../config/db');
const regras = require('../config/regras');
const { ErroHttp } = require('../utils/erros');
const {
  agoraNoFuso,
  ehData,
  somarDias,
  paraMinutos,
  deMinutos,
  montarDt,
  diferencaMin,
  descreverDuracao,
} = require('../utils/tempo');
const { idDaRota } = require('../utils/validacao');

/** Regras que o frontend precisa conhecer (horário de funcionamento, durações, etc.). */
function regrasPublicas() {
  return {
    abre: deMinutos(regras.abreMin),
    fecha: deMinutos(regras.fechaMin),
    passo_min: regras.passoMin,
    duracoes: regras.duracoes,
    dias_antecedencia: regras.diasAntecedencia,
    cancelamento_min: regras.cancelamentoMin,
    max_reservas_ativas: regras.maxReservasAtivas,
  };
}

/** Marca como "concluido" as reservas confirmadas cujo horário já terminou. */
async function concluirVencidas(ag = agoraNoFuso(regras.fuso)) {
  await pool.execute(
    "UPDATE agendamentos SET status = 'concluido' WHERE status = 'confirmado' AND fim <= ?",
    [ag.dt]
  );
}

/** Converte uma linha do banco no formato enviado ao navegador. */
function serializar(linha, ag, { comCliente = false } = {}) {
  const confirmado = linha.status === 'confirmado';
  const saida = {
    id: linha.id,
    computador: {
      id: linha.computador_id,
      nome: linha.computador_nome,
      descricao: linha.computador_descricao,
    },
    data: linha.inicio.slice(0, 10),
    hora_inicio: linha.inicio.slice(11, 16),
    hora_fim: linha.fim.slice(11, 16),
    duracao_min: linha.duracao_min,
    status: linha.status,
    em_andamento: confirmado && linha.inicio <= ag.dt && linha.fim > ag.dt,
    pode_cancelar: confirmado && diferencaMin(linha.inicio, ag.dt) >= regras.cancelamentoMin,
    cancelado_por: linha.cancelado_por || null,
    criado_em: linha.criado_em,
  };
  if (comCliente) {
    saida.cliente = { id: linha.usuario_id, nome: linha.cliente_nome, email: linha.cliente_email };
  }
  return saida;
}

const SELECT_RESERVA = `
  SELECT a.id, a.usuario_id, a.computador_id, a.inicio, a.fim, a.duracao_min, a.status,
         a.cancelado_por, a.criado_em,
         c.nome AS computador_nome, c.descricao AS computador_descricao
    FROM agendamentos a
    JOIN computadores c ON c.id = a.computador_id`;

/* ------------------------------------------------------------------------------------ */
/*  Público: resumo para a página inicial (somente números, nenhum dado pessoal)         */
/* ------------------------------------------------------------------------------------ */
async function resumoPublico(req, res) {
  const ag = agoraNoFuso(regras.fuso);

  const [[totais]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM computadores WHERE status <> 'desativado'"
  );
  const [[livres]] = await pool.execute(
    `SELECT COUNT(*) AS livres
       FROM computadores c
      WHERE c.status = 'disponivel'
        AND NOT EXISTS (
          SELECT 1 FROM agendamentos a
           WHERE a.computador_id = c.id AND a.status = 'confirmado'
             AND a.inicio <= ? AND a.fim > ?
        )`,
    [ag.dt, ag.dt]
  );

  const aberto = ag.minutos >= regras.abreMin && ag.minutos < regras.fechaMin;

  res.json({
    total: totais.total,
    livres_agora: aberto ? livres.livres : 0,
    aberto,
    agora: { data: ag.data, hora: ag.hora.slice(0, 5), minutos: ag.minutos },
    regras: regrasPublicas(),
  });
}

/* ------------------------------------------------------------------------------------ */
/*  Cliente: disponibilidade de um dia                                                   */
/* ------------------------------------------------------------------------------------ */
async function disponibilidade(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  const data = req.query.data === undefined ? ag.data : req.query.data;

  if (!ehData(data)) throw new ErroHttp(400, 'Escolha uma data válida.');
  if (data < ag.data) throw new ErroHttp(400, 'Não é possível consultar datas passadas.');
  if (data > somarDias(ag.data, regras.diasAntecedencia)) {
    throw new ErroHttp(400, `Só é possível agendar até ${regras.diasAntecedencia} dias à frente.`);
  }

  await concluirVencidas(ag);

  const [computadores] = await pool.execute(
    "SELECT id, nome, descricao, status FROM computadores WHERE status <> 'desativado' ORDER BY nome"
  );
  const [reservas] = await pool.execute(
    `SELECT computador_id, usuario_id, inicio, fim
       FROM agendamentos
      WHERE status = 'confirmado' AND inicio >= ? AND inicio <= ?
      ORDER BY inicio`,
    [`${data} 00:00:00`, `${data} 23:59:59`]
  );

  // Apenas horários: o cliente nunca vê quem reservou. "minha" destaca as reservas do próprio usuário.
  const porComputador = new Map();
  for (const r of reservas) {
    if (!porComputador.has(r.computador_id)) porComputador.set(r.computador_id, []);
    porComputador.get(r.computador_id).push({
      inicio: r.inicio.slice(11, 16),
      fim: r.fim.slice(11, 16),
      minha: r.usuario_id === req.usuario.id,
    });
  }

  res.json({
    data,
    agora: { data: ag.data, hora: ag.hora.slice(0, 5), minutos: ag.minutos },
    regras: regrasPublicas(),
    computadores: computadores.map((c) => ({
      id: c.id,
      nome: c.nome,
      descricao: c.descricao,
      status: c.status,
      ocupados: porComputador.get(c.id) || [],
    })),
  });
}

/* ------------------------------------------------------------------------------------ */
/*  Cliente: criar reserva                                                               */
/* ------------------------------------------------------------------------------------ */
async function criar(req, res) {
  const corpo = req.body || {};
  const computadorId = Number(corpo.computador_id);
  const duracao = Number(corpo.duracao_min);
  const data = corpo.data;
  const inicioMin = paraMinutos(corpo.hora_inicio);

  if (!Number.isInteger(computadorId) || computadorId <= 0) throw new ErroHttp(400, 'Escolha um computador.');
  if (!ehData(data)) throw new ErroHttp(400, 'Escolha uma data válida.');
  if (Number.isNaN(inicioMin) || inicioMin % regras.passoMin !== 0) throw new ErroHttp(400, 'Escolha um horário válido.');
  if (!regras.duracoes.includes(duracao)) throw new ErroHttp(400, 'Escolha uma duração válida.');

  const fimMin = inicioMin + duracao;
  const ag = agoraNoFuso(regras.fuso);

  if (data < ag.data) throw new ErroHttp(400, 'Não é possível agendar em datas passadas.');
  if (data > somarDias(ag.data, regras.diasAntecedencia)) {
    throw new ErroHttp(400, `Só é possível agendar até ${regras.diasAntecedencia} dias à frente.`);
  }
  if (inicioMin < regras.abreMin || fimMin > regras.fechaMin) {
    throw new ErroHttp(
      400,
      `Esse horário fica fora do funcionamento (${deMinutos(regras.abreMin)} às ${deMinutos(regras.fechaMin)}).`
    );
  }
  if (data === ag.data && inicioMin <= ag.minutos) {
    throw new ErroHttp(400, 'Esse horário já passou. Escolha um horário futuro.');
  }

  const inicio = montarDt(data, inicioMin);
  const fim = montarDt(data, fimMin);

  const conexao = await pool.getConnection();
  let novoId;
  try {
    await conexao.beginTransaction();

    // 1) Trava o cliente: garante que o limite de reservas ativas seja respeitado mesmo com cliques simultâneos
    await conexao.execute('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [req.usuario.id]);

    // 2) Trava o computador: serializa as reservas da mesma máquina
    const [computadores] = await conexao.execute(
      'SELECT id, status FROM computadores WHERE id = ? FOR UPDATE',
      [computadorId]
    );
    if (!computadores.length) throw new ErroHttp(404, 'Computador não encontrado.');
    if (computadores[0].status !== 'disponivel') {
      throw new ErroHttp(409, 'Este computador não está disponível para reservas.');
    }

    // 3) Limite de reservas ativas por cliente
    const [ativas] = await conexao.execute(
      "SELECT COUNT(*) AS n FROM agendamentos WHERE usuario_id = ? AND status = 'confirmado' AND fim > ?",
      [req.usuario.id, ag.dt]
    );
    if (ativas[0].n >= regras.maxReservasAtivas) {
      throw new ErroHttp(
        409,
        `Você já tem ${regras.maxReservasAtivas} reservas ativas. Cancele ou aguarde uma terminar para reservar de novo.`
      );
    }

    // 4) Conflito de horário na mesma máquina
    const [conflitos] = await conexao.execute(
      `SELECT id FROM agendamentos
        WHERE computador_id = ? AND status = 'confirmado' AND inicio < ? AND fim > ?
        FOR UPDATE`,
      [computadorId, fim, inicio]
    );
    if (conflitos.length) {
      throw new ErroHttp(
        409,
        'Esse computador acabou de ser reservado nesse horário. Escolha outro horário ou outra máquina.',
        { codigo: 'CONFLITO' }
      );
    }

    const [insercao] = await conexao.execute(
      `INSERT INTO agendamentos (usuario_id, computador_id, inicio, fim, duracao_min, status)
       VALUES (?, ?, ?, ?, ?, 'confirmado')`,
      [req.usuario.id, computadorId, inicio, fim, duracao]
    );
    novoId = insercao.insertId;

    await conexao.commit();
  } catch (erro) {
    try {
      await conexao.rollback();
    } catch {
      // a conexão pode ter caído; nada a desfazer
    }
    throw erro;
  } finally {
    conexao.release();
  }

  const [linhas] = await pool.execute(`${SELECT_RESERVA} WHERE a.id = ?`, [novoId]);
  res.status(201).json({ reserva: serializar(linhas[0], ag) });
}

/* ------------------------------------------------------------------------------------ */
/*  Cliente: listar e detalhar as próprias reservas                                      */
/* ------------------------------------------------------------------------------------ */
async function listarMinhas(req, res) {
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  const [linhas] = await pool.execute(
    `${SELECT_RESERVA} WHERE a.usuario_id = ? ORDER BY a.inicio DESC LIMIT 200`,
    [req.usuario.id]
  );

  res.json({
    agora: { data: ag.data, hora: ag.hora.slice(0, 5) },
    regras: regrasPublicas(),
    reservas: linhas.map((l) => serializar(l, ag)),
  });
}

async function detalharMinha(req, res) {
  const id = idDaRota(req.params.id);
  const ag = agoraNoFuso(regras.fuso);
  await concluirVencidas(ag);

  // O filtro por usuario_id impede que um cliente veja a reserva de outro (responde 404, não 403)
  const [linhas] = await pool.execute(
    `${SELECT_RESERVA} WHERE a.id = ? AND a.usuario_id = ?`,
    [id, req.usuario.id]
  );
  if (!linhas.length) throw new ErroHttp(404, 'Reserva não encontrada.');

  res.json({ reserva: serializar(linhas[0], ag), regras: regrasPublicas() });
}

/* ------------------------------------------------------------------------------------ */
/*  Cancelamento (usado pelo cliente e pelo administrador)                               */
/* ------------------------------------------------------------------------------------ */
async function cancelarReserva(id, { usuarioId = null, porAdmin = false }) {
  const ag = agoraNoFuso(regras.fuso);
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const [linhas] = usuarioId
      ? await conexao.execute(
          'SELECT id, status, inicio, fim FROM agendamentos WHERE id = ? AND usuario_id = ? FOR UPDATE',
          [id, usuarioId]
        )
      : await conexao.execute('SELECT id, status, inicio, fim FROM agendamentos WHERE id = ? FOR UPDATE', [id]);

    if (!linhas.length) throw new ErroHttp(404, 'Reserva não encontrada.');
    const reserva = linhas[0];

    if (reserva.status !== 'confirmado') {
      throw new ErroHttp(409, `Esta reserva já está ${reserva.status === 'cancelado' ? 'cancelada' : 'concluída'}.`);
    }

    if (porAdmin) {
      if (reserva.fim <= ag.dt) throw new ErroHttp(409, 'Esta reserva já terminou e não pode ser cancelada.');
    } else if (diferencaMin(reserva.inicio, ag.dt) < regras.cancelamentoMin) {
      throw new ErroHttp(
        409,
        `O cancelamento só é permitido até ${descreverDuracao(regras.cancelamentoMin)} antes do início da reserva.`
      );
    }

    await conexao.execute(
      "UPDATE agendamentos SET status = 'cancelado', cancelado_por = ?, cancelado_em = ? WHERE id = ?",
      [porAdmin ? 'admin' : 'cliente', ag.dt, id]
    );
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
}

async function cancelarMinha(req, res) {
  const id = idDaRota(req.params.id);
  await cancelarReserva(id, { usuarioId: req.usuario.id, porAdmin: false });
  res.json({ mensagem: 'Reserva cancelada.' });
}

module.exports = {
  regrasPublicas,
  concluirVencidas,
  serializar,
  SELECT_RESERVA,
  resumoPublico,
  disponibilidade,
  criar,
  listarMinhas,
  detalharMinha,
  cancelarReserva,
  cancelarMinha,
};
