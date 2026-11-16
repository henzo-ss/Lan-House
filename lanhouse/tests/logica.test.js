'use strict';

/*
 * Testes das regras que não dependem do banco (datas, horários e validação de dados).
 * Executar:  npm test
 *
 * Importante: estes testes NÃO cobrem o MySQL nem o HTTP. Eles verificam a lógica pura.
 * O teste de agendamentos simultâneos precisa do banco real (veja a seção de testes do README).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const tempo = require('../src/utils/tempo');
const v = require('../src/utils/validacao');
const { ErroHttp } = require('../src/utils/erros');

test('agoraNoFuso converte o instante para o fuso da lan house', () => {
  // 2026-11-08 02:30 UTC = 2026-11-07 23:30 em São Paulo (UTC-3)
  const ag = tempo.agoraNoFuso('America/Sao_Paulo', new Date('2026-11-08T02:30:15Z'));
  assert.equal(ag.data, '2026-11-07');
  assert.equal(ag.hora, '23:30:15');
  assert.equal(ag.dt, '2026-11-07 23:30:15');
  assert.equal(ag.minutos, 23 * 60 + 30);
});

test('agoraNoFuso não devolve hora 24 à meia-noite', () => {
  const ag = tempo.agoraNoFuso('America/Sao_Paulo', new Date('2026-11-08T03:05:00Z'));
  assert.equal(ag.data, '2026-11-08');
  assert.equal(ag.hora.slice(0, 5), '00:05');
  assert.equal(ag.minutos, 5);
});

test('ehData aceita datas reais e rejeita inválidas', () => {
  assert.equal(tempo.ehData('2026-11-08'), true);
  assert.equal(tempo.ehData('2028-02-29'), true);
  assert.equal(tempo.ehData('2026-02-29'), false);
  assert.equal(tempo.ehData('2026-13-01'), false);
  assert.equal(tempo.ehData('08/11/2026'), false);
  assert.equal(tempo.ehData(undefined), false);
  assert.equal(tempo.ehData('2026-11-08; DROP TABLE usuarios'), false);
});

test('somarDias atravessa mês e ano', () => {
  assert.equal(tempo.somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(tempo.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(tempo.somarDias('2026-03-01', -1), '2026-02-28');
});

test('paraMinutos / deMinutos / montarDt', () => {
  assert.equal(tempo.paraMinutos('10:00'), 600);
  assert.equal(tempo.paraMinutos('23:30'), 1410);
  assert.ok(Number.isNaN(tempo.paraMinutos('24:00')));
  assert.ok(Number.isNaN(tempo.paraMinutos('9:00')));
  assert.ok(Number.isNaN(tempo.paraMinutos('10:60')));
  assert.equal(tempo.deMinutos(600), '10:00');
  assert.equal(tempo.deMinutos(1410), '23:30');
  assert.equal(tempo.montarDt('2026-11-08', 840), '2026-11-08 14:00:00');
});

test('diferencaMin calcula a antecedência para cancelamento', () => {
  assert.equal(tempo.diferencaMin('2026-11-08 15:00:00', '2026-11-08 14:00:00'), 60);
  assert.equal(tempo.diferencaMin('2026-11-09 00:30:00', '2026-11-08 23:00:00'), 90);
  assert.equal(tempo.diferencaMin('2026-11-08 13:59:00', '2026-11-08 14:00:00'), -1);
});

test('descreverDuracao', () => {
  assert.equal(tempo.descreverDuracao(30), '30 minutos');
  assert.equal(tempo.descreverDuracao(60), '1 hora');
  assert.equal(tempo.descreverDuracao(90), '1 h 30');
  assert.equal(tempo.descreverDuracao(180), '3 horas');
});

test('regra de conflito: períodos se sobrepõem somente quando inicio < fim_outro e fim > inicio_outro', () => {
  const conflita = (a, b) => a.inicio < b.fim && a.fim > b.inicio;
  const base = { inicio: '2026-11-08 14:00:00', fim: '2026-11-08 16:00:00' };
  assert.equal(conflita(base, { inicio: '2026-11-08 15:00:00', fim: '2026-11-08 17:00:00' }), true);
  assert.equal(conflita(base, { inicio: '2026-11-08 13:00:00', fim: '2026-11-08 14:30:00' }), true);
  assert.equal(conflita(base, { inicio: '2026-11-08 14:30:00', fim: '2026-11-08 15:00:00' }), true);
  // reservas coladas (uma termina quando a outra começa) NÃO conflitam
  assert.equal(conflita(base, { inicio: '2026-11-08 16:00:00', fim: '2026-11-08 17:00:00' }), false);
  assert.equal(conflita(base, { inicio: '2026-11-08 13:00:00', fim: '2026-11-08 14:00:00' }), false);
});

test('validarUsuario normaliza e valida os dados do cadastro', () => {
  const ok = v.validarUsuario({ nome: '  Maria   da Silva ', email: ' Maria@Exemplo.COM ', senha: 'abc12345' });
  assert.equal(ok.nome, 'Maria da Silva');
  assert.equal(ok.email, 'maria@exemplo.com');
  assert.equal(ok.senha, 'abc12345');
});

test('validarUsuario informa o campo com problema', () => {
  assert.throws(
    () => v.validarUsuario({ nome: 'A', email: 'sem-arroba', senha: '123' }),
    (erro) => {
      assert.ok(erro instanceof ErroHttp);
      assert.equal(erro.status, 400);
      assert.ok(erro.extra.campos.nome);
      assert.ok(erro.extra.campos.email);
      assert.ok(erro.extra.campos.senha);
      return true;
    }
  );
});

test('validarUsuario: senha opcional na edição, mas validada se enviada', () => {
  const semSenha = v.validarUsuario({ nome: 'João Pedro', email: 'joao@exemplo.com' }, { senhaObrigatoria: false });
  assert.equal(semSenha.senha, undefined);
  assert.throws(() => v.validarUsuario({ nome: 'João Pedro', email: 'joao@exemplo.com', senha: 'curta1' }, { senhaObrigatoria: false }));
});

test('validarSenha exige letras, números e limita a 72 bytes', () => {
  assert.ok(v.validarSenha('somenteletras').erro);
  assert.ok(v.validarSenha('12345678').erro);
  assert.ok(v.validarSenha('a1'.repeat(40)).erro);
  assert.equal(v.validarSenha('senha1234').valor, 'senha1234');
});

test('validarNome aceita acentos e rejeita números e símbolos', () => {
  assert.equal(v.validarNome('José D’Ávila-Souza Jr.').valor, 'José D’Ávila-Souza Jr.');
  assert.ok(v.validarNome('Robô 2000').erro);
  assert.ok(v.validarNome("<script>alert(1)</script>").erro);
});

test('validarComputador', () => {
  const ok = v.validarComputador({ nome: ' PC-11 ', descricao: 'Teste', status: 'manutencao' });
  assert.deepEqual(ok, { nome: 'PC-11', descricao: 'Teste', status: 'manutencao' });
  assert.throws(() => v.validarComputador({ nome: '', status: 'disponivel' }));
  assert.throws(() => v.validarComputador({ nome: 'PC-12', status: 'quebrado' }));
});

test('idDaRota e escaparLike', () => {
  assert.equal(v.idDaRota('15'), 15);
  assert.throws(() => v.idDaRota('abc'));
  assert.throws(() => v.idDaRota('-1'));
  assert.throws(() => v.idDaRota('1; DROP TABLE x'));
  assert.equal(v.escaparLike('100%_a\\b'), '100\\%\\_a\\\\b');
});

test('regras carregam com os valores padrão', () => {
  const regras = require('../src/config/regras');
  assert.equal(regras.abreMin, 600);
  assert.equal(regras.fechaMin, 1380);
  assert.deepEqual(regras.duracoes, [60, 90, 120, 180, 240]);
  assert.equal(regras.cancelamentoMin, 60);
});
