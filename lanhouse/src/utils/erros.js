'use strict';

/*
 * Tratamento de erros da API.
 * Regra de segurança: o cliente do navegador nunca recebe detalhes internos (SQL, caminhos, stack).
 * O detalhe técnico vai apenas para o log do servidor (console), que o NSSM grava em arquivo.
 */

/** Erro "esperado", com status HTTP e mensagem segura para mostrar ao usuário. */
class ErroHttp extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}

/** Express 4 não captura erros de funções async sozinho; este "embrulho" resolve isso. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Códigos que indicam que o MySQL (VM 2) está inacessível ou mal configurado
const CODIGOS_BANCO_INDISPONIVEL = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'ER_NO_SUCH_TABLE',
]);

function tratadorDeErros(err, req, res, _next) {
  const ehApi = req.originalUrl.startsWith('/api');

  let status = 500;
  let corpo = { erro: 'Erro interno do servidor. Tente novamente em instantes.' };

  if (err instanceof ErroHttp) {
    status = err.status;
    corpo = { erro: err.message, ...err.extra };
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    corpo = { erro: 'Os dados enviados não são válidos.' };
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    corpo = { erro: 'Os dados enviados são grandes demais.' };
  } else if (err && CODIGOS_BANCO_INDISPONIVEL.has(err.code)) {
    status = 503;
    corpo = { erro: 'O sistema está temporariamente indisponível. Tente novamente em instantes.' };
    console.error(`[banco] ${req.method} ${req.originalUrl} -> ${err.code}: ${err.message}`);
  } else if (err && err.code === 'ER_DUP_ENTRY') {
    status = 409;
    corpo = { erro: 'Já existe um registro com esses dados.' };
  } else {
    console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
  }

  if (res.headersSent) return;
  if (ehApi) return res.status(status).json(corpo);
  return res.status(status).type('text/plain; charset=utf-8').send(corpo.erro);
}

module.exports = { ErroHttp, asyncHandler, tratadorDeErros };
