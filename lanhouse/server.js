'use strict';

/*
 * Ping Lounge - servidor principal.
 * O Express serve as páginas do site (public/) e a API REST (/api) que conversa com o MySQL.
 *
 * Para rodar:   npm start          (ou como serviço do Windows, veja docs/SERVICO-WINDOWS.md)
 */
const path = require('path');
const { variaveisFaltando } = require('./src/config/env');

// ---- 1) Confere a configuração antes de iniciar, com mensagem clara para quem está implantando ----
const obrigatorias = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
const faltando = variaveisFaltando(obrigatorias);
if (process.env.DB_PASSWORD === undefined) faltando.push('DB_PASSWORD');
if (faltando.length) {
  console.error(`[config] Variáveis ausentes no arquivo .env: ${faltando.join(', ')}.`);
  console.error('[config] Copie .env.example para .env e preencha os valores.');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('[config] SESSION_SECRET precisa ter pelo menos 32 caracteres. Veja o comando para gerar no .env.example.');
  process.exit(1);
}

const express = require('express');
const cookieSession = require('cookie-session');
const { pool, testarConexao } = require('./src/config/db');
const { cabecalhosDeSeguranca, exigirRequisicaoDoSite, semCache } = require('./src/middleware/seguranca');
const { paginaExigirCliente, paginaExigirAdmin, paginaApenasVisitante } = require('./src/middleware/auth');
const { tratadorDeErros } = require('./src/utils/erros');
const { concluirVencidas } = require('./src/controllers/reservas');
const rotasPublicas = require('./src/routes/publico');
const rotasCliente = require('./src/routes/cliente');
const rotasAdmin = require('./src/routes/admin');

const PORTA = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLICO = path.join(__dirname, 'public');
const SESSAO_HORAS = Number(process.env.SESSAO_HORAS || 12);

const app = express();
app.disable('x-powered-by');
app.use(cabecalhosDeSeguranca);
app.use(express.json({ limit: '50kb' }));

// ---- 2) Sessão: cookie assinado com SESSION_SECRET (guarda só o id do usuário) ----
app.use(
  cookieSession({
    name: 'ping.sid',
    keys: [process.env.SESSION_SECRET],
    maxAge: SESSAO_HORAS * 60 * 60 * 1000,
    httpOnly: true, // JavaScript do navegador não consegue ler o cookie
    sameSite: 'lax', // não é enviado em requisições vindas de outros sites
    secure: process.env.COOKIE_SECURE === 'true', // true só se o site usar HTTPS
    path: '/',
  })
);

// ---- 3) Arquivos estáticos. As páginas HTML NÃO são servidas diretamente: passam pelas rotas abaixo ----
app.use('/css', express.static(path.join(PUBLICO, 'css')));
app.use('/js', express.static(path.join(PUBLICO, 'js')));
app.use('/images', express.static(path.join(PUBLICO, 'images')));
app.use('/fonts', express.static(path.join(PUBLICO, 'fonts'))); // opcional: fontes hospedadas localmente (veja o README)
app.get('/favicon.ico', (req, res) => res.redirect(301, '/images/favicon.svg'));

// ---- 4) API ----
app.use('/api', exigirRequisicaoDoSite);
app.use('/api', rotasPublicas);
app.use('/api', rotasCliente);
app.use('/api/admin', rotasAdmin);
app.use('/api', (req, res) => res.status(404).json({ erro: 'Recurso não encontrado.' }));

// ---- 5) Páginas ----
const pagina = (arquivo) => (req, res) => res.sendFile(path.join(PUBLICO, 'pages', arquivo));

app.get('/', pagina('index.html'));
app.get('/login', semCache, paginaApenasVisitante, pagina('login.html'));
app.get('/cadastro', semCache, paginaApenasVisitante, pagina('cadastro.html'));
app.get('/agendar', semCache, paginaExigirCliente, pagina('cliente.html'));
app.get('/admin', semCache, paginaExigirAdmin, pagina('admin.html'));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLICO, 'pages', '404.html')));

app.use(tratadorDeErros);

// ---- 6) Inicialização ----
const servidor = app.listen(PORTA, HOST, () => {
  console.log(`[ok] Ping Lounge no ar em http://${HOST}:${PORTA}  (${new Date().toISOString()})`);
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') console.error(`[erro] A porta ${PORTA} já está em uso. Troque PORT no .env.`);
  else if (erro.code === 'EACCES') console.error(`[erro] Sem permissão para usar a porta ${PORTA}.`);
  else console.error('[erro] Falha ao iniciar o servidor:', erro.message);
  process.exit(1);
});

// O site sobe mesmo que o MySQL ainda não esteja pronto (ex.: VM 2 iniciando); o pool reconecta sozinho
testarConexao()
  .then(() => console.log(`[ok] MySQL acessível em ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`))
  .catch((erro) =>
    console.warn(
      `[aviso] MySQL inacessível em ${process.env.DB_HOST}:${process.env.DB_PORT || 3306} (${erro.code || erro.message}). ` +
        'O site abre, mas login e agendamento só funcionam quando o banco responder.'
    )
  );

// Marca como "concluído" as reservas que já terminaram (a cada minuto)
const faxina = setInterval(() => {
  concluirVencidas().catch((erro) => console.warn(`[aviso] não foi possível concluir reservas vencidas: ${erro.code || erro.message}`));
}, 60 * 1000);
faxina.unref();

// Encerramento limpo (o NSSM envia o sinal ao parar/reiniciar o serviço)
function encerrar(sinal) {
  console.log(`[info] ${sinal} recebido. Encerrando...`);
  servidor.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

process.on('unhandledRejection', (motivo) => console.error('[erro] Promise rejeitada sem tratamento:', motivo));
