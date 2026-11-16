'use strict';

/*
 * TESTE DE AGENDAMENTOS SIMULTÂNEOS (precisa da aplicação rodando e do MySQL real).
 *
 * O que ele faz: vários clientes tentam reservar o MESMO computador, no MESMO horário, ao MESMO tempo.
 * Resultado esperado: exatamente 1 reserva criada (HTTP 201) e todas as outras recusadas (HTTP 409).
 * No final, a reserva criada é cancelada para não sujar o banco.
 *
 * Pré-requisitos:
 *   - a aplicação em execução (npm start ou serviço do Windows)
 *   - 2 ou mais clientes já cadastrados (pelo site ou pelo painel administrativo)
 *
 * Uso (Node 18 ou superior; PowerShell):
 *   node tests/concorrencia.js http://localhost:3000 ana@exemplo.com:Senha123 bruno@exemplo.com:Senha456
 */

const [base, ...credenciais] = process.argv.slice(2);

if (!base || credenciais.length < 2) {
  console.error('Uso: node tests/concorrencia.js <url-da-aplicacao> <email:senha> <email:senha> [...]');
  process.exit(1);
}

async function chamar(metodo, caminho, corpo, cookie) {
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // sem corpo JSON
  }
  return { status: resposta.status, dados, resposta };
}

async function entrar(par) {
  const [email, ...resto] = par.split(':');
  const senha = resto.join(':');
  const { status, resposta, dados } = await chamar('POST', '/api/auth/login', { email, senha });
  if (status !== 200) throw new Error(`Login de ${email} falhou (HTTP ${status}): ${dados && dados.erro}`);
  // O cookie-session usa dois cookies (valor e assinatura)
  const cookie = resposta.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { email, cookie };
}

(async () => {
  console.log(`Entrando com ${credenciais.length} clientes...`);
  const clientes = await Promise.all(credenciais.map(entrar));

  // Escolhe uma data futura (amanhã) e um computador sem reservas nesse dia
  const hoje = await chamar('GET', '/api/disponibilidade', null, clientes[0].cookie);
  const [a, m, d] = hoje.dados.agora.data.split('-').map(Number);
  const amanha = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
  const dia = await chamar('GET', `/api/disponibilidade?data=${amanha}`, null, clientes[0].cookie);
  if (dia.status !== 200) throw new Error(`Não foi possível consultar a disponibilidade de ${amanha}.`);

  const computador = dia.dados.computadores.find((c) => c.status === 'disponivel' && c.ocupados.length === 0);
  if (!computador) throw new Error('Nenhum computador totalmente livre amanhã. Cancele reservas de teste e repita.');

  const pedido = { computador_id: computador.id, data: amanha, hora_inicio: '20:00', duracao_min: 60 };
  console.log(`Disputando ${computador.nome} em ${amanha}, 20:00 às 21:00, com ${clientes.length} requisições simultâneas...`);

  // Dispara todas ao mesmo tempo; cada cliente repete o pedido 3 vezes para aumentar a disputa
  const disparos = clientes.flatMap((c) => [1, 2, 3].map(() => chamar('POST', '/api/reservas', pedido, c.cookie).then((r) => ({ ...r, quem: c }))));
  const resultados = await Promise.all(disparos);

  const criadas = resultados.filter((r) => r.status === 201);
  const recusadas = resultados.filter((r) => r.status === 409);
  const outras = resultados.filter((r) => ![201, 409].includes(r.status));

  console.log(`\nResultado: ${criadas.length} criada(s) (201), ${recusadas.length} recusada(s) por conflito (409), ${outras.length} outra(s).`);
  outras.forEach((r) => console.log(`  inesperado: HTTP ${r.status} ${r.dados && r.dados.erro}`));

  // Limpeza: cancela a reserva criada
  for (const r of criadas) {
    await chamar('POST', `/api/reservas/${r.dados.reserva.id}/cancelar`, null, r.quem.cookie);
  }

  if (criadas.length === 1 && outras.length === 0) {
    console.log('APROVADO: apenas uma reserva foi aceita para o mesmo computador e horário.');
  } else {
    console.log('REPROVADO: o esperado era exatamente 1 reserva criada e nenhuma resposta inesperada.');
    process.exitCode = 1;
  }
})().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exit(1);
});
