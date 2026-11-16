/* =====================================================================
   Funções compartilhadas por todas as páginas (módulo ES, sem build).
   ===================================================================== */

/* ----------------------------- Texto e ícones ----------------------------- */

/** Escapa texto antes de colocar dentro de innerHTML (evita XSS). */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Ícone do sprite /images/icons.svg */
export function icone(nome, classe = '') {
  return `<svg class="i ${classe}" aria-hidden="true"><use href="/images/icons.svg#${nome}"/></svg>`;
}

/* ----------------------------- Chamadas à API ----------------------------- */

export class ApiErro extends Error {
  constructor(status, mensagem, campos = null, extra = null) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
    this.extra = extra;
  }
}

/** Faz uma requisição JSON. Lança ApiErro com mensagem pronta para mostrar ao usuário. */
export async function api(metodo, url, corpo) {
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
  };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }

  let resposta;
  try {
    resposta = await fetch(url, opcoes);
  } catch {
    throw new ApiErro(0, 'Sem conexão com o servidor. Verifique a rede e tente de novo.');
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // resposta sem JSON
  }

  // Sessão expirada em uma tela protegida: volta ao login
  if (resposta.status === 401 && !url.startsWith('/api/auth/')) {
    window.location.href = '/login?sessao=expirada';
    throw new ApiErro(401, 'Sua sessão expirou. Entre novamente.');
  }
  if (!resposta.ok) {
    const { erro, campos, ...extra } = dados || {};
    throw new ApiErro(resposta.status, erro || 'Algo deu errado. Tente novamente.', campos || null, extra);
  }
  return dados;
}

/* ----------------------------- Datas e horas ----------------------------- */

export function dataUTC(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function fmtData(iso, opcoes) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opcoes }).format(dataUTC(iso));
}

/** Primeira letra maiúscula (ex.: 'segunda-feira, 9 de novembro' -> 'Segunda-feira, 9 de novembro'). */
export const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

export const dataCurta = (iso) => fmtData(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const dataLonga = (iso) => fmtData(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** '2026-11-08 14:30:00' -> '08/11/2026 14:30' */
export function dataHoraCurta(dt) {
  if (!dt) return '';
  return `${dataCurta(dt.slice(0, 10))} ${dt.slice(11, 16)}`;
}

export function paraMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function deMin(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** '10:00' -> '10h' | '22:30' -> '22h30' */
export function horaExtenso(hhmm) {
  const [h, m] = hhmm.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** 60 -> '1 hora' | 90 -> '1 h 30' | 120 -> '2 horas' */
export function duracaoTexto(min) {
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m) return `${h} h ${String(m).padStart(2, '0')}`;
  return h === 1 ? '1 hora' : `${h} horas`;
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(iso, dias) {
  const d = dataUTC(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* ----------------------------- Selos de status ----------------------------- */

const ROTULOS = {
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  andamento: 'Em andamento',
  disponivel: 'Disponível',
  manutencao: 'Em manutenção',
  desativado: 'Desativado',
  ativo: 'Ativo',
  inativo: 'Inativo',
  livre: 'Livre',
  ocupado: 'Ocupado',
  em_uso: 'Em uso',
};

export function selo(chave, rotulo) {
  return `<span class="badge badge--${esc(chave)}">${esc(rotulo || ROTULOS[chave] || chave)}</span>`;
}

/** Selo de uma reserva (considera "em andamento"). */
export function seloReserva(reserva) {
  return reserva.em_andamento ? selo('andamento') : selo(reserva.status);
}

/* ----------------------------- Avisos (toast) ----------------------------- */

let areaToasts = null;

export function toast(mensagem, tipo = 'ok') {
  if (!areaToasts) {
    areaToasts = document.createElement('div');
    areaToasts.className = 'toasts';
    areaToasts.setAttribute('role', 'status');
    areaToasts.setAttribute('aria-live', 'polite');
    document.body.append(areaToasts);
  }
  const icones = { ok: 'check-circle', erro: 'alert', aviso: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.innerHTML = `${icone(icones[tipo] || 'check-circle')}<span>${esc(mensagem)}</span>`;
  areaToasts.append(el);
  setTimeout(() => el.remove(), tipo === 'ok' ? 4200 : 7000);
}

/* ----------------------------- Modais ----------------------------- */

/**
 * Abre um modal (elemento <dialog>). `corpo` e `rodape` podem ser HTML (texto) ou elementos.
 * Retorna o <dialog>; ele se remove da página ao fechar.
 */
export function modal({ titulo, corpo = '', rodape = '', largo = false }) {
  const d = document.createElement('dialog');
  d.className = `modal${largo ? ' modal--wide' : ''}`;
  d.setAttribute('aria-labelledby', 'modal-titulo');
  d.innerHTML = `
    <div class="modal-head">
      <h2 id="modal-titulo">${esc(titulo)}</h2>
      <button type="button" class="icon-btn" data-fechar aria-label="Fechar">${icone('x')}</button>
    </div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div>`;

  const preencher = (alvo, conteudo) => {
    if (typeof conteudo === 'string') alvo.innerHTML = conteudo;
    else alvo.append(conteudo);
  };
  preencher(d.querySelector('.modal-body'), corpo);
  preencher(d.querySelector('.modal-foot'), rodape);

  d.addEventListener('click', (e) => {
    // clique no fundo escurecido (o alvo é o próprio <dialog>) ou no botão fechar
    if (e.target === d || e.target.closest('[data-fechar]')) d.close();
  });
  d.addEventListener('close', () => d.remove());

  document.body.append(d);
  d.showModal();
  return d;
}

/** Caixa de confirmação. Resolve true (confirmou) ou false (cancelou/fechou). */
export function confirmar({ titulo, mensagem, confirmarTexto = 'Confirmar', cancelarTexto = 'Voltar', perigo = false }) {
  return new Promise((resolver) => {
    let resultado = false;
    const d = modal({
      titulo,
      corpo: `<p>${esc(mensagem)}</p>`,
      rodape: `<button type="button" class="btn btn--ghost" data-fechar>${esc(cancelarTexto)}</button>
               <button type="button" class="btn ${perigo ? 'btn--danger-solid' : 'btn--primary'}" data-ok>${esc(confirmarTexto)}</button>`,
    });
    d.querySelector('[data-ok]').addEventListener('click', () => {
      resultado = true;
      d.close();
    });
    d.addEventListener('close', () => resolver(resultado));
    d.querySelector('[data-ok]').focus();
  });
}

/* ----------------------------- Formulários ----------------------------- */

export function carregando(botao, ativo) {
  botao.classList.toggle('is-loading', ativo);
  botao.disabled = ativo;
}

export function limparErros(form) {
  form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

/** Mostra o erro de cada campo (ids "erro-<campo>") e foca no primeiro com problema. */
export function mostrarErrosCampos(form, campos) {
  let primeiro = null;
  for (const [nome, mensagem] of Object.entries(campos || {})) {
    const input = form.querySelector(`[name="${nome}"]`);
    const alvo = form.querySelector(`#erro-${nome}`);
    if (alvo) alvo.textContent = mensagem;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (!primeiro) primeiro = input;
    }
  }
  if (primeiro) primeiro.focus();
}

export function alerta(tipo, mensagem) {
  const icones = { erro: 'alert', ok: 'check-circle', aviso: 'alert', info: 'info' };
  return `<div class="alert alert--${tipo}" role="${tipo === 'erro' ? 'alert' : 'status'}">${icone(icones[tipo])}<span>${esc(mensagem)}</span></div>`;
}

/** Botões "mostrar/ocultar senha". */
export function ativarAlternarSenha(raiz = document) {
  raiz.querySelectorAll('[data-alternar-senha]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const input = botao.parentElement.querySelector('input');
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      botao.setAttribute('aria-pressed', String(mostrar));
      botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
      botao.innerHTML = icone(mostrar ? 'eye-off' : 'eye');
    });
  });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ----------------------------- Cabeçalho e estado de login ----------------------------- */

/** Menu do celular. */
export function iniciarMenu() {
  const botao = document.querySelector('.menu-toggle');
  const painel = document.getElementById('painel-menu');
  if (!botao || !painel) return;
  botao.addEventListener('click', () => {
    const aberto = painel.classList.toggle('is-open');
    botao.setAttribute('aria-expanded', String(aberto));
    botao.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
  });
  painel.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      painel.classList.remove('is-open');
      botao.setAttribute('aria-expanded', 'false');
    }
  });
}

/** Em páginas públicas: se a pessoa já entrou, troca "Entrar" por "Minha área". */
export async function marcarUsuarioLogado() {
  const link = document.querySelector('[data-entrar]');
  if (!link) return;
  try {
    const { usuario, destino } = await api('GET', '/api/auth/eu');
    link.href = destino;
    link.textContent = usuario.perfil === 'admin' ? 'Painel' : 'Minha área';
  } catch {
    // visitante (ou banco indisponível): mantém "Entrar"
  }
}

export async function sair() {
  try {
    await api('POST', '/api/auth/logout');
  } finally {
    window.location.href = '/login';
  }
}

/** Indicador "X de Y máquinas livres agora" (página inicial e telas de login). */
export async function preencherIndicadorAoVivo() {
  const caixa = document.getElementById('live');
  const texto = document.getElementById('live-texto');
  if (!caixa || !texto) return null;
  try {
    const resumo = await api('GET', '/api/publico/resumo');
    if (resumo.aberto) {
      caixa.dataset.estado = 'aberto';
      texto.textContent =
        resumo.total === 0
          ? 'Nenhuma máquina cadastrada'
          : `${resumo.livres_agora} de ${resumo.total} máquinas livres agora`;
    } else {
      caixa.dataset.estado = 'fechado';
      texto.textContent = `Fechado agora. Abrimos às ${horaExtenso(resumo.regras.abre)}`;
    }
    return resumo;
  } catch {
    caixa.hidden = true;
    return null;
  }
}
