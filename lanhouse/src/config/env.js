'use strict';

/*
 * Carrega o arquivo .env da RAIZ do projeto, não importa de qual pasta o Node foi iniciado.
 * Isso é importante quando a aplicação roda como serviço do Windows (NSSM), porque o
 * serviço não usa a pasta do projeto como diretório atual por padrão.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

/** Retorna a lista de variáveis obrigatórias que estão ausentes ou vazias. */
function variaveisFaltando(nomes) {
  return nomes.filter((nome) => {
    const valor = process.env[nome];
    return valor === undefined || String(valor).trim() === '';
  });
}

module.exports = { variaveisFaltando };
