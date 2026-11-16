'use strict';

/*
 * Conexão com o MySQL (VM 2).
 * Nenhuma credencial fica no código: tudo vem do arquivo .env (veja .env.example).
 *
 * Todas as consultas do projeto usam pool.execute()/conn.execute(), que são
 * "prepared statements": os valores viajam separados do SQL, o que elimina SQL Injection.
 */
require('./env');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  // DATE/DATETIME chegam como texto ('2026-11-08 14:00:00'): sem conversões de fuso horário
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  queueLimit: 0,
  connectTimeout: 10000,
  // Mantém conexões vivas entre as VMs (evita queda por inatividade em firewalls/redes virtuais)
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

/** Testa se o banco responde. Usado na inicialização e em /api/saude. */
async function testarConexao() {
  const [linhas] = await pool.execute('SELECT 1 AS ok');
  return linhas[0].ok === 1;
}

module.exports = { pool, testarConexao };
