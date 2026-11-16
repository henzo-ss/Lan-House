'use strict';

/*
 * Validação de dados no backend. O frontend também valida (para dar resposta rápida),
 * mas nunca se confia nele: tudo é revalidado aqui.
 */
const { ErroHttp } = require('./erros');

const RE_NOME = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const STATUS_COMPUTADOR = ['disponivel', 'manutencao', 'desativado'];
const STATUS_RESERVA = ['confirmado', 'cancelado', 'concluido'];

function limparTexto(valor) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

function validarNome(valor) {
  const nome = limparTexto(valor);
  if (nome.length < 3) return { erro: 'Informe o nome completo (mínimo de 3 letras).' };
  if (nome.length > 120) return { erro: 'O nome pode ter no máximo 120 caracteres.' };
  if (!RE_NOME.test(nome)) return { erro: 'Use apenas letras, espaços, apóstrofo, ponto e hífen no nome.' };
  return { valor: nome };
}

function validarEmail(valor) {
  const email = String(valor ?? '').trim().toLowerCase();
  if (!email) return { erro: 'Informe o e-mail.' };
  if (email.length > 190) return { erro: 'O e-mail pode ter no máximo 190 caracteres.' };
  if (!RE_EMAIL.test(email) || email.includes('..')) return { erro: 'Informe um e-mail válido, como nome@exemplo.com.' };
  return { valor: email };
}

function validarSenha(valor) {
  if (typeof valor !== 'string' || valor.length === 0) return { erro: 'Informe a senha.' };
  if (valor.length < 8) return { erro: 'A senha precisa ter pelo menos 8 caracteres.' };
  // O bcrypt só considera os 72 primeiros bytes da senha
  if (Buffer.byteLength(valor, 'utf8') > 72) return { erro: 'A senha pode ter no máximo 72 caracteres.' };
  if (!/[A-Za-zÀ-ÿ]/.test(valor) || !/\d/.test(valor)) return { erro: 'Use letras e números na senha.' };
  return { valor };
}

/**
 * Valida os dados de um cliente.
 * @param {object} corpo        req.body
 * @param {boolean} senhaObrigatoria  false na edição (senha em branco = manter a atual)
 * @returns {{nome, email, senha}} dados limpos. Lança ErroHttp 400 com "campos" se houver erro.
 */
function validarUsuario(corpo, { senhaObrigatoria = true } = {}) {
  const dados = corpo || {};
  const campos = {};
  const saida = {};

  const nome = validarNome(dados.nome);
  if (nome.erro) campos.nome = nome.erro;
  else saida.nome = nome.valor;

  const email = validarEmail(dados.email);
  if (email.erro) campos.email = email.erro;
  else saida.email = email.valor;

  const temSenha = typeof dados.senha === 'string' && dados.senha.length > 0;
  if (senhaObrigatoria || temSenha) {
    const senha = validarSenha(dados.senha);
    if (senha.erro) campos.senha = senha.erro;
    else saida.senha = senha.valor;
  }

  if (Object.keys(campos).length) {
    throw new ErroHttp(400, 'Confira os campos destacados e tente novamente.', { campos });
  }
  return saida;
}

function validarComputador(corpo, { statusObrigatorio = true } = {}) {
  const dados = corpo || {};
  const campos = {};
  const saida = {};

  const nome = limparTexto(dados.nome);
  if (nome.length < 1 || nome.length > 40) campos.nome = 'Informe um nome de 1 a 40 caracteres, como PC-11.';
  else saida.nome = nome;

  const descricao = limparTexto(dados.descricao);
  if (descricao.length > 255) campos.descricao = 'A descrição pode ter no máximo 255 caracteres.';
  else saida.descricao = descricao;

  if (statusObrigatorio || dados.status !== undefined) {
    if (!STATUS_COMPUTADOR.includes(dados.status)) campos.status = 'Escolha um status válido.';
    else saida.status = dados.status;
  }

  if (Object.keys(campos).length) {
    throw new ErroHttp(400, 'Confira os campos destacados e tente novamente.', { campos });
  }
  return saida;
}

/** Converte :id da URL em inteiro positivo ou lança 400. */
function idDaRota(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErroHttp(400, 'Identificador inválido.');
  return id;
}

/** Escapa %, _ e \ para usar o texto digitado dentro de um LIKE com segurança. */
function escaparLike(texto) {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

module.exports = {
  STATUS_COMPUTADOR,
  STATUS_RESERVA,
  limparTexto,
  validarNome,
  validarEmail,
  validarSenha,
  validarUsuario,
  validarComputador,
  idDaRota,
  escaparLike,
};
