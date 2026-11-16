'use strict';

/*
 * Regras de negócio da lan house.
 * Os valores vêm de variáveis de ambiente (veja .env.example) e têm padrões sensatos.
 */
require('./env');
const { paraMinutos, agoraNoFuso } = require('../utils/tempo');

function inteiro(nome, padrao, minimo, maximo) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < minimo || n > maximo) {
    throw new Error(`Variável ${nome} inválida: use um número inteiro entre ${minimo} e ${maximo}.`);
  }
  return n;
}

function horario(nome, padrao) {
  const texto = process.env[nome] || padrao;
  const minutos = paraMinutos(texto);
  if (Number.isNaN(minutos)) {
    throw new Error(`Variável ${nome} inválida: use o formato HH:MM (ex.: 10:00).`);
  }
  return minutos;
}

const regras = {
  // Fuso usado para decidir o que é "hoje" e "agora"
  fuso: process.env.FUSO_HORARIO || 'America/Sao_Paulo',
  // Horário de funcionamento, em minutos desde 00:00
  abreMin: horario('LH_ABERTURA', '10:00'),
  fechaMin: horario('LH_FECHAMENTO', '23:00'),
  // Os horários de início são de 30 em 30 minutos
  passoMin: 30,
  // Durações que o cliente pode escolher, em minutos
  duracoes: [60, 90, 120, 180, 240],
  // Até quantos dias à frente se pode reservar
  diasAntecedencia: inteiro('DIAS_ANTECEDENCIA', 14, 1, 60),
  // Cancelamento pelo cliente: antecedência mínima em minutos
  cancelamentoMin: inteiro('CANCELAMENTO_ANTECEDENCIA_MIN', 60, 0, 1440),
  // Limite de reservas confirmadas futuras por cliente
  maxReservasAtivas: inteiro('MAX_RESERVAS_ATIVAS', 5, 1, 50),
};

// Validações cruzadas feitas na inicialização, para falhar cedo e com mensagem clara
try {
  agoraNoFuso(regras.fuso);
} catch {
  throw new Error(`FUSO_HORARIO inválido: "${regras.fuso}". Exemplo: America/Sao_Paulo.`);
}
if (regras.fechaMin - regras.abreMin < regras.duracoes[0]) {
  throw new Error('LH_FECHAMENTO deve ser pelo menos 1 hora depois de LH_ABERTURA.');
}
if (regras.abreMin % regras.passoMin !== 0 || regras.fechaMin % regras.passoMin !== 0) {
  throw new Error('LH_ABERTURA e LH_FECHAMENTO devem estar em horas cheias ou meias horas (ex.: 10:00, 22:30).');
}

module.exports = regras;
