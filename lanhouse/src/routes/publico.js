'use strict';

/* Rotas sem exigência de login (e a autenticação). Prefixo: /api */
const express = require('express');
const { asyncHandler } = require('../utils/erros');
const { testarConexao } = require('../config/db');
const { apiExigirLogin } = require('../middleware/auth');
const auth = require('../controllers/auth');
const reservas = require('../controllers/reservas');

const router = express.Router();

// Verificação de saúde: útil para testar a ligação entre as duas VMs pelo navegador
router.get('/saude', async (req, res) => {
  try {
    await testarConexao();
    res.json({ aplicacao: 'ok', banco: 'ok' });
  } catch (erro) {
    console.error(`[saude] banco indisponível: ${erro.code || erro.message}`);
    res.status(503).json({ aplicacao: 'ok', banco: 'indisponivel' });
  }
});

router.get('/publico/resumo', asyncHandler(reservas.resumoPublico));

router.post('/auth/cadastro', asyncHandler(auth.cadastrar));
router.post('/auth/login', asyncHandler(auth.entrar));
router.post('/auth/logout', auth.sair);
router.get('/auth/eu', apiExigirLogin, auth.eu);

module.exports = router;
