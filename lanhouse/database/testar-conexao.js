'use strict';

/*
 * Testa a ligação entre a VM 1 (aplicação) e a VM 2 (MySQL) usando o MESMO .env da aplicação.
 *
 * Uso:   npm run testar-conexao
 *
 * Mostra para onde está tentando conectar (sem exibir a senha), a versão do MySQL,
 * se o banco existe e quantos registros há em cada tabela.
 */
require('../src/config/env');
const { pool } = require('../src/config/db');

const DICAS = {
  ECONNREFUSED: 'A conexão foi recusada. O serviço MySQL está parado na VM 2, ou a porta está errada, ou o MySQL só escuta em 127.0.0.1 (confira bind-address).',
  ETIMEDOUT: 'Tempo esgotado. Provável bloqueio de firewall na VM 2 (porta 3306) ou as VMs não estão na mesma rede.',
  EHOSTUNREACH: 'Endereço inalcançável. Confira o DB_HOST e a rede entre as VMs.',
  ENETUNREACH: 'Rede inalcançável. Confira o DB_HOST e a rede entre as VMs.',
  ENOTFOUND: 'O endereço do DB_HOST não foi encontrado. Use o IP da VM 2.',
  ER_ACCESS_DENIED_ERROR: 'Usuário ou senha incorretos, ou o usuário não tem permissão para conectar a partir do IP da VM 1.',
  ER_BAD_DB_ERROR: 'O banco informado em DB_NAME não existe. Execute o database/script.sql.',
};

async function principal() {
  const host = process.env.DB_HOST;
  const porta = process.env.DB_PORT || 3306;
  console.log(`Tentando conectar em ${host}:${porta} como "${process.env.DB_USER}" (banco "${process.env.DB_NAME}")...`);

  const [[versao]] = await pool.execute('SELECT VERSION() AS v, DATABASE() AS banco');
  console.log(`Conexão OK. MySQL ${versao.v}, banco em uso: ${versao.banco}`);

  for (const tabela of ['usuarios', 'computadores', 'agendamentos']) {
    try {
      const [[linha]] = await pool.execute(`SELECT COUNT(*) AS n FROM ${tabela}`);
      console.log(`  tabela ${tabela}: ${linha.n} registro(s)`);
    } catch (erro) {
      if (erro.code === 'ER_NO_SUCH_TABLE') console.log(`  tabela ${tabela}: NÃO EXISTE (execute o database/script.sql)`);
      else throw erro;
    }
  }
}

principal()
  .catch((erro) => {
    console.error(`\nFalha na conexão: ${erro.code || 'erro'}`);
    console.error(DICAS[erro.code] || erro.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
