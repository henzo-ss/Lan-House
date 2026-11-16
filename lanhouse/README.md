# Ping Lounge: agendamento e gerenciamento de lan house

Sistema web para uma lan house: o cliente se cadastra, entra e **reserva um computador** em data e horário escolhidos; o administrador gerencia **clientes, computadores e agendamentos** em um painel próprio.

Projeto acadêmico (desafio AC4). Stack obrigatória, sem nada além dela:

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3 e JavaScript puro (módulos ES), **sem build** |
| Backend | Node.js + Express |
| Banco de dados | **MySQL** (consultas parametrizadas, transações) |

**Dependências npm (apenas 5):**

| Pacote | Para quê |
|---|---|
| `express` | servidor web e rotas da API |
| `mysql2` | conexão com o MySQL (usa *prepared statements*) |
| `bcryptjs` | hash de senhas (algoritmo bcrypt em JavaScript puro, sem compilar nada no Windows Server) |
| `cookie-session` | sessão por cookie assinado (guarda apenas o id do usuário) |
| `dotenv` | leitura do arquivo `.env` com as credenciais |

---

## Guias

| Guia | Conteúdo |
|---|---|
| **Este README** | Execução local, regras, segurança, verificação e sugestão de prints |
| [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) | Implantação nas **duas VMs** (Windows Server + MySQL em outra VM), rede, firewall e testes |
| [docs/SERVICO-WINDOWS.md](docs/SERVICO-WINDOWS.md) | Node.js como **serviço do Windows** (NSSM), logs e teste com o VS Code fechado |

---

## Estrutura do projeto

```
lanhouse/
├── server.js                 Servidor Express (páginas, API, sessão, encerramento limpo)
├── package.json
├── .env.example              Todas as variáveis, comentadas (copie para .env)
├── .gitignore
├── database/
│   ├── script.sql            Banco, tabelas, chaves, índices, restrições e 10 computadores de demonstração
│   ├── criar-admin.js        Cria o administrador inicial (senha em hash bcrypt)
│   └── testar-conexao.js     Diagnóstico da ligação VM 1 → VM 2
├── src/
│   ├── config/               db.js (pool MySQL), regras.js (horários e limites), env.js
│   ├── middleware/           auth.js (perfis), seguranca.js (cabeçalhos e CSRF)
│   ├── controllers/          auth.js, reservas.js, admin.js
│   ├── routes/               publico.js, cliente.js, admin.js
│   └── utils/                tempo.js, validacao.js, erros.js
├── public/
│   ├── pages/                index, login, cadastro, cliente (agendamento), admin, 404
│   ├── css/                  base.css, site.css, cliente.css, admin.css
│   ├── js/                   app.js (comum), home, auth, cliente, admin
│   └── images/               icons.svg, favicon.svg, hero-setup.svg
├── tests/
│   ├── logica.test.js        Testes de datas, horários e validação (npm test)
│   └── concorrencia.js       Teste de reservas simultâneas (precisa do MySQL real)
└── docs/                     Guias de implantação
```

---

## Execução local (no seu computador)

**Requisitos:** Node.js 18 ou superior (recomendado o LTS atual) e um MySQL 8 acessível (instalado na própria máquina ou na VM 2).

```powershell
# 1. Dependências
cd lanhouse
npm install

# 2. Banco de dados (como root do MySQL; cria o banco "lanhouse" e as tabelas)
mysql -u root -p < database/script.sql
#   No Windows, se "mysql" não estiver no PATH:
#   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "source database/script.sql"

# 3. Usuário do banco para a aplicação (no console do MySQL)
#    CREATE USER 'lanhouse_app'@'localhost' IDENTIFIED BY 'SuaSenhaForte1';
#    GRANT SELECT, INSERT, UPDATE, DELETE ON lanhouse.* TO 'lanhouse_app'@'localhost';

# 4. Configuração
Copy-Item .env.example .env        # no Linux/macOS: cp .env.example .env
#    edite o .env: DB_HOST=127.0.0.1, DB_USER, DB_PASSWORD e SESSION_SECRET
#    gerar o segredo:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5. Conferir a ligação com o banco
npm run testar-conexao

# 6. Criar o administrador inicial (pergunta nome, e-mail e senha)
npm run criar-admin

# 7. Iniciar
npm start
```

Abra <http://localhost:3000>. Entre com o administrador em `/login` para acessar o painel; clientes se cadastram em `/cadastro`.

Comandos úteis: `npm run dev` (reinicia ao salvar), `npm test` (testes da lógica).

### Como o administrador inicial é criado

O administrador **não** é criado pelo SQL (para não guardar senha em arquivo) e **não existe cadastro público de administrador**: a rota de cadastro sempre cria `perfil = 'cliente'`. O administrador nasce apenas pelo comando `npm run criar-admin`, executado no servidor. A senha é gravada somente como hash bcrypt. Para uso sem perguntas (script), defina `ADMIN_NOME`, `ADMIN_EMAIL` e `ADMIN_SENHA` no terminal antes de executar.

---

## Regras de negócio

Valores padrão (todos ajustáveis no `.env`):

| Regra | Padrão |
|---|---|
| Funcionamento | 10:00 às 23:00, todos os dias (`LH_ABERTURA`, `LH_FECHAMENTO`) |
| Horários de início | de 30 em 30 minutos |
| Durações | 1 h, 1 h 30, 2 h, 3 h e 4 h; a reserva termina até o fechamento |
| Antecedência máxima | 14 dias (`DIAS_ANTECEDENCIA`) |
| Reserva no passado | **recusada** pelo servidor |
| Mesmo computador, períodos que se sobrepõem | **recusado** (HTTP 409); reservas "coladas" (uma termina quando a outra começa) são permitidas |
| Computador em manutenção ou desativado | não aceita novas reservas |
| Limite por cliente | 5 reservas confirmadas futuras (`MAX_RESERVAS_ATIVAS`) |
| Cancelamento pelo cliente | até 60 minutos antes do início (`CANCELAMENTO_ANTECEDENCIA_MIN`) |
| Cancelamento pelo administrador | a qualquer momento, enquanto a reserva não terminou |
| Status de reserva | `confirmado`, `cancelado`, `concluido` (a mudança para concluído é automática, a cada minuto) |

**Clientes (integridade dos agendamentos):**

- **Excluir** só é permitido para cliente **sem nenhuma reserva** (nem no histórico). Com reservas, o sistema explica e oferece **desativar o cadastro**.
- **Desativar** bloqueia o login, preserva o histórico e cancela as reservas futuras daquele cliente.
- As chaves estrangeiras usam `ON DELETE RESTRICT`: mesmo uma falha de código não consegue apagar um cliente ou computador que tenha reservas.
- O painel lista e altera **apenas** clientes: contas de administrador nunca aparecem nessas telas.

**Computadores:** ao colocar uma máquina em manutenção ou desativá-la, as reservas futuras **não** são canceladas automaticamente (o administrador é avisado da quantidade e decide, na tela Agendamentos).

### Como o conflito de horários é impedido (inclusive em requisições simultâneas)

A criação da reserva roda em uma **transação** no MySQL que, antes de verificar conflitos, **trava a linha do computador** (`SELECT ... FOR UPDATE`). Se dois clientes tentam a mesma máquina no mesmo instante, o segundo espera o primeiro concluir e então enxerga a reserva dele, sendo recusado. A checagem de sobreposição é: `inicio_existente < fim_novo` **e** `fim_existente > inicio_novo`. A mesma transação trava o cliente para garantir o limite de reservas ativas.

---

## Segurança implementada

| Cuidado | Onde |
|---|---|
| Senhas com bcrypt (nunca em texto puro) | `src/controllers/auth.js`, `admin.js` |
| Consultas SQL parametrizadas (`execute`, *prepared statements*) | todos os controllers |
| Validação no backend (nome, e-mail, senha, datas, horários, status) | `src/utils/validacao.js`, `reservas.js` |
| Controle de acesso por perfil, **conferido no banco a cada requisição** | `src/middleware/auth.js` |
| Rotas `/api/admin/*` e página `/admin` bloqueadas para clientes (403/redirecionamento) | `routes/admin.js`, `server.js` |
| Cliente só enxerga as **próprias** reservas (outras retornam 404) | `reservas.js` |
| Cookie `HttpOnly`, `SameSite=Lax`, `Secure` configurável | `server.js` |
| Proteção contra CSRF (cabeçalho `X-Requested-With` + `SameSite`) | `middleware/seguranca.js` |
| Limite de tentativas de login (5 por 15 min, por IP e e-mail) e tempo de resposta igualado para e-mail inexistente | `controllers/auth.js` |
| Cabeçalhos de segurança e Content-Security-Policy (scripts só do próprio site) | `middleware/seguranca.js` |
| Mensagens de erro sem detalhes internos; detalhes só no log do servidor | `utils/erros.js` |
| Credenciais somente em variáveis de ambiente | `.env` (fora do Git) |
| Usuário do MySQL com privilégios mínimos, restrito ao IP da VM 1 | guia de implantação |

**Limitações assumidas (escopo acadêmico):** a sessão é um cookie assinado (não há como invalidá-la no servidor antes do vencimento, mas o usuário é revalidado no banco a cada requisição, então desativar ou excluir uma conta bloqueia o acesso imediatamente); o limite de tentativas de login fica em memória (zera ao reiniciar o serviço); o site roda em HTTP no IP da VM (para HTTPS, coloque um certificado e use `COOKIE_SECURE=true`).

---

## API (resumo)

| Método e rota | Acesso | Função |
|---|---|---|
| `GET /api/saude` | público | Aplicação e banco respondendo |
| `GET /api/publico/resumo` | público | Máquinas livres agora e horário de funcionamento (só números) |
| `POST /api/auth/cadastro` · `login` · `logout` | público | Cadastro (sempre cliente), entrada e saída |
| `GET /api/auth/eu` | logado | Usuário da sessão |
| `GET /api/disponibilidade?data=` | cliente | Computadores e horários ocupados do dia |
| `GET/POST /api/reservas` · `GET /api/reservas/:id` · `POST /api/reservas/:id/cancelar` | cliente | Minhas reservas |
| `/api/admin/clientes` (GET, POST, GET/PUT/DELETE `:id`) | admin | Gestão de clientes |
| `/api/admin/computadores` (GET, POST, PUT `:id`, PATCH `:id/status`) | admin | Gestão de computadores |
| `GET /api/admin/agendamentos?data=&busca=&status=` · `POST .../:id/cancelar` | admin | Consulta e cancelamento |
| `GET /api/admin/resumo` | admin | Indicadores e agenda do dia |

---

## Personalização

- **Nome, endereço, telefone e e-mail** da lan house: estão no `public/pages/index.html` (os dados de contato são **exemplos**: troque pelos reais). As **especificações** das máquinas na página inicial e as descrições do `database/script.sql` também são exemplos.
- **Foto de destaque:** a página inicial e as telas de login usam uma ilustração (`public/images/hero-setup.svg`). Para usar uma **fotografia real da sua lan house ou de um ambiente gamer**, salve-a como `public/images/hero.jpg` (sugestão: 1600 × 1280 px, proporção 5:4, até 400 KB). Ela passa a cobrir a ilustração automaticamente, sem alterar código. Use imagens suas ou de bancos com licença livre.
- **Cores e fontes:** variáveis no início de `public/css/base.css`.
- **Fontes sem internet:** o site usa a fonte *Archivo* do Google Fonts (carregada no navegador de quem acessa). Sem internet, ele funciona com fontes do sistema (no Windows, a Bahnschrift). Para hospedar a fonte localmente: baixe a *Archivo* variável em <https://fonts.google.com/specimen/Archivo>, salve em `public/fonts/Archivo-Variable.woff2`, adicione ao `base.css`:
  ```css
  @font-face { font-family: "Archivo"; src: url("/fonts/Archivo-Variable.woff2") format("woff2");
               font-weight: 100 900; font-stretch: 62% 125%; font-display: swap; }
  ```
  e remova as três linhas `<link>` do Google Fonts dos arquivos `.html`.
- **Horário de funcionamento e regras:** variáveis do `.env`.

---

## Identidade visual

Conceito **Gaming Lounge Premium**: fundo azul-marinho, **uma única cor de destaque** (verde-limão, usada em ações e na disponibilidade), tipografia *Archivo* (títulos na versão expandida e pesada), bordas discretas, cantos de 6 a 10 px, ícones de traço único e animações curtas (respeitam a preferência de "menos movimento" do sistema). A **régua de horários** é o elemento de assinatura: aparece na página inicial (funcionamento do dia e "agora"), na linha do tempo do agendamento e nas faixas de cada computador. O painel administrativo usa a mesma identidade com organização funcional (barra lateral, tabelas, filtros).

> **Sobre as referências visuais** (Siteinspire, Land-book, Mobbin, Behance, Dribbble, Awwwards): durante o desenvolvimento, **não foi possível analisar visualmente esses portais** (as ferramentas disponíveis retornaram apenas texto, sem as imagens dos projetos). Por isso a identidade foi construída a partir das diretrizes do briefing, e não de uma análise de referências. Se a equipe quiser citar referências no trabalho, faça essa pesquisa manualmente.

---

## Verificação: o que foi testado e o que precisa ser testado por vocês

**Realizado durante o desenvolvimento (sem MySQL e sem as duas VMs, que não estavam disponíveis):**

- Verificação de sintaxe de todos os arquivos JavaScript.
- `npm test`: 16 testes da lógica pura (fuso e datas, conversão de horários, antecedência de cancelamento, regra de sobreposição, validação de cadastro, computadores e identificadores). Aprovados.
- Telas do frontend executadas em navegador (Chromium sem interface) contra respostas de exemplo: página inicial, login e cadastro com mensagens de erro, fluxo completo de agendamento (data, computador, horário, duração, confirmação), Minhas reservas e detalhes, painel (visão geral, clientes com bloqueio de exclusão, computadores, agendamentos com filtro) e versões de celular. Nenhum erro de JavaScript; foram corrigidos os defeitos visuais encontrados.

**NÃO foi executado por mim e precisa ser verificado por vocês** (o backend com MySQL real, o Express, o `bcryptjs` e as duas VMs não puderam ser executados no ambiente de desenvolvimento):

| Verificação | Como |
|---|---|
| Instalação e subida do servidor | `npm install` e `npm start` |
| Script SQL sem erros | executar `database/script.sql` |
| Cadastro grava no MySQL com hash bcrypt | `SELECT id, nome, email, perfil FROM usuarios;` |
| Login de cliente e de administrador, redirecionamentos | pelo navegador |
| Cliente comum **não** acessa `/admin` nem `/api/admin/*` | digitar `/admin` logado como cliente; deve redirecionar |
| Agendamento grava, cancelamento muda o status | `SELECT * FROM agendamentos;` |
| Reservas simultâneas no mesmo horário | `node tests/concorrencia.js http://localhost:3000 clienteA@x.com:Senha1 clienteB@x.com:Senha2` deve terminar em **APROVADO** |
| Exclusão de cliente com reservas é bloqueada | pelo painel |
| Duas VMs, firewall, acesso pelo IP, serviço do Windows, reinício | guias em `docs/` (listas de verificação ao final) |

Registrem o resultado real de cada item nos prints; marque como concluído apenas o que foi de fato executado.

---

## Sugestão de capturas de tela para o PowerPoint

Siga a ordem do desenvolvimento e da implantação:

1. **Página inicial** do site (topo com a régua de horários e, em outra captura, a seção de estrutura).
2. **Tela de cadastro**, uma captura com erros de validação e outra com a mensagem de sucesso.
3. **Cliente cadastrado no MySQL** (`SELECT id, nome, email, perfil, criado_em FROM usuarios;`, sem a coluna `senha_hash`; opcionalmente outra captura só com o início do hash para mostrar que não é texto puro).
4. **Tela de login** (e a mensagem de erro de senha incorreta).
5. **Tela de agendamento** com data, computador, horário e duração escolhidos, e a **reserva confirmada**.
6. **Minhas reservas** (próximas e detalhes) e um **cancelamento**.
7. **Reserva gravada no MySQL** (`SELECT * FROM agendamentos;`).
8. **Painel administrativo**: visão geral.
9. **Gerenciamento de clientes** (lista, busca, formulário, bloqueio de exclusão com histórico).
10. **Gerenciamento de computadores** (alteração de status) e **visualização de agendamentos** (filtro por data e cancelamento).
11. **Teste de reservas simultâneas** (`node tests/concorrencia.js ...` com resultado **APROVADO**).
12. **As duas máquinas virtuais em funcionamento** (gerenciador de VMs e `ipconfig` de cada uma).
13. **Configuração da conexão entre as VMs**: `Test-NetConnection ... -Port 3306`, regra de firewall e `npm run testar-conexao`.
14. **Website acessado pelo endereço IP do Windows Server** em outro computador (barra de endereço visível, `http://IP:3000`).
15. **Serviço do Windows**: `Get-Service PingLounge` (`Running`, `Automatic`) e a configuração do NSSM.
16. **Aplicação funcionando com o VS Code fechado** (e depois de reiniciar a VM 1), com a data e a hora visíveis.

---

## Licença e créditos

Projeto de uso acadêmico. Fonte Archivo (SIL Open Font License) via Google Fonts. Ícones desenhados para este projeto.
