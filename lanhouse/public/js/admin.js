/* =====================================================================
   Painel administrativo.
   A interface só esconde/mostra; a permissão de verdade é verificada no servidor
   (todas as rotas /api/admin exigem perfil "admin").
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
  selo,
  seloReserva,
  fmtData,
  capitalizar,
  dataCurta,
  dataLonga,
  dataHoraCurta,
  duracaoTexto,
  somarDias,
  limparErros,
  mostrarErrosCampos,
  ativarAlternarSenha,
  debounce,
  sair,
} from './app.js';

const $ = (id) => document.getElementById(id);
document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', sair));

const VIEWS = ['visao-geral', 'clientes', 'computadores', 'agendamentos'];

const estado = {
  agora: null, // { data, hora } da última resposta do servidor
  clientes: [],
  computadores: [],
};

/* ---------------------------------------------------------------------
   Utilitários de tela
   --------------------------------------------------------------------- */
function tabela(colunas, linhas, { classe = '' } = {}) {
  const cab = colunas.map((c) => `<th scope="col"${c.classe ? ` class="${c.classe}"` : ''}>${esc(c.titulo)}</th>`).join('');
  return `<div class="table-wrap"><table class="tbl ${classe}"><thead><tr>${cab}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;
}

function estadoVazio(titulo, texto) {
  return `<div class="table-wrap"><div class="vazio"><h3>${esc(titulo)}</h3><p>${esc(texto)}</p></div></div>`;
}

function falhaDeCarga(alvo, erro, recarregar) {
  alvo.innerHTML = `${alerta('erro', erro.message)}<button type="button" class="btn btn--ghost btn--sm" style="margin-top:12px" data-recarregar>Tentar de novo</button>`;
  alvo.querySelector('[data-recarregar]').addEventListener('click', recarregar);
}

const horario = (r) => `${r.hora_inicio} às ${r.hora_fim}`;

/* =====================================================================
   VISÃO GERAL
   ===================================================================== */
async function carregarVisaoGeral() {
  try {
    const dados = await api('GET', '/api/admin/resumo');
    estado.agora = dados.agora;
    $('data-hoje').textContent = `${capitalizar(fmtData(dados.agora.data, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${dados.agora.hora}`;

    const c = dados.contagens;
    const kpis = [
      { valor: c.clientes, rotulo: 'Clientes cadastrados' },
      { valor: c.computadores, rotulo: 'Computadores', nota: `${c.computadores_disponiveis} disponíveis para reserva` },
      { valor: c.agendamentos, rotulo: 'Total de agendamentos' },
      { valor: c.agendamentos_hoje, rotulo: 'Agendamentos de hoje', nota: 'sem contar cancelados' },
      { valor: c.confirmados, rotulo: 'Reservas confirmadas', nota: 'ainda a realizar' },
    ];
    $('kpis').innerHTML = kpis
      .map(
        (k) => `<div class="kpi"><span class="kpi__valor">${k.valor}</span><span class="kpi__rotulo">${esc(k.rotulo)}</span>${
          k.nota ? `<span class="kpi__nota">${esc(k.nota)}</span>` : ''
        }</div>`
      )
      .join('');

    // Agenda de hoje
    if (!dados.agenda_hoje.length) {
      $('agenda-hoje').innerHTML = estadoVazio('Nenhum agendamento para hoje', 'As reservas de hoje aparecem aqui.');
    } else {
      $('agenda-hoje').innerHTML = tabela(
        [{ titulo: 'Horário' }, { titulo: 'Computador' }, { titulo: 'Cliente' }, { titulo: 'Status' }],
        dados.agenda_hoje.map(
          (r) => `<tr>
            <td class="hoje-hora">${horario(r)}</td>
            <td>${esc(r.computador.nome)}</td>
            <td><div class="cell-main">${esc(r.cliente.nome)}</div></td>
            <td>${seloReserva(r)}</td>
          </tr>`
        ),
        { classe: 'tbl--mini' }
      );
    }

    // Salão agora
    const rotulos = { livre: 'Livre', em_uso: 'Em uso', manutencao: 'Manutenção', desativado: 'Desativado' };
    $('salao').innerHTML = dados.salao
      .map((p) => `<div class="salao__pc salao__pc--${p.estado}"><strong>${esc(p.nome)}</strong><span>${rotulos[p.estado] || p.estado}</span></div>`)
      .join('');
  } catch (erro) {
    $('kpis').innerHTML = '';
    falhaDeCarga($('agenda-hoje'), erro, carregarVisaoGeral);
  }
}
$('atualizar-visao').addEventListener('click', carregarVisaoGeral);

/* =====================================================================
   CLIENTES
   ===================================================================== */
async function carregarClientes() {
  const busca = $('busca-clientes').value.trim();
  try {
    const dados = await api('GET', `/api/admin/clientes${busca ? `?busca=${encodeURIComponent(busca)}` : ''}`);
    estado.clientes = dados.clientes;
    renderClientes(Boolean(busca));
  } catch (erro) {
    falhaDeCarga($('tabela-clientes'), erro, carregarClientes);
  }
}

function renderClientes(comBusca) {
  const lista = estado.clientes;
  $('contagem-clientes').textContent = `${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}`;

  if (!lista.length) {
    $('tabela-clientes').innerHTML = comBusca
      ? estadoVazio('Nenhum cliente encontrado', 'Confira o nome ou e-mail digitado.')
      : estadoVazio('Nenhum cliente cadastrado', 'Use "Novo cliente" ou aguarde cadastros pelo site.');
    return;
  }

  $('tabela-clientes').innerHTML = tabela(
    [
      { titulo: 'Cliente' },
      { titulo: 'Cadastro' },
      { titulo: 'Reservas' },
      { titulo: 'Status' },
      { titulo: 'Ações', classe: 'acoes' },
    ],
    lista.map(
      (c) => `<tr>
        <td><div class="cell-main">${esc(c.nome)}</div><div class="cell-sub">${esc(c.email)}</div></td>
        <td>${esc(dataCurta(c.criado_em.slice(0, 10)))}</td>
        <td>${c.total_reservas}${c.reservas_futuras ? `<div class="cell-sub">${c.reservas_futuras} futura(s)</div>` : ''}</td>
        <td>${selo(c.ativo ? 'ativo' : 'inativo')}</td>
        <td class="acoes"><span class="icones">
          <button type="button" class="icon-btn" data-acao="ver" data-id="${c.id}" aria-label="Ver dados de ${esc(c.nome)}" title="Ver dados">${icone('eye')}</button>
          <button type="button" class="icon-btn" data-acao="editar" data-id="${c.id}" aria-label="Editar ${esc(c.nome)}" title="Editar">${icone('pencil')}</button>
          <button type="button" class="icon-btn icon-btn--danger" data-acao="excluir" data-id="${c.id}" aria-label="Excluir ${esc(c.nome)}" title="Excluir">${icone('trash')}</button>
        </span></td>
      </tr>`
    )
  );
}

function abrirFormCliente(cliente = null) {
  const editando = Boolean(cliente);
  const corpo = `
    <form id="form-cliente" novalidate>
      <div class="field">
        <label for="c-nome">Nome completo</label>
        <input class="input" id="c-nome" name="nome" type="text" autocomplete="off" value="${esc(cliente?.nome || '')}" required>
        <p class="field-error" id="erro-nome" role="alert"></p>
      </div>
      <div class="field">
        <label for="c-email">E-mail</label>
        <input class="input" id="c-email" name="email" type="email" autocomplete="off" value="${esc(cliente?.email || '')}" required>
        <p class="field-error" id="erro-email" role="alert"></p>
      </div>
      <div class="field">
        <label for="c-senha">${editando ? 'Nova senha' : 'Senha'}</label>
        <div class="input-wrap">
          <input class="input" id="c-senha" name="senha" type="password" autocomplete="new-password" ${editando ? '' : 'required'}>
          <button class="icon-btn" type="button" data-alternar-senha aria-label="Mostrar senha" aria-pressed="false">${icone('eye')}</button>
        </div>
        <p class="hint">${editando ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 8 caracteres, com letras e números.'}</p>
        <p class="field-error" id="erro-senha" role="alert"></p>
      </div>
      ${
        editando
          ? `<label class="check"><input type="checkbox" name="ativo" ${cliente.ativo ? 'checked' : ''}> Cadastro ativo</label>
             <p class="hint">Ao desativar, o cliente não consegue entrar e as reservas futuras dele são canceladas.</p>`
          : ''
      }
      <div id="form-alerta" style="margin-top:16px"></div>
    </form>`;

  const d = modal({
    titulo: editando ? 'Editar cliente' : 'Novo cliente',
    corpo,
    rodape: `<button type="button" class="btn btn--ghost" data-fechar>Cancelar</button>
             <button type="submit" form="form-cliente" class="btn btn--primary">${editando ? 'Salvar alterações' : 'Cadastrar cliente'}</button>`,
  });
  const form = d.querySelector('#form-cliente');
  const botao = d.querySelector('button[type="submit"]');
  ativarAlternarSenha(form);
  form.querySelector('input').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    form.querySelector('#form-alerta').innerHTML = '';
    const corpoReq = {
      nome: form.nome.value,
      email: form.email.value,
      senha: form.senha.value,
    };
    if (editando) corpoReq.ativo = form.ativo.checked;

    carregando(botao, true);
    try {
      const resposta = editando
        ? await api('PUT', `/api/admin/clientes/${cliente.id}`, corpoReq)
        : await api('POST', '/api/admin/clientes', corpoReq);
      d.close();
      toast(editando ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      if (resposta.reservas_canceladas > 0) {
        toast(`${resposta.reservas_canceladas} reserva(s) futura(s) do cliente foram canceladas.`, 'aviso');
      }
      carregarClientes();
    } catch (erro) {
      if (erro instanceof ApiErro && erro.campos) mostrarErrosCampos(form, erro.campos);
      else form.querySelector('#form-alerta').innerHTML = alerta('erro', erro.message);
      carregando(botao, false);
    }
  });
}

async function verCliente(id) {
  try {
    const { cliente, reservas } = await api('GET', `/api/admin/clientes/${id}`);
    const historico = reservas.length
      ? `<div class="table-wrap"><table class="tbl tbl--mini"><thead><tr><th>Data</th><th>Horário</th><th>Computador</th><th>Status</th></tr></thead><tbody>${reservas
          .map(
            (r) => `<tr><td>${esc(dataCurta(r.data))}</td><td>${horario(r)}</td><td>${esc(r.computador.nome)}</td><td>${seloReserva(r)}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="hint">Este cliente ainda não fez reservas.</p>';

    const d = modal({
      titulo: 'Dados do cliente',
      largo: true,
      corpo: `
        <dl class="dados">
          <dt>Nome</dt><dd>${esc(cliente.nome)}</dd>
          <dt>E-mail</dt><dd>${esc(cliente.email)}</dd>
          <dt>Status</dt><dd>${selo(cliente.ativo ? 'ativo' : 'inativo')}</dd>
          <dt>Cadastro</dt><dd>${esc(dataHoraCurta(cliente.criado_em))}</dd>
          <dt>Reservas</dt><dd>${cliente.total_reservas} no total, ${cliente.reservas_futuras} futura(s)</dd>
        </dl>
        <h3 class="subtitulo">Últimas reservas</h3>
        ${historico}`,
      rodape: `<button type="button" class="btn btn--ghost" data-fechar>Fechar</button>
               <button type="button" class="btn btn--primary" data-editar>${icone('pencil')}Editar</button>`,
    });
    d.querySelector('[data-editar]').addEventListener('click', () => {
      d.close();
      abrirFormCliente(cliente);
    });
  } catch (erro) {
    toast(erro.message, 'erro');
  }
}

async function desativarCliente(cliente) {
  try {
    const resposta = await api('PUT', `/api/admin/clientes/${cliente.id}`, {
      nome: cliente.nome,
      email: cliente.email,
      ativo: false,
    });
    toast('Cadastro desativado. O histórico foi preservado.');
    if (resposta.reservas_canceladas > 0) {
      toast(`${resposta.reservas_canceladas} reserva(s) futura(s) foram canceladas.`, 'aviso');
    }
    carregarClientes();
  } catch (erro) {
    toast(erro.message, 'erro');
  }
}

async function excluirCliente(id) {
  const cliente = estado.clientes.find((c) => c.id === id);
  if (!cliente) return;

  // Regra de integridade: quem tem reservas no histórico não pode ser excluído
  if (cliente.total_reservas > 0) {
    const d = modal({
      titulo: 'Não é possível excluir',
      corpo: `<p>${esc(cliente.nome)} tem ${cliente.total_reservas} reserva(s) no histórico. Para preservar o histórico de agendamentos, o cadastro não pode ser excluído.</p>
              <p style="margin-top:12px">${cliente.ativo ? 'Você pode desativar o cadastro: o cliente deixa de entrar no sistema e as reservas futuras dele são canceladas.' : 'Este cadastro já está desativado.'}</p>`,
      rodape: `<button type="button" class="btn btn--ghost" data-fechar>Fechar</button>
               ${cliente.ativo ? '<button type="button" class="btn btn--danger" data-desativar>Desativar cadastro</button>' : ''}`,
    });
    d.querySelector('[data-desativar]')?.addEventListener('click', () => {
      d.close();
      desativarCliente(cliente);
    });
    return;
  }

  const ok = await confirmar({
    titulo: 'Excluir cliente?',
    mensagem: `${cliente.nome} (${cliente.email}) será removido definitivamente. Essa ação não pode ser desfeita.`,
    confirmarTexto: 'Excluir cliente',
    cancelarTexto: 'Cancelar',
    perigo: true,
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/admin/clientes/${id}`);
    toast('Cliente excluído.');
  } catch (erro) {
    toast(erro.message, 'erro');
  }
  carregarClientes();
}

$('novo-cliente').addEventListener('click', () => abrirFormCliente());
$('busca-clientes').addEventListener('input', debounce(carregarClientes, 300));
$('tabela-clientes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const id = Number(b.dataset.id);
  if (b.dataset.acao === 'ver') verCliente(id);
  if (b.dataset.acao === 'editar') abrirFormCliente(estado.clientes.find((c) => c.id === id));
  if (b.dataset.acao === 'excluir') excluirCliente(id);
});

/* =====================================================================
   COMPUTADORES
   ===================================================================== */
const OPCOES_STATUS = [
  ['disponivel', 'Disponível'],
  ['manutencao', 'Em manutenção'],
  ['desativado', 'Desativado'],
];

async function carregarComputadores() {
  try {
    const dados = await api('GET', '/api/admin/computadores');
    estado.computadores = dados.computadores;
    renderComputadores();
  } catch (erro) {
    falhaDeCarga($('tabela-computadores'), erro, carregarComputadores);
  }
}

function renderComputadores() {
  const lista = estado.computadores;
  if (!lista.length) {
    $('tabela-computadores').innerHTML = estadoVazio('Nenhum computador cadastrado', 'Use "Novo computador" para cadastrar o primeiro.');
    return;
  }
  $('tabela-computadores').innerHTML = tabela(
    [
      { titulo: 'Computador' },
      { titulo: 'Configuração' },
      { titulo: 'Status' },
      { titulo: 'Reservas futuras' },
      { titulo: 'Ações', classe: 'acoes' },
    ],
    lista.map(
      (c) => `<tr>
        <td><div class="cell-main">${esc(c.nome)}</div></td>
        <td>${esc(c.descricao) || '<span class="cell-sub">Sem descrição</span>'}</td>
        <td>
          <select class="input" data-status-pc="${c.id}" data-status="${c.status}" aria-label="Status de ${esc(c.nome)}">
            ${OPCOES_STATUS.map(([v, r]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td>${c.reservas_futuras}</td>
        <td class="acoes"><button type="button" class="btn btn--ghost btn--sm" data-editar-pc="${c.id}">${icone('pencil')}Editar</button></td>
      </tr>`
    )
  );
}

function abrirFormComputador(pc = null) {
  const editando = Boolean(pc);
  const corpo = `
    <form id="form-pc" novalidate>
      <div class="field">
        <label for="p-nome">Nome ou identificação</label>
        <input class="input" id="p-nome" name="nome" type="text" maxlength="40" placeholder="PC-11" value="${esc(pc?.nome || '')}" required>
        <p class="field-error" id="erro-nome" role="alert"></p>
      </div>
      <div class="field">
        <label for="p-desc">Configuração</label>
        <input class="input" id="p-desc" name="descricao" type="text" maxlength="255" placeholder="Processador, placa de vídeo, memória e monitor" value="${esc(pc?.descricao || '')}">
        <p class="field-error" id="erro-descricao" role="alert"></p>
      </div>
      <div class="field">
        <label for="p-status">Status</label>
        <select class="input" id="p-status" name="status">
          ${OPCOES_STATUS.map(([v, r]) => `<option value="${v}"${(pc?.status || 'disponivel') === v ? ' selected' : ''}>${r}</option>`).join('')}
        </select>
        <p class="field-error" id="erro-status" role="alert"></p>
      </div>
      <div id="form-alerta" style="margin-top:16px"></div>
    </form>`;

  const d = modal({
    titulo: editando ? `Editar ${pc.nome}` : 'Novo computador',
    corpo,
    rodape: `<button type="button" class="btn btn--ghost" data-fechar>Cancelar</button>
             <button type="submit" form="form-pc" class="btn btn--primary">${editando ? 'Salvar alterações' : 'Cadastrar computador'}</button>`,
  });
  const form = d.querySelector('#form-pc');
  const botao = d.querySelector('button[type="submit"]');
  form.querySelector('input').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    form.querySelector('#form-alerta').innerHTML = '';
    const corpoReq = { nome: form.nome.value, descricao: form.descricao.value, status: form.status.value };

    carregando(botao, true);
    try {
      const resposta = editando
        ? await api('PUT', `/api/admin/computadores/${pc.id}`, corpoReq)
        : await api('POST', '/api/admin/computadores', corpoReq);
      d.close();
      toast(editando ? 'Computador atualizado.' : 'Computador cadastrado.');
      avisarReservasFuturas(resposta.computador);
      carregarComputadores();
    } catch (erro) {
      if (erro instanceof ApiErro && erro.campos) mostrarErrosCampos(form, erro.campos);
      else form.querySelector('#form-alerta').innerHTML = alerta('erro', erro.message);
      carregando(botao, false);
    }
  });
}

/** Reservas futuras não são canceladas sozinhas quando a máquina sai de operação: avisa o administrador. */
function avisarReservasFuturas(pc) {
  if (pc && pc.status !== 'disponivel' && pc.reservas_futuras > 0) {
    toast(
      `${pc.nome} tem ${pc.reservas_futuras} reserva(s) futura(s). Elas continuam ativas: cancele na tela Agendamentos, se necessário.`,
      'aviso'
    );
  }
}

$('novo-computador').addEventListener('click', () => abrirFormComputador());
$('tabela-computadores').addEventListener('click', (e) => {
  const b = e.target.closest('[data-editar-pc]');
  if (b) abrirFormComputador(estado.computadores.find((c) => c.id === Number(b.dataset.editarPc)));
});
$('tabela-computadores').addEventListener('change', async (e) => {
  const select = e.target.closest('[data-status-pc]');
  if (!select) return;
  select.disabled = true;
  try {
    const { computador } = await api('PATCH', `/api/admin/computadores/${select.dataset.statusPc}/status`, { status: select.value });
    toast(`${computador.nome}: status alterado para "${OPCOES_STATUS.find(([v]) => v === computador.status)[1]}".`);
    avisarReservasFuturas(computador);
  } catch (erro) {
    toast(erro.message, 'erro');
  }
  carregarComputadores();
});

/* =====================================================================
   AGENDAMENTOS
   ===================================================================== */
async function carregarAgendamentos() {
  const params = new URLSearchParams();
  const data = $('filtro-data').value;
  const busca = $('filtro-busca').value.trim();
  const status = $('filtro-status').value;
  if (data) params.set('data', data);
  if (busca) params.set('busca', busca);
  if (status) params.set('status', status);

  try {
    const dados = await api('GET', `/api/admin/agendamentos${params.toString() ? `?${params}` : ''}`);
    estado.agora = dados.agora;
    renderAgendamentos(dados.agendamentos, Boolean(data || busca || status));
  } catch (erro) {
    falhaDeCarga($('tabela-agendamentos'), erro, carregarAgendamentos);
  }
}

let listaAgendamentos = [];

function renderAgendamentos(lista, filtrado) {
  listaAgendamentos = lista;
  $('contagem-agendamentos').textContent = `${lista.length} ${lista.length === 1 ? 'agendamento' : 'agendamentos'}${lista.length >= 500 ? ' (mostrando os 500 mais recentes)' : ''}`;

  if (!lista.length) {
    $('tabela-agendamentos').innerHTML = filtrado
      ? estadoVazio('Nenhum agendamento encontrado', 'Ajuste ou limpe os filtros para ver mais resultados.')
      : estadoVazio('Nenhum agendamento ainda', 'As reservas feitas pelos clientes aparecem aqui.');
    return;
  }

  $('tabela-agendamentos').innerHTML = tabela(
    [
      { titulo: 'Código' },
      { titulo: 'Cliente' },
      { titulo: 'Computador' },
      { titulo: 'Data' },
      { titulo: 'Horário' },
      { titulo: 'Duração' },
      { titulo: 'Status' },
      { titulo: 'Ação', classe: 'acoes' },
    ],
    lista.map(
      (r) => `<tr>
        <td class="id">#${r.id}</td>
        <td><div class="cell-main">${esc(r.cliente.nome)}</div><div class="cell-sub">${esc(r.cliente.email)}</div></td>
        <td><div class="cell-main">${esc(r.computador.nome)}</div></td>
        <td>${esc(dataCurta(r.data))}<div class="cell-sub">${esc(fmtData(r.data, { weekday: 'long' }))}</div></td>
        <td class="hoje-hora">${horario(r)}</td>
        <td>${esc(duracaoTexto(r.duracao_min))}</td>
        <td>${seloReserva(r)}${r.status === 'cancelado' && r.cancelado_por ? `<div class="cell-sub">por ${r.cancelado_por === 'admin' ? 'administração' : 'cliente'}</div>` : ''}</td>
        <td class="acoes">${
          r.status === 'confirmado'
            ? `<button type="button" class="btn btn--danger btn--sm" data-cancelar="${r.id}">Cancelar</button>`
            : ''
        }</td>
      </tr>`
    )
  );
}

async function cancelarAgendamento(id) {
  const r = listaAgendamentos.find((x) => x.id === id);
  if (!r) return;
  const ok = await confirmar({
    titulo: 'Cancelar este agendamento?',
    mensagem: `${r.cliente.nome} em ${r.computador.nome}, ${dataLonga(r.data)}, das ${r.hora_inicio} às ${r.hora_fim}. O horário volta a ficar livre para outros clientes.`,
    confirmarTexto: 'Cancelar agendamento',
    cancelarTexto: 'Manter',
    perigo: true,
  });
  if (!ok) return;
  try {
    await api('POST', `/api/admin/agendamentos/${id}/cancelar`);
    toast('Agendamento cancelado.');
  } catch (erro) {
    toast(erro.message, 'erro');
  }
  carregarAgendamentos();
}

const recarregarAgendamentosComAtraso = debounce(carregarAgendamentos, 300);
$('filtro-busca').addEventListener('input', recarregarAgendamentosComAtraso);
$('filtro-data').addEventListener('change', carregarAgendamentos);
$('filtro-status').addEventListener('change', carregarAgendamentos);
$('filtros-agendamentos').addEventListener('submit', (e) => e.preventDefault());
$('filtros-agendamentos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-atalho]');
  if (!b || !estado.agora) return;
  const hoje = estado.agora.data;
  const mapa = { hoje, amanha: somarDias(hoje, 1), todas: '' };
  $('filtro-data').value = mapa[b.dataset.atalho];
  carregarAgendamentos();
});
$('tabela-agendamentos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cancelar]');
  if (b) cancelarAgendamento(Number(b.dataset.cancelar));
});

/* =====================================================================
   Navegação (#visao-geral, #clientes, #computadores, #agendamentos)
   ===================================================================== */
const carregadores = {
  'visao-geral': carregarVisaoGeral,
  clientes: carregarClientes,
  computadores: carregarComputadores,
  agendamentos: carregarAgendamentos,
};

function rotear() {
  const alvo = window.location.hash.slice(1);
  const view = VIEWS.includes(alvo) ? alvo : 'visao-geral';
  document.querySelectorAll('[data-view]').forEach((s) => (s.hidden = s.dataset.view !== view));
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const titulos = { 'visao-geral': 'Visão geral', clientes: 'Clientes', computadores: 'Computadores', agendamentos: 'Agendamentos' };
  document.title = `${titulos[view]} | Painel Ping Lounge`;
  carregadores[view]();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', rotear);

api('GET', '/api/auth/eu')
  .then(({ usuario }) => {
    $('admin-nome').textContent = usuario.nome;
    $('admin-email').textContent = usuario.email;
  })
  .catch(() => {});

rotear();
