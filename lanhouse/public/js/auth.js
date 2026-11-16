/* Telas de login e cadastro. */
import { api, ApiErro, alerta, carregando, limparErros, mostrarErrosCampos, ativarAlternarSenha, preencherIndicadorAoVivo } from './app.js';

const form = document.getElementById('form-auth');
const areaAlerta = document.getElementById('alerta');
const tipo = form.dataset.form; // "login" ou "cadastro"
const botao = form.querySelector('button[type="submit"]');

ativarAlternarSenha(form);
preencherIndicadorAoVivo();

// Mensagens vindas da URL (ex.: depois de criar a conta, ou sessão expirada)
const params = new URLSearchParams(window.location.search);
if (tipo === 'login') {
  if (params.get('cadastro') === 'ok') areaAlerta.innerHTML = alerta('ok', 'Conta criada! Entre com seu e-mail e senha para agendar.');
  else if (params.get('sessao') === 'expirada') areaAlerta.innerHTML = alerta('aviso', 'Sua sessão expirou. Entre novamente.');
}

/* Validação rápida no navegador (o servidor valida tudo de novo) */
function validar(dados) {
  const erros = {};
  if (tipo === 'cadastro') {
    const nome = dados.nome.replace(/\s+/g, ' ').trim();
    if (nome.length < 3) erros.nome = 'Informe o nome completo (mínimo de 3 letras).';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email.trim())) erros.email = 'Informe um e-mail válido, como nome@exemplo.com.';
  if (tipo === 'cadastro') {
    if (dados.senha.length < 8) erros.senha = 'A senha precisa ter pelo menos 8 caracteres.';
    else if (!/[A-Za-zÀ-ÿ]/.test(dados.senha) || !/\d/.test(dados.senha)) erros.senha = 'Use letras e números na senha.';
  } else if (!dados.senha) {
    erros.senha = 'Informe a senha.';
  }
  return erros;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErros(form);
  areaAlerta.innerHTML = '';

  const dados = Object.fromEntries(new FormData(form).entries());
  const erros = validar(dados);
  if (Object.keys(erros).length) {
    mostrarErrosCampos(form, erros);
    return;
  }

  carregando(botao, true);
  try {
    if (tipo === 'login') {
      const { destino } = await api('POST', '/api/auth/login', { email: dados.email, senha: dados.senha });
      window.location.href = destino;
    } else {
      await api('POST', '/api/auth/cadastro', { nome: dados.nome, email: dados.email, senha: dados.senha });
      areaAlerta.innerHTML = alerta('ok', 'Conta criada com sucesso! Redirecionando para o login...');
      setTimeout(() => (window.location.href = '/login?cadastro=ok'), 1200);
      return; // mantém o botão bloqueado durante o redirecionamento
    }
  } catch (erro) {
    if (erro instanceof ApiErro && erro.campos) mostrarErrosCampos(form, erro.campos);
    else areaAlerta.innerHTML = alerta('erro', erro.message);
    carregando(botao, false);
  }
});
