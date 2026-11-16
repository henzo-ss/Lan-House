'use strict';

/* Rotas do painel administrativo. Prefixo: /api/admin. TODAS exigem perfil "admin" (checado no banco). */
const express = require('express');
const { asyncHandler } = require('../utils/erros');
const { apiExigirAdmin } = require('../middleware/auth');
const { semCache } = require('../middleware/seguranca');
const admin = require('../controllers/admin');

const router = express.Router();

router.use(semCache, apiExigirAdmin);

router.get('/resumo', asyncHandler(admin.resumo));

router.get('/clientes', asyncHandler(admin.listarClientes));
router.post('/clientes', asyncHandler(admin.criarCliente));
router.get('/clientes/:id', asyncHandler(admin.obterCliente));
router.put('/clientes/:id', asyncHandler(admin.atualizarCliente));
router.delete('/clientes/:id', asyncHandler(admin.excluirCliente));

router.get('/computadores', asyncHandler(admin.listarComputadores));
router.post('/computadores', asyncHandler(admin.criarComputador));
router.put('/computadores/:id', asyncHandler(admin.atualizarComputador));
router.patch('/computadores/:id/status', asyncHandler(admin.alterarStatusComputador));

router.get('/agendamentos', asyncHandler(admin.listarAgendamentos));
router.post('/agendamentos/:id/cancelar', asyncHandler(admin.cancelarAgendamento));

module.exports = router;
