# Guia de implantação nas duas VMs

Este guia leva o projeto do zero até o funcionamento em duas máquinas virtuais **Windows Server**:

| | VM 1 (aplicação) | VM 2 (banco de dados) |
|---|---|---|
| Sistema | Windows Server | Windows Server |
| Instalado | Node.js, projeto Ping Lounge | MySQL 8 |
| IP de exemplo | `192.168.56.10` | `192.168.56.20` |
| Porta | 3000 (site) | 3306 (MySQL) |

> Os IPs acima são **exemplos**. Troque pelos IPs reais das suas VMs em todos os comandos.
> Execute os comandos `PowerShell` em um PowerShell aberto **como Administrador**.

O caminho dos dados é: `Navegador → VM 1 (Node/Express, porta 3000) → VM 2 (MySQL, porta 3306)`.

---

## Parte 1. Rede entre as duas VMs

As duas VMs precisam se enxergar. A forma mais simples é colocá-las na **mesma rede virtual privada**:

- **VirtualBox:** adaptador em "Rede Host-Only" (ou "Rede Interna") nas duas VMs.
- **Hyper-V:** um *Virtual Switch* do tipo "Internal" ou "Private" ligado às duas VMs.
- **VMware:** adaptador "Host-only" ou "LAN Segment".

Para baixar instaladores e pacotes npm, a VM 1 também precisa de internet. Se a rede privada não tiver saída, adicione um segundo adaptador em **NAT** só para a instalação (ou baixe os instaladores no seu computador e copie para a VM).

### 1.1 IP fixo em cada VM

Descubra o nome da placa de rede:

```powershell
Get-NetAdapter
```

Na **VM 2** (troque `Ethernet 2` pelo nome da sua placa da rede privada):

```powershell
New-NetIPAddress -InterfaceAlias "Ethernet 2" -IPAddress 192.168.56.20 -PrefixLength 24
```

Na **VM 1**:

```powershell
New-NetIPAddress -InterfaceAlias "Ethernet 2" -IPAddress 192.168.56.10 -PrefixLength 24
```

Se já existir um IP automático na placa, remova-o antes ou use a janela gráfica (`ncpa.cpl` → Propriedades → IPv4).

### 1.2 Permitir ping (apenas para testar a rede)

O Windows Server bloqueia ping por padrão. Nas **duas** VMs:

```powershell
New-NetFirewallRule -DisplayName "Permitir ping (ICMPv4)" -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -Profile Any
```

Na VM 1, teste:

```powershell
ping 192.168.56.20
```

Se não responder, revise o tipo de rede virtual das duas VMs (tem de ser a mesma) e os IPs.

> **Print para o PowerPoint:** resultado do `ipconfig` nas duas VMs e do `ping` entre elas.

---

## Parte 2. VM 2: instalar e configurar o MySQL

### 2.1 Instalar o MySQL 8

1. Baixe o **MySQL Installer** (Community) em <https://dev.mysql.com/downloads/installer/>.
2. Escolha o tipo **Custom** e marque apenas o **MySQL Server 8.x** (o Workbench é opcional).
3. Na configuração do servidor:
   - **Type and Networking:** *Server Computer*, TCP/IP, porta **3306**. **Desmarque** "Open Windows Firewall ports for network access" (vamos criar uma regra mais restrita no passo 2.4).
   - **Authentication:** use o método padrão recomendado (senha forte).
   - **Accounts:** defina a senha do `root` (guarde em local seguro).
   - **Windows Service:** deixe **marcado** "Start the MySQL Server at System Startup". Anote o nome do serviço (normalmente `MySQL80`).
4. Conclua a instalação.

Confirme que o serviço está rodando e inicia sozinho:

```powershell
Get-Service MySQL*
Set-Service MySQL80 -StartupType Automatic
```

(Se o nome do seu serviço for outro, use o que aparecer no primeiro comando.)

### 2.2 Criar o banco e as tabelas

Copie a pasta `database` do projeto para a VM 2 (por exemplo, `C:\lanhouse-db\script.sql`) e execute, no **CMD** ou PowerShell:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "source C:/lanhouse-db/script.sql"
```

O script cria o banco `lanhouse`, as tabelas `usuarios`, `computadores` e `agendamentos` (com chaves, índices e restrições) e os 10 computadores de demonstração. Ele pode ser executado de novo sem apagar dados.

### 2.3 Criar o usuário da aplicação (nunca use o root)

Entre no MySQL:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

E execute (troque o IP pelo da **VM 1** e escolha uma senha forte):

```sql
CREATE USER 'lanhouse_app'@'192.168.56.10' IDENTIFIED BY 'TroqueEstaSenhaForte#2026';
GRANT SELECT, INSERT, UPDATE, DELETE ON lanhouse.* TO 'lanhouse_app'@'192.168.56.10';
SHOW GRANTS FOR 'lanhouse_app'@'192.168.56.10';
EXIT;
```

Esse usuário só consegue conectar **a partir da VM 1** e só manipula dados do banco `lanhouse`. Ele não cria nem apaga tabelas.

### 2.4 Liberar o acesso remoto apenas para a VM 1

O MySQL no Windows já escuta em todas as interfaces por padrão. Para ser mais restritivo, edite o arquivo `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` (pasta oculta), na seção `[mysqld]`:

```ini
bind-address=192.168.56.20
port=3306
```

Reinicie o serviço:

```powershell
Restart-Service MySQL80
```

Agora o firewall: remova qualquer regra genérica do MySQL criada pelo instalador e crie uma regra que aceita **somente o IP da VM 1**:

```powershell
Get-NetFirewallRule -DisplayName "*MySQL*" | Select-Object DisplayName, Enabled, Direction
# se existir regra genérica de entrada, desative:  Disable-NetFirewallRule -DisplayName "NOME DA REGRA"

New-NetFirewallRule -DisplayName "MySQL 3306 somente da VM1" -Direction Inbound -Protocol TCP -LocalPort 3306 -RemoteAddress 192.168.56.10 -Action Allow -Profile Any
```

> **Print para o PowerPoint:** `Get-Service MySQL*` (Running/Automatic), o `SHOW GRANTS` e a regra de firewall criada.

---

## Parte 3. VM 1: preparar o Windows Server e instalar o Node.js

### 3.1 Instalar o Node.js

1. Baixe o instalador **LTS** (`.msi`, 64 bits) em <https://nodejs.org/>.
2. Instale com as opções padrão (mantenha marcada a opção que adiciona o Node ao **PATH**).
3. Abra um **novo** PowerShell e confira:

```powershell
node -v
npm -v
where.exe node
```

Anote o caminho do `node.exe` (normalmente `C:\Program Files\nodejs\node.exe`): será usado no serviço do Windows.

> Se o PowerShell reclamar de "execução de scripts desabilitada" ao usar `npm`, rode `npm.cmd` no lugar de `npm` ou use o **CMD**.

### 3.2 Liberar a porta do site no firewall

```powershell
New-NetFirewallRule -DisplayName "Ping Lounge (HTTP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any
```

(Se preferir acessar apenas por `http://IP`, use a porta 80 no `.env` e na regra, desde que o IIS não esteja usando essa porta.)

---

## Parte 4. VM 1: transferir o projeto e instalar as dependências

### 4.1 Transferir os arquivos

Copie o arquivo `lanhouse.zip` para a VM 1 (arrastar e soltar pela conexão de Área de Trabalho Remota, pasta compartilhada da VM ou pendrive virtual) e extraia em `C:\lanhouse`:

```powershell
Expand-Archive -Path C:\Users\Administrator\Downloads\lanhouse.zip -DestinationPath C:\ -Force
cd C:\lanhouse
dir
```

Você deve ver `server.js`, `package.json`, `.env.example`, as pastas `public`, `src`, `database` etc.

### 4.2 Instalar as dependências

```powershell
cd C:\lanhouse
npm install --omit=dev
```

São apenas 5 pacotes: `express`, `mysql2`, `bcryptjs`, `cookie-session` e `dotenv`. Nenhum exige compilador (o `bcryptjs` é a implementação em JavaScript puro do bcrypt, o que evita falhas de instalação no Windows Server).

### 4.3 Configurar o arquivo .env

```powershell
Copy-Item .env.example .env
notepad .env
```

Preencha, no mínimo:

| Variável | Valor |
|---|---|
| `DB_HOST` | IP da **VM 2** (ex.: `192.168.56.20`) |
| `DB_USER` | `lanhouse_app` |
| `DB_PASSWORD` | a senha definida no passo 2.3 |
| `DB_NAME` | `lanhouse` |
| `SESSION_SECRET` | texto aleatório de 32+ caracteres (gere com o comando abaixo) |
| `COOKIE_SECURE` | `false` (o site é acessado por `http://IP`, sem HTTPS) |

Para gerar o `SESSION_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Cole o resultado no `.env`. As demais variáveis têm explicação em comentários dentro do próprio arquivo.

> Nunca envie o `.env` para o Git nem o mostre nos prints. No PowerPoint, mostre o `.env.example`.

---

## Parte 5. Testar a conexão entre as VMs

### 5.1 A porta está acessível?

Na VM 1:

```powershell
Test-NetConnection 192.168.56.20 -Port 3306
```

O campo `TcpTestSucceeded` deve ser `True`.

### 5.2 A aplicação consegue entrar no MySQL?

```powershell
cd C:\lanhouse
npm run testar-conexao
```

Saída esperada (valores variam):

```
Tentando conectar em 192.168.56.20:3306 como "lanhouse_app" (banco "lanhouse")...
Conexão OK. MySQL 8.0.x, banco em uso: lanhouse
  tabela usuarios: 0 registro(s)
  tabela computadores: 10 registro(s)
  tabela agendamentos: 0 registro(s)
```

Se falhar, o próprio comando indica a causa provável. Veja também a tabela de problemas no fim deste guia.

> **Print para o PowerPoint:** `Test-NetConnection` com `True` e a saída do `npm run testar-conexao`.

### 5.3 Criar o administrador inicial

```powershell
npm run criar-admin
```

Informe nome, e-mail e senha (a senha não aparece enquanto você digita). Ela é gravada apenas como hash bcrypt, nunca em texto puro. Rodar de novo com o mesmo e-mail **redefine** a senha desse administrador.

---

## Parte 6. Executar a aplicação e verificar pelo navegador

Para o primeiro teste, rode em primeiro plano:

```powershell
cd C:\lanhouse
npm start
```

Você deve ver:

```
[ok] Ping Lounge no ar em http://0.0.0.0:3000
[ok] MySQL acessível em 192.168.56.20:3306
```

Verifique, nesta ordem:

1. Na própria VM 1: `http://localhost:3000` abre a página inicial.
2. No navegador do **seu computador** (fora da VM): `http://192.168.56.10:3000` abre a página inicial. Isso comprova o acesso pelo IP da VM da aplicação.
3. `http://192.168.56.10:3000/api/saude` responde `{"aplicacao":"ok","banco":"ok"}`. Isso comprova a comunicação VM 1 → VM 2.
4. Em `/cadastro`, crie um cliente e depois consulte no MySQL (VM 2):

```sql
USE lanhouse;
SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios;
```

   A coluna `senha_hash` começa com `$2a$` ou `$2b$` (hash bcrypt). Não mostre essa coluna no print.
5. Entre como cliente em `/login`, faça uma reserva e confira no MySQL:

```sql
SELECT id, usuario_id, computador_id, inicio, fim, status FROM agendamentos;
```

6. Entre como administrador e percorra Clientes, Computadores e Agendamentos.

Pare o `npm start` com `Ctrl + C`. O passo seguinte coloca a aplicação para rodar sozinha, sem terminal aberto.

---

## Parte 7. Rodar como serviço do Windows (VS Code fechado)

Siga o guia **[SERVICO-WINDOWS.md](SERVICO-WINDOWS.md)**. Ao final dele, a aplicação inicia junto com o Windows Server, reinicia sozinha em caso de falha e continua funcionando com o VS Code, o terminal e a sessão de Área de Trabalho Remota fechados.

---

## Parte 8. Lista de verificação final

Marque cada item **somente depois de ter realizado o teste**:

- [ ] As duas VMs têm IP fixo e se enxergam (`ping`).
- [ ] O serviço MySQL na VM 2 está `Running` e `Automatic`.
- [ ] `Test-NetConnection ... -Port 3306` dá `True` na VM 1.
- [ ] O firewall da VM 2 aceita a porta 3306 apenas do IP da VM 1.
- [ ] `npm run testar-conexao` mostra as 3 tabelas.
- [ ] O site abre por `http://IP-DA-VM1:3000` em outro computador.
- [ ] Cadastro grava o cliente no MySQL, com `senha_hash` em bcrypt.
- [ ] Login de cliente leva à área do cliente; login de administrador leva ao painel.
- [ ] Um cliente comum que digita `/admin` na barra de endereço é redirecionado.
- [ ] A reserva grava na tabela `agendamentos`; o cancelamento muda o status para `cancelado`.
- [ ] `node tests/concorrencia.js` termina em **APROVADO** (veja o README).
- [ ] O serviço `PingLounge` está `Running` e `Automatic`.
- [ ] Após **reiniciar a VM 1** (e a VM 2), o site volta sem abrir nenhum terminal.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ECONNREFUSED` ao testar a conexão | Serviço MySQL parado, porta errada ou `bind-address` em `127.0.0.1` | `Get-Service MySQL*` na VM 2; confira `my.ini` e reinicie o serviço |
| `ETIMEDOUT` | Firewall da VM 2 bloqueando ou VMs em redes diferentes | Revise a regra da porta 3306 (IP de origem correto) e a rede virtual |
| `ER_ACCESS_DENIED_ERROR` | Senha errada, ou usuário criado para outro IP | Confira `DB_USER`/`DB_PASSWORD`; o usuário deve ser `'lanhouse_app'@'IP-DA-VM1'` |
| `ER_BAD_DB_ERROR` | Banco não criado | Execute o `database/script.sql` (passo 2.2) |
| Erro de autenticação/plugin ao conectar | Incompatibilidade de método de senha do usuário | Recrie o usuário do passo 2.3 no MySQL 8 padrão; veja a mensagem completa no log da aplicação |
| Site não abre de outro computador | Regra de firewall da VM 1 ausente ou `HOST` diferente de `0.0.0.0` | Revise o passo 3.2 e o `.env` |
| Login "não pega" (volta ao login) | `COOKIE_SECURE=true` com site em HTTP | Use `COOKIE_SECURE=false` enquanto não houver HTTPS |
| `A porta 3000 já está em uso` | Outro processo usando a porta | Pare o outro processo ou troque `PORT` no `.env` e a regra de firewall |
| Página abre, mas login e agendamento dão "sistema indisponível" | Aplicação sem acesso ao MySQL | `Invoke-RestMethod http://localhost:3000/api/saude` e rode `npm run testar-conexao` |
| Fontes diferentes do esperado | Navegador sem internet (fontes vêm do Google Fonts) | O site funciona com fontes do sistema; veja o README para hospedar as fontes localmente |
