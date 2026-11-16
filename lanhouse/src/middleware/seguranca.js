'use strict';

/*
 * Cabeçalhos de segurança e proteção básica contra CSRF.
 */

/** Cabeçalhos HTTP de segurança em todas as respostas. */
function cabecalhosDeSeguranca(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Só permite scripts do próprio site. As fontes vêm do Google Fonts (folha de estilo e arquivos de fonte).
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
}

/*
 * Proteção contra CSRF: toda requisição que altera dados (POST, PUT, PATCH, DELETE) precisa
 * do cabeçalho "X-Requested-With: fetch". Um site de terceiros não consegue enviar esse
 * cabeçalho personalizado sem passar pelo bloqueio de CORS do navegador.
 * O cookie de sessão também usa SameSite=Lax, o que reforça essa proteção.
 */
function exigirRequisicaoDoSite(req, res, next) {
  const metodosSeguros = ['GET', 'HEAD', 'OPTIONS'];
  if (metodosSeguros.includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ erro: 'Requisição não permitida.' });
  }
  return next();
}

/** Evita que respostas autenticadas fiquem em cache do navegador. */
function semCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

module.exports = { cabecalhosDeSeguranca, exigirRequisicaoDoSite, semCache };
