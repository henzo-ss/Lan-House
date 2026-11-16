'use strict';

/* Rotas da área do cliente (perfil "cliente"). Prefixo: /api */
const express = require('express');
const { asyncHandler } = require('../utils/erros');
const { apiExigirCliente } = require('../middleware/auth');
const { semCache } = require('../middleware/seguranca');
const reservas = require('../controllers/reservas');

const router = express.Router();

router.get('/disponibilidade', semCache, apiExigirCliente, asyncHandler(reservas.disponibilidade));

router.get('/reservas', semCache, apiExigirCliente, asyncHandler(reservas.listarMinhas));
router.post('/reservas', apiExigirCliente, asyncHandler(reservas.criar));
router.get('/reservas/:id', semCache, apiExigirCliente, asyncHandler(reservas.detalharMinha));
router.post('/reservas/:id/cancelar', apiExigirCliente, asyncHandler(reservas.cancelarMinha));

module.exports = router;
