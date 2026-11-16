'use strict';

/*
 * Funções de data e hora.
 *
 * Decisão de projeto: o sistema trabalha com "horário de parede" da lan house, sem fuso no banco.
 * As datas ficam em colunas DATETIME no formato 'AAAA-MM-DD HH:MM:SS' e o driver devolve texto
 * (dateStrings: true), então nada é convertido por fuso horário em lugar nenhum.
 * "Agora" é calculado no fuso configurado em FUSO_HORARIO, e não no fuso da VM.
 */

/** Retorna data/hora atuais no fuso informado. O segundo parâmetro existe para facilitar testes. */
function agoraNoFuso(fuso, instante = new Date()) {
  const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partes = {};
  for (const parte of formatador.formatToParts(instante)) partes[parte.type] = parte.value;

  const hora = Number(partes.hour) % 24;
  const hh = String(hora).padStart(2, '0');
  const data = `${partes.year}-${partes.month}-${partes.day}`;
  const horaTexto = `${hh}:${partes.minute}:${partes.second}`;

  return {
    data, // 'AAAA-MM-DD'
    hora: horaTexto, // 'HH:MM:SS'
    dt: `${data} ${horaTexto}`, // 'AAAA-MM-DD HH:MM:SS'
    minutos: hora * 60 + Number(partes.minute), // minutos desde 00:00
  };
}

/** Confere se o texto é uma data real no formato AAAA-MM-DD (rejeita 2026-02-31, por exemplo). */
function ehData(texto) {
  if (typeof texto !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Soma (ou subtrai) dias de uma data 'AAAA-MM-DD'. */
function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** 'HH:MM' -> minutos desde 00:00. Retorna NaN se o texto for inválido. */
function paraMinutos(texto) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(texto));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** minutos desde 00:00 -> 'HH:MM'. */
function deMinutos(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** ('2026-11-08', 840) -> '2026-11-08 14:00:00' */
function montarDt(data, minutos) {
  return `${data} ${deMinutos(minutos)}:00`;
}

function dtParaMs(dt) {
  return Date.parse(`${dt.replace(' ', 'T')}Z`);
}

/** Diferença em minutos entre dois 'AAAA-MM-DD HH:MM:SS' (a - b). */
function diferencaMin(a, b) {
  return Math.round((dtParaMs(a) - dtParaMs(b)) / 60000);
}

/** 60 -> '1 hora', 90 -> '1 h 30', 120 -> '2 horas', 45 -> '45 minutos' */
function descreverDuracao(minutos) {
  if (minutos < 60) return `${minutos} minutos`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (m) return `${h} h ${String(m).padStart(2, '0')}`;
  return h === 1 ? '1 hora' : `${h} horas`;
}

module.exports = {
  agoraNoFuso,
  ehData,
  somarDias,
  paraMinutos,
  deMinutos,
  montarDt,
  diferencaMin,
  descreverDuracao,
};
