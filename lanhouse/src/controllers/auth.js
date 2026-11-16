'use strict';

/*
 * Cadastro, login, logout e consulta do usuário logado.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { ErroHttp } = require('../utils/erros');
const { validarUsuario, validarEmail } = require('../utils/validacao');
const { destinoDoPerfil } = require('../middleware/auth');

const RODADAS_BCRYPT = Math.min(14, Math.max(8, Number(process.env.BCRYPT_ROUNDS) || 10));

// Hash de uma senha qualquer, usado para gastar o mesmo tempo quando o e-mail não existe.
// Assim ninguém consegue descobrir quais e-mails estão cadastrados medindo o tempo de resposta.
const HASH_FALSO = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', RODADAS_BCRYPT);

/* ---------- Limite de tentativas de login (em memória, por IP + e-mail) ---------- */
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS = 5;
const falhas = new Map(); // chave -> { quantidade, expiraEm }

function chaveTentativa(req, email) {
  return `${req.ip}|${email}`;
}

function bloqueado(chave) {
  const registro = falhas.get(chave);
  if (!registro) return false;
  if (registro.expiraEm < Date.now()) {
    falhas.delete(chave);
    return false;
  }
  return registro.quantidade >= MAX_FALHAS;
}

function registrarFalha(chave) {
  const agora = Date.now();
  const atual = falhas.get(chave);
  if (!atual || atual.expiraEm < agora) {
    falhas.set(chave, { quantidade: 1, expiraEm: agora + JANELA_MS });
  } else {
    atual.quantidade += 1;
  }
}

// Limpeza periódica para o Map não crescer indefinidamente
setInterval(() => {
  const agora = Date.now();
  for (const [chave, registro] of falhas) if (registro.expiraEm < agora) falhas.delete(chave);
}, 5 * 60 * 1000).unref();

/* ---------------------------------- Handlers ---------------------------------- */

async function cadastrar(req, res) {
  // O perfil NÃO vem do corpo da requisição: todo cadastro público é "cliente".
  const dados = validarUsuario(req.body, { senhaObrigatoria: true });

  const [existente] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', [dados.email]);
  if (existente.length) {
    throw new ErroHttp(409, 'Este e-mail já está cadastrado.', {
      campos: { email: 'Este e-mail já está cadastrado. Entre ou use outro e-mail.' },
    });
  }

  const senhaHash = await bcrypt.hash(dados.senha, RODADAS_BCRYPT);

  try {
    await pool.execute(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, 'cliente')",
      [dados.nome, dados.email, senhaHash]
    );
  } catch (erro) {
    // Duas pessoas cadastrando o mesmo e-mail ao mesmo tempo: o índice UNIQUE do banco decide
    if (erro.code === 'ER_DUP_ENTRY') {
      throw new ErroHttp(409, 'Este e-mail já está cadastrado.', {
        campos: { email: 'Este e-mail já está cadastrado. Entre ou use outro e-mail.' },
      });
    }
    throw erro;
  }

  res.status(201).json({ mensagem: 'Conta criada com sucesso. Entre para agendar.' });
}

async function entrar(req, res) {
  const corpo = req.body || {};
  const email = validarEmail(corpo.email);
  const senha = typeof corpo.senha === 'string' ? corpo.senha : '';

  if (email.erro || !senha) {
    throw new ErroHttp(400, 'Informe e-mail e senha.');
  }

  const chave = chaveTentativa(req, email.valor);
  if (bloqueado(chave)) {
    throw new ErroHttp(429, 'Muitas tentativas de login. Aguarde alguns minutos e tente de novo.');
  }

  const [linhas] = await pool.execute(
    'SELECT id, nome, email, senha_hash, perfil, ativo FROM usuarios WHERE email = ?',
    [email.valor]
  );
  const usuario = linhas[0];

  const senhaConfere = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FALSO);
  if (!usuario || !senhaConfere) {
    registrarFalha(chave);
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  if (usuario.ativo !== 1) {
    throw new ErroHttp(403, 'Sua conta está desativada. Procure a recepção da lan house.');
  }

  falhas.delete(chave);
  // Atribuir um objeto novo descarta qualquer dado antigo da sessão
  req.session = { uid: usuario.id };

  res.json({
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    destino: destinoDoPerfil(usuario.perfil),
  });
}

function sair(req, res) {
  req.session = null;
  res.json({ ok: true });
}

function eu(req, res) {
  const { id, nome, email, perfil } = req.usuario;
  res.json({ usuario: { id, nome, email, perfil }, destino: destinoDoPerfil(perfil) });
}

module.exports = { cadastrar, entrar, sair, eu, RODADAS_BCRYPT };
