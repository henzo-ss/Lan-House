'use strict';

/*
 * Controle de acesso.
 * A sessão guarda apenas o id do usuário (em cookie assinado). A cada requisição protegida,
 * o usuário é lido de novo no MySQL: se ele foi desativado, excluído ou mudou de perfil,
 * o acesso muda imediatamente. As permissões são verificadas AQUI, no backend.
 */
const { pool } = require('../config/db');

async function buscarUsuarioDaSessao(req) {
  req.usuario = null;
  const uid = req.session && req.session.uid;
  if (!uid) return null;

  const [linhas] = await pool.execute(
    'SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = ?',
    [uid]
  );
  const usuario = linhas[0];
  if (!usuario || usuario.ativo !== 1) {
    req.session = null; // sessão de usuário que não existe mais ou foi desativado
    return null;
  }
  req.usuario = usuario;
  return usuario;
}

function destinoDoPerfil(perfil) {
  return perfil === 'admin' ? '/admin' : '/agendar';
}

/* ----------------------------- API (respostas JSON) ----------------------------- */

async function apiExigirLogin(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
    return next();
  } catch (erro) {
    return next(erro);
  }
}

async function apiExigirCliente(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
    if (usuario.perfil !== 'cliente') return res.status(403).json({ erro: 'Acesso restrito a clientes.' });
    return next();
  } catch (erro) {
    return next(erro);
  }
}

async function apiExigirAdmin(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
    if (usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito à administração.' });
    return next();
  } catch (erro) {
    return next(erro);
  }
}

/* ----------------------------- Páginas HTML (redirecionamentos) ----------------------------- */

async function paginaExigirCliente(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (!usuario) return res.redirect('/login');
    if (usuario.perfil !== 'cliente') return res.redirect(destinoDoPerfil(usuario.perfil));
    return next();
  } catch (erro) {
    return next(erro);
  }
}

async function paginaExigirAdmin(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (!usuario) return res.redirect('/login');
    if (usuario.perfil !== 'admin') return res.redirect(destinoDoPerfil(usuario.perfil));
    return next();
  } catch (erro) {
    return next(erro);
  }
}

/** Login e cadastro: quem já entrou vai direto para a própria área. Se o banco falhar, mostra a página. */
async function paginaApenasVisitante(req, res, next) {
  try {
    const usuario = await buscarUsuarioDaSessao(req);
    if (usuario) return res.redirect(destinoDoPerfil(usuario.perfil));
  } catch {
    // banco indisponível: deixa a página abrir (o login mostrará o erro ao tentar entrar)
  }
  return next();
}

module.exports = {
  destinoDoPerfil,
  apiExigirLogin,
  apiExigirCliente,
  apiExigirAdmin,
  paginaExigirCliente,
  paginaExigirAdmin,
  paginaApenasVisitante,
};
