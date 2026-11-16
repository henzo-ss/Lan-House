/* Página inicial: régua de horários, indicador ao vivo e dados de funcionamento. */
import { esc, capitalizar, fmtData, horaExtenso, paraMin, deMin, duracaoTexto, iniciarMenu, marcarUsuarioLogado, preencherIndicadorAoVivo } from './app.js';

iniciarMenu();
marcarUsuarioLogado();

function desenharRegua(resumo) {
  const el = document.getElementById('ruler');
  if (!el) return;

  const { abre, fecha } = resumo.regras;
  const abreMin = paraMin(abre);
  const fechaMin = paraMin(fecha);
  const total = fechaMin - abreMin;
  const agora = resumo.agora.minutos;
  const pct = (min) => ((min - abreMin) / total) * 100;

  // Marcações de meia em meia hora; rótulo a cada hora cheia
  let marcas = '';
  let rotulos = '';
  let indiceHora = 0;
  for (let m = abreMin; m <= fechaMin; m += 30) {
    const cheia = m % 60 === 0;
    marcas += `<span class="ruler__tick${cheia ? '' : ' is-half'}" style="left:${pct(m)}%"></span>`;
    if (cheia) {
      const primeiro = m === abreMin;
      const ultimo = m === fechaMin;
      const classes = ['ruler__label', primeiro ? 'is-first' : '', ultimo ? 'is-last' : '', indiceHora % 2 ? 'is-alt' : ''].join(' ');
      rotulos += `<span class="${classes}" style="left:${pct(m)}%">${deMin(m).slice(0, 2)}h</span>`;
      indiceHora += 1;
    }
  }

  let passado = 0;
  let marcador = '';
  let situacao;
  if (agora >= fechaMin) {
    passado = 100;
    situacao = `Fechado agora. Abrimos amanhã às ${horaExtenso(abre)}`;
  } else if (agora < abreMin) {
    situacao = `Abrimos hoje às ${horaExtenso(abre)}`;
  } else {
    passado = pct(agora);
    const fim = passado > 82 ? ' is-end' : '';
    marcador = `<span class="ruler__now${fim}" style="left:${passado}%"><span>${esc(deMin(agora))}</span></span>`;
    situacao = `Aberto agora, fechamos às ${horaExtenso(fecha)}`;
  }

  const dia = capitalizar(fmtData(resumo.agora.data, { weekday: 'long', day: 'numeric', month: 'long' }));
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${dia}. Funcionamento das ${horaExtenso(abre)} às ${horaExtenso(fecha)}. ${situacao}.`);
  el.innerHTML = `
    <div class="ruler__head"><span class="ruler__day">${esc(dia)}</span><span>${esc(situacao)}</span></div>
    <div class="ruler__track">
      <div class="ruler__past" style="width:${passado}%"></div>
      ${marcas}${rotulos}${marcador}
    </div>`;
}

function preencherTextos(resumo) {
  const { abre, fecha, dias_antecedencia: dias, cancelamento_min: cancel } = resumo.regras;
  document.querySelectorAll('[data-abre]').forEach((e) => (e.textContent = horaExtenso(abre)));
  document.querySelectorAll('[data-fecha]').forEach((e) => (e.textContent = horaExtenso(fecha)));
  document.querySelectorAll('[data-dias]').forEach((e) => (e.textContent = String(dias)));
  document.querySelectorAll('[data-cancel-texto]').forEach((e) => (e.textContent = duracaoTexto(cancel)));
}

preencherIndicadorAoVivo().then((resumo) => {
  if (!resumo) return;
  desenharRegua(resumo);
  preencherTextos(resumo);
  // Atualiza o marcador de "agora" e as máquinas livres a cada minuto
  setInterval(() => preencherIndicadorAoVivo().then((r) => r && desenharRegua(r)), 60 * 1000);
});
