/* =====================================================================
   Área do cliente: agendamento (data, computador, horário, duração) e "Minhas reservas".
   Toda a decisão final (conflitos, horários passados, limites) é do servidor;
   aqui só se calcula o que mostrar habilitado para o usuário.
   ===================================================================== */
import {
  api,
  ApiErro,
  esc,
  icone,
  toast,
  modal,
  confirmar,
  carregando,
  alerta,
  seloReserva,
  fmtData,
  dataLonga,
  dataHoraCurta,
  paraMin,
  deMin,
  duracaoTexto,
  somarDias,
  iniciarMenu,
  sair,
} from './app.js';

iniciarMenu();
document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', sair));

const $ = (id) => document.getElementById(id);

const estado = {
  regras: null, // regras de funcionamento enviadas pelo servidor
  agora: null, // { data, hora, minutos } no horário da lan house
  dias: [], // datas que podem ser escolhidas
  data: null, // data escolhida (AAAA-MM-DD)
  dados: null, // resposta de /api/disponibilidade para a data escolhida
  pcId: null,
  inicio: null, // minutos desde 00:00
  duracao: null, // minutos
  concluida: null, // reserva recém-confirmada
  erro: '', // mensagem de erro do último envio
  enviando: false,
  reservas: [],
  filtro: 'proximas',
};

/* =====================================================================
   Cálculos de disponibilidade
   ===================================================================== */
const abreMin = () => paraMin(estado.regras.abre);
const fechaMin = () => paraMin(estado.regras.fecha);
const menorDuracao = () => estado.regras.duracoes[0];
const pcAtual = () => estado.dados?.computadores.find((c) => c.id === estado.pcId) || null;

const blocosDe = (pc) => pc.ocupados.map((o) => ({ ini: paraMin(o.inicio), fim: paraMin(o.fim), minha: o.minha }));

/** Já passou? (só vale para o dia de hoje) */
const jaPassou = (inicioMin) => estado.data === estado.agora.data && inicioMin <= estado.agora.minutos;

/** Cabe uma reserva que começa em `ini` e dura `dur` minutos neste computador? */
function cabe(pc, ini, dur) {
  const fim = ini + dur;
  if (ini < abreMin() || fim > fechaMin()) return false;
  if (jaPassou(ini)) return false;
  return !blocosDe(pc).some((b) => b.ini < fim && b.fim > ini);
}

/** Todos os horários de início possíveis no dia (de 30 em 30 minutos). */
function todosInicios() {
  const lista = [];
  for (let m = abreMin(); m <= fechaMin() - menorDuracao(); m += estado.regras.passo_min) lista.push(m);
  return lista;
}

const iniciosLivres = (pc) => todosInicios().filter((m) => cabe(pc, m, menorDuracao()));
const pct = (min) => ((min - abreMin()) / (fechaMin() - abreMin())) * 100;

/* =====================================================================
   Carregamento de dados
   ===================================================================== */
async function carregarDia(data) {
  const url = data ? `/api/disponibilidade?data=${encodeURIComponent(data)}` : '/api/disponibilidade';
  const dados = await api('GET', url);
  estado.dados = dados;
  estado.regras = dados.regras;
  estado.agora = dados.agora;
  estado.data = dados.data;
  return dados;
}

function gerarDias() {
  const hoje = estado.agora.data;
  return Array.from({ length: estado.regras.dias_antecedencia + 1 }, (_, i) => somarDias(hoje, i));
}

/** Hoje ainda tem algum horário de início possível? */
function hojeTemHorarios() {
  const ultimoInicio = fechaMin() - menorDuracao();
  return estado.agora.minutos < ultimoInicio;
}

/* =====================================================================
   Renderização do agendamento
   ===================================================================== */
function renderDatas() {
  $('datas').innerHTML = estado.dias
    .map((iso) => {
      const ehHoje = iso === estado.agora.data;
      const semana = ehHoje ? 'Hoje' : fmtData(iso, { weekday: 'short' }).replace('.', '');
      const dia = fmtData(iso, { day: '2-digit' });
      const mes = fmtData(iso, { month: 'short' }).replace('.', '');
      const bloqueado = ehHoje && !hojeTemHorarios();
      const rotuloA11y = `${dataLonga(iso)}${bloqueado ? ', sem horários restantes' : ''}`;
      return `<button type="button" class="date" data-data="${iso}" aria-pressed="${iso === estado.data}"
                aria-label="${esc(rotuloA11y)}" ${bloqueado ? 'disabled' : ''}>
                <small>${esc(semana)}</small><strong>${dia}</strong><small>${esc(mes)}</small>
              </button>`;
    })
    .join('');
}

function renderPcs() {
  const lista = estado.dados.computadores;
  if (!lista.length) {
    $('pcs').innerHTML = '<p class="hint">Nenhum computador cadastrado no momento.</p>';
    return;
  }

  const diaEncerrado = estado.data === estado.agora.data && !hojeTemHorarios();
  $('aviso-dia').innerHTML = diaEncerrado ? alerta('info', 'Não há mais horários hoje. Escolha outro dia.') : '';

  $('pcs').innerHTML = lista
    .map((pc) => {
      let situacao;
      let rotulo;
      let info;
      if (pc.status === 'manutencao') {
        situacao = 'manutencao';
        rotulo = 'Em manutenção';
        info = 'Indisponível no momento';
      } else {
        const livres = iniciosLivres(pc).length;
        if (livres === 0) {
          situacao = 'ocupado';
          rotulo = 'Ocupado';
          info = 'Sem horários livres neste dia';
        } else {
          situacao = 'livre';
          rotulo = 'Livre';
          info = livres === 1 ? '1 horário livre' : `${livres} horários livres`;
        }
      }
      const selecionado = pc.id === estado.pcId;
      const faixa = blocosDe(pc)
        .map((b) => `<i class="${b.minha ? 'mine' : ''}" style="left:${pct(b.ini)}%;width:${pct(b.fim) - pct(b.ini)}%"></i>`)
        .join('');
      return `<button type="button" class="pc${selecionado ? ' is-selected' : ''}" data-pc="${pc.id}"
                aria-pressed="${selecionado}" ${situacao !== 'livre' ? 'disabled' : ''}>
                <span class="pc__topo">
                  <span class="pc__nome">${esc(pc.nome)}</span>
                  <span class="pc__estado pc__estado--${situacao}">${rotulo}</span>
                </span>
                <span class="pc__spec">${esc(pc.descricao || 'Sem descrição')}</span>
                <span class="strip" aria-hidden="true">${faixa}</span>
                <span class="pc__info">${info}</span>
              </button>`;
    })
    .join('');
}

function renderHoras() {
  const pc = pcAtual();
  if (!pc) {
    $('linha-tempo').innerHTML = '';
    $('horas').innerHTML = '';
    return;
  }

  // Linha do tempo do computador: ocupado, passado e a seleção atual
  const blocos = blocosDe(pc)
    .map((b) => `<i class="${b.minha ? 'mine' : ''}" style="left:${pct(b.ini)}%;width:${pct(b.fim) - pct(b.ini)}%"></i>`)
    .join('');
  const passado =
    estado.data === estado.agora.data && estado.agora.minutos > abreMin()
      ? `<i class="past" style="left:0;width:${Math.min(100, Math.max(0, pct(estado.agora.minutos)))}%"></i>`
      : '';
  const selecao =
    estado.inicio !== null
      ? `<i class="sel" style="left:${pct(estado.inicio)}%;width:${pct(Math.min(fechaMin(), estado.inicio + (estado.duracao || menorDuracao()))) - pct(estado.inicio)}%"></i>`
      : '';
  let rotulos = '';
  for (let m = abreMin(); m <= fechaMin(); m += 120) {
    rotulos += `<span style="left:${pct(m)}%">${deMin(m).slice(0, 2)}h</span>`;
  }
  $('linha-tempo').innerHTML = `
    <div class="timeline">
      <div class="timeline__titulo"><strong>${esc(pc.nome)}</strong><span>Faixas em vermelho já estão reservadas</span></div>
      <div class="timeline__track" aria-hidden="true">${blocos}${passado}${selecao}</div>
      <div class="timeline__labels" aria-hidden="true">${rotulos}</div>
    </div>`;

  $('horas').innerHTML = todosInicios()
    .map((m) => {
      const livre = cabe(pc, m, menorDuracao());
      const hhmm = deMin(m);
      return `<button type="button" class="time" data-inicio="${m}" aria-pressed="${estado.inicio === m}"
                ${livre ? '' : 'disabled'} aria-label="${hhmm}${livre ? '' : ', indisponível'}">${hhmm}</button>`;
    })
    .join('');
}

function renderDuracoes() {
  const pc = pcAtual();
  $('duracoes').innerHTML = estado.regras.duracoes
    .map((d) => {
      const ok = pc && estado.inicio !== null && cabe(pc, estado.inicio, d);
      return `<button type="button" class="seg" data-duracao="${d}" aria-pressed="${estado.duracao === d}"
                ${ok ? '' : 'disabled'}>${esc(duracaoTexto(d))}</button>`;
    })
    .join('');

  if (estado.inicio === null) {
    $('dica-duracao').textContent = '';
  } else if (estado.duracao) {
    $('dica-duracao').textContent = `Sua reserva termina às ${deMin(estado.inicio + estado.duracao)}.`;
  } else {
    const possiveis = pc ? estado.regras.duracoes.filter((d) => cabe(pc, estado.inicio, d)) : [];
    const maximo = possiveis[possiveis.length - 1];
    $('dica-duracao').textContent = maximo
      ? `A partir das ${deMin(estado.inicio)} você pode ficar até ${duracaoTexto(maximo)}. Durações maiores batem em outra reserva ou no fechamento.`
      : '';
  }
}

function atualizarPassos() {
  const pc = pcAtual();
  const marcar = (id, { travado, feito }) => {
    $(id).classList.toggle('is-locked', travado);
    $(id).classList.toggle('is-done', feito);
  };
  marcar('passo-data', { travado: false, feito: Boolean(estado.data) });
  marcar('passo-pc', { travado: !estado.data, feito: Boolean(pc) });
  marcar('passo-hora', { travado: !pc, feito: estado.inicio !== null });
  marcar('passo-duracao', { travado: estado.inicio === null, feito: Boolean(estado.duracao) });
}

function linhaResumo(nomeIcone, rotulo, valor, subtitulo = '') {
  const vazio = !valor;
  return `<div class="summary__linha${vazio ? '' : ' is-ok'}">
            ${icone(nomeIcone)}
            <div>
              <span class="summary__rotulo">${rotulo}</span>
              <span class="summary__valor${vazio ? ' is-vazio' : ''}">${vazio ? 'Não escolhido' : esc(valor)}${
                subtitulo && !vazio ? `<small>${esc(subtitulo)}</small>` : ''
              }</span>
            </div>
          </div>`;
}

function renderResumo() {
  const alvo = $('resumo');

  if (estado.concluida) {
    const r = estado.concluida;
    alvo.innerHTML = `
      <div class="sucesso">
        <div class="sucesso__icone">${icone('check')}</div>
        <h2>Reserva confirmada</h2>
        <p class="sucesso__codigo">Código #${r.id}. Guarde para apresentar na recepção.</p>
        <div class="summary__lista">
          ${linhaResumo('calendar', 'Data', dataLonga(r.data))}
          ${linhaResumo('monitor', 'Computador', r.computador.nome, r.computador.descricao)}
          ${linhaResumo('clock', 'Horário', `${r.hora_inicio} às ${r.hora_fim}`, duracaoTexto(r.duracao_min))}
        </div>
        <a class="btn btn--primary btn--block" href="#reservas">Ver minhas reservas</a>
        <button type="button" class="btn btn--ghost btn--block" data-nova>Fazer outra reserva</button>
      </div>`;
    return;
  }

  const pc = pcAtual();
  const pronto = estado.data && pc && estado.inicio !== null && estado.duracao;
  const horario =
    estado.inicio === null
      ? ''
      : estado.duracao
        ? `${deMin(estado.inicio)} às ${deMin(estado.inicio + estado.duracao)}`
        : `A partir das ${deMin(estado.inicio)}`;

  alvo.innerHTML = `
    <h2>Resumo da reserva</h2>
    <div class="summary__lista">
      ${linhaResumo('calendar', 'Data', estado.data ? fmtData(estado.data, { weekday: 'long', day: 'numeric', month: 'long' }) : '')}
      ${linhaResumo('monitor', 'Computador', pc ? pc.nome : '', pc ? pc.descricao : '')}
      ${linhaResumo('clock', 'Horário', horario)}
      ${linhaResumo('clock', 'Duração', estado.duracao ? duracaoTexto(estado.duracao) : '')}
    </div>
    ${estado.erro ? alerta('erro', estado.erro) : ''}
    <p class="summary__nota">${icone('info')}<span>Você pode cancelar até ${esc(duracaoTexto(estado.regras.cancelamento_min))} antes do início, pela página Minhas reservas.</span></p>
    <button type="button" class="btn btn--primary btn--block" id="confirmar" ${pronto && !estado.enviando ? '' : 'disabled'}>Confirmar reserva</button>`;
}

function renderTudo() {
  renderDatas();
  renderPcs();
  renderHoras();
  renderDuracoes();
  atualizarPassos();
  renderResumo();
}

/* =====================================================================
   Ações do agendamento
   ===================================================================== */
async function escolherData(iso) {
  estado.erro = '';
  estado.pcId = null;
  estado.inicio = null;
  estado.duracao = null;
  try {
    await carregarDia(iso);
  } catch (erro) {
    toast(erro.message, 'erro');
    return;
  }
  renderTudo();
}

function escolherPc(id) {
  estado.erro = '';
  estado.pcId = id;
  estado.inicio = null;
  estado.duracao = null;
  renderTudo();
  $('passo-hora').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escolherInicio(min) {
  estado.erro = '';
  estado.inicio = min;
  const pc = pcAtual();
  // Se a duração escolhida antes não cabe mais nesse horário, limpa
  if (estado.duracao && !(pc && cabe(pc, min, estado.duracao))) estado.duracao = null;
  renderTudo();
}

function escolherDuracao(min) {
  estado.erro = '';
  estado.duracao = min;
  renderTudo();
}

async function confirmarReserva() {
  const pc = pcAtual();
  if (!pc || estado.inicio === null || !estado.duracao || estado.enviando) return;

  estado.enviando = true;
  estado.erro = '';
  const botao = $('confirmar');
  carregando(botao, true);

  try {
    const { reserva } = await api('POST', '/api/reservas', {
      computador_id: pc.id,
      data: estado.data,
      hora_inicio: deMin(estado.inicio),
      duracao_min: estado.duracao,
    });
    estado.concluida = reserva;
    estado.enviando = false;
    toast('Reserva confirmada!');
    // Atualiza as faixas do dia em segundo plano
    carregarDia(estado.data)
      .then(renderTudo)
      .catch(() => {});
    renderResumo();
  } catch (erro) {
    estado.enviando = false;
    estado.erro = erro.message;
    // Conflito ou horário que passou: recarrega a disponibilidade e pede nova escolha de horário
    if (erro instanceof ApiErro && [400, 409].includes(erro.status)) {
      estado.inicio = null;
      estado.duracao = null;
      try {
        await carregarDia(estado.data);
      } catch {
        // mantém os dados antigos
      }
    }
    renderTudo();
  }
}

function novaReserva() {
  estado.concluida = null;
  estado.erro = '';
  estado.pcId = null;
  estado.inicio = null;
  estado.duracao = null;
  carregarDia(estado.data)
    .catch(() => {})
    .finally(renderTudo);
}

/* Eventos (delegação) */
$('datas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-data]');
  if (b && !b.disabled) escolherData(b.dataset.data);
});
$('pcs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pc]');
  if (b && !b.disabled) escolherPc(Number(b.dataset.pc));
});
$('horas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-inicio]');
  if (b && !b.disabled) escolherInicio(Number(b.dataset.inicio));
});
$('duracoes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-duracao]');
  if (b && !b.disabled) escolherDuracao(Number(b.dataset.duracao));
});
$('resumo').addEventListener('click', (e) => {
  if (e.target.closest('#confirmar')) confirmarReserva();
  if (e.target.closest('[data-nova]')) novaReserva();
});

async function iniciarAgendamento() {
  $('pcs').innerHTML = '<p class="hint">Carregando disponibilidade...</p>';
  try {
    await carregarDia();
    estado.dias = gerarDias();
    // Se hoje já encerrou, começa pelo dia seguinte
    if (!hojeTemHorarios()) await carregarDia(somarDias(estado.agora.data, 1));
    renderTudo();
  } catch (erro) {
    $('pcs').innerHTML = `${alerta('erro', erro.message)}<button type="button" class="btn btn--ghost btn--sm" id="tentar-de-novo" style="margin-top:12px">Tentar de novo</button>`;
    $('passo-pc').classList.remove('is-locked');
    $('tentar-de-novo').addEventListener('click', iniciarAgendamento);
  }
}

/* =====================================================================
   Minhas reservas
   ===================================================================== */
const proximas = () =>
  estado.reservas.filter((r) => r.status === 'confirmado').sort((a, b) => `${a.data}${a.hora_inicio}`.localeCompare(`${b.data}${b.hora_inicio}`));
const historico = () => estado.reservas.filter((r) => r.status !== 'confirmado');

function limiteCancelamento(r) {
  const limite = paraMin(r.hora_inicio) - estado.regras.cancelamento_min;
  return limite >= 0 ? deMin(limite) : null;
}

function linhaReserva(r) {
  const passada = r.status !== 'confirmado';
  let acoes = `<button type="button" class="btn btn--ghost btn--sm" data-detalhes="${r.id}">Detalhes</button>`;
  if (r.pode_cancelar) {
    acoes += `<button type="button" class="btn btn--danger btn--sm" data-cancelar="${r.id}">Cancelar</button>`;
  } else if (r.status === 'confirmado') {
    acoes += `<span class="cell-sub">${r.em_andamento ? 'Em andamento' : 'Prazo de cancelamento encerrado'}</span>`;
  }
  return `
    <li class="reserva${passada ? ' is-passada' : ''}">
      <div class="reserva__data"><b>${fmtData(r.data, { day: '2-digit' })}</b><span>${esc(fmtData(r.data, { month: 'short' }).replace('.', ''))}</span></div>
      <div class="reserva__main">
        <strong>${esc(r.computador.nome)}</strong>
        <span>${esc(fmtData(r.data, { weekday: 'long' }))}, ${r.hora_inicio} às ${r.hora_fim} (${esc(duracaoTexto(r.duracao_min))})</span>
        <span class="cell-sub">${esc(r.computador.descricao)}</span>
      </div>
      <div class="reserva__status">${seloReserva(r)}</div>
      <div class="reserva__acoes">${acoes}</div>
    </li>`;
}

function renderReservas() {
  const p = proximas();
  const h = historico();
  $('n-proximas').textContent = p.length;
  $('n-historico').textContent = h.length;

  const lista = estado.filtro === 'proximas' ? p : h;
  if (!lista.length) {
    $('lista-reservas').innerHTML =
      estado.filtro === 'proximas'
        ? `<div class="vazio"><h3>Você não tem reservas futuras</h3><p>Escolha o dia, a máquina e o horário para garantir seu lugar.</p><a class="btn btn--primary" href="#agendar">Agendar um horário</a></div>`
        : `<div class="vazio"><h3>Nada no histórico ainda</h3><p>Reservas concluídas e canceladas aparecem aqui.</p></div>`;
    return;
  }
  $('lista-reservas').innerHTML = `<ul>${lista.map(linhaReserva).join('')}</ul>`;
}

async function carregarReservas() {
  $('lista-reservas').innerHTML = '<p class="hint" style="padding:24px 0">Carregando reservas...</p>';
  try {
    const dados = await api('GET', '/api/reservas');
    estado.reservas = dados.reservas;
    estado.regras = dados.regras;
    renderReservas();
  } catch (erro) {
    $('lista-reservas').innerHTML = alerta('erro', erro.message);
  }
}

async function cancelarReserva(id) {
  const r = estado.reservas.find((x) => x.id === id);
  if (!r) return;
  const ok = await confirmar({
    titulo: 'Cancelar reserva?',
    mensagem: `${r.computador.nome}, ${fmtData(r.data, { weekday: 'long', day: 'numeric', month: 'long' })}, das ${r.hora_inicio} às ${r.hora_fim}. Essa ação não pode ser desfeita.`,
    confirmarTexto: 'Cancelar reserva',
    cancelarTexto: 'Manter reserva',
    perigo: true,
  });
  if (!ok) return;
  try {
    await api('POST', `/api/reservas/${id}/cancelar`);
    toast('Reserva cancelada.');
  } catch (erro) {
    toast(erro.message, 'erro');
  }
  await carregarReservas();
}

async function mostrarDetalhes(id) {
  const r = estado.reservas.find((x) => x.id === id);
  if (!r) return;

  const limite = limiteCancelamento(r);
  let cancelamento = '';
  if (r.status === 'confirmado') {
    if (r.pode_cancelar) {
      cancelamento = `Permitido até ${duracaoTexto(estado.regras.cancelamento_min)} antes do início${limite ? ` (até ${limite})` : ''}.`;
    } else {
      cancelamento = r.em_andamento ? 'Reserva em andamento.' : 'O prazo de cancelamento já passou.';
    }
  } else if (r.status === 'cancelado') {
    cancelamento = r.cancelado_por === 'admin' ? 'Cancelada pela recepção.' : 'Cancelada por você.';
  } else {
    cancelamento = 'Reserva concluída.';
  }

  const corpo = `
    <dl class="dados">
      <dt>Código</dt><dd>#${r.id}</dd>
      <dt>Computador</dt><dd>${esc(r.computador.nome)}<br><span class="cell-sub">${esc(r.computador.descricao)}</span></dd>
      <dt>Data</dt><dd>${esc(dataLonga(r.data))}</dd>
      <dt>Horário</dt><dd>${r.hora_inicio} às ${r.hora_fim}</dd>
      <dt>Duração</dt><dd>${esc(duracaoTexto(r.duracao_min))}</dd>
      <dt>Status</dt><dd>${seloReserva(r)}</dd>
      <dt>Cancelamento</dt><dd>${esc(cancelamento)}</dd>
      <dt>Reservado em</dt><dd>${esc(dataHoraCurta(r.criado_em))}</dd>
    </dl>`;

  const d = modal({
    titulo: 'Detalhes da reserva',
    corpo,
    rodape: `<button type="button" class="btn btn--ghost" data-fechar>Fechar</button>
             ${r.pode_cancelar ? '<button type="button" class="btn btn--danger" data-cancelar-modal>Cancelar reserva</button>' : ''}`,
  });
  d.querySelector('[data-cancelar-modal]')?.addEventListener('click', () => {
    d.close();
    cancelarReserva(r.id);
  });
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  estado.filtro = b.dataset.filtro;
  document.querySelectorAll('.tabs [data-filtro]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderReservas();
});

$('lista-reservas').addEventListener('click', (e) => {
  const det = e.target.closest('[data-detalhes]');
  const can = e.target.closest('[data-cancelar]');
  if (det) mostrarDetalhes(Number(det.dataset.detalhes));
  if (can) cancelarReserva(Number(can.dataset.cancelar));
});

/* =====================================================================
   Navegação entre as duas telas (#agendar / #reservas) e dados do usuário
   ===================================================================== */
function rotear() {
  const aba = window.location.hash === '#reservas' ? 'reservas' : 'agendar';
  $('view-agendar').hidden = aba !== 'agendar';
  $('view-reservas').hidden = aba !== 'reservas';
  document.querySelectorAll('[data-aba]').forEach((a) => {
    if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${aba === 'reservas' ? 'Minhas reservas' : 'Agendar horário'} | Ping Lounge`;
  if (aba === 'reservas') carregarReservas();
  // Ao voltar para Agendar, o painel de "Reserva confirmada" da vez anterior dá lugar a um novo agendamento
  if (aba === 'agendar' && estado.concluida) novaReserva();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', rotear);

api('GET', '/api/auth/eu')
  .then(({ usuario }) => {
    $('usuario-nome').textContent = usuario.nome.split(' ')[0];
    $('usuario-inicial').textContent = usuario.nome.trim().charAt(0).toUpperCase();
  })
  .catch(() => {});

iniciarAgendamento().then(rotear);
