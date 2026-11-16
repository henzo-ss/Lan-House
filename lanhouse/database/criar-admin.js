'use strict';

/*
 * Cria o administrador inicial (ou redefine a senha dele, se o e-mail já existir).
 *
 * Uso (na VM 1, dentro da pasta do projeto, com o .env já configurado):
 *     npm run criar-admin
 *
 * O script pergunta nome, e-mail e senha (a senha não aparece enquanto você digita).
 * A senha é guardada apenas como hash bcrypt: ela nunca é escrita em arquivo.
 *
 * Também funciona sem perguntas, definindo as variáveis ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA
 * no próprio terminal antes de executar (veja o README).
 * Rodar de novo com o mesmo e-mail redefine a senha desse administrador.
 */
require('../src/config/env');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const { validarNome, validarEmail, validarSenha } = require('../src/utils/validacao');

function perguntar(rl, texto, oculto = false) {
  return new Promise((resolver) => {
    if (!oculto) {
      rl.question(texto, resolver);
      return;
    }
    // Esconde o que é digitado (senha)
    const escritaOriginal = rl._writeToOutput;
    process.stdout.write(texto);
    rl._writeToOutput = () => {};
    rl.question('', (resposta) => {
      rl._writeToOutput = escritaOriginal;
      process.stdout.write('\n');
      resolver(resposta);
    });
  });
}

async function obterDados() {
  const { ADMIN_NOME, ADMIN_EMAIL, ADMIN_SENHA } = process.env;
  if (ADMIN_NOME && ADMIN_EMAIL && ADMIN_SENHA) {
    return { nome: ADMIN_NOME, email: ADMIN_EMAIL, senha: ADMIN_SENHA };
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const nome = await perguntar(rl, 'Nome do administrador: ');
    const email = await perguntar(rl, 'E-mail do administrador: ');
    const senha = await perguntar(rl, 'Senha (mínimo 8 caracteres, com letras e números): ', true);
    const confirmacao = await perguntar(rl, 'Repita a senha: ', true);
    if (senha !== confirmacao) throw new Error('As senhas não conferem.');
    return { nome, email, senha };
  } finally {
    rl.close();
  }
}

async function principal() {
  const bruto = await obterDados();

  const nome = validarNome(bruto.nome);
  const email = validarEmail(bruto.email);
  const senha = validarSenha(bruto.senha);
  const erro = nome.erro || email.erro || senha.erro;
  if (erro) throw new Error(erro);

  const rodadas = Math.min(14, Math.max(8, Number(process.env.BCRYPT_ROUNDS) || 10));
  const hash = await bcrypt.hash(senha.valor, rodadas);

  const [resultado] = await pool.execute(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
     VALUES (?, ?, ?, 'admin', 1)
     ON DUPLICATE KEY UPDATE nome = VALUES(nome), senha_hash = VALUES(senha_hash), perfil = 'admin', ativo = 1`,
    [nome.valor, email.valor, hash]
  );

  // affectedRows: 1 = criado, 2 = atualizado (comportamento do MySQL em ON DUPLICATE KEY UPDATE)
  console.log(resultado.affectedRows === 1 ? `\nAdministrador criado: ${email.valor}` : `\nAdministrador atualizado (senha redefinida): ${email.valor}`);
  console.log('Acesse /login e entre com esse e-mail e senha.');
}

principal()
  .catch((erro) => {
    if (erro.code === 'ER_NO_SUCH_TABLE') {
      console.error('\nAs tabelas ainda não existem. Execute primeiro o database/script.sql no MySQL.');
    } else if (erro.code) {
      console.error(`\nNão foi possível falar com o MySQL (${erro.code}). Rode "npm run testar-conexao" para diagnosticar.`);
    } else {
      console.error(`\nErro: ${erro.message}`);
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
