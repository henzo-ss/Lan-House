# Executar a aplicação como serviço do Windows (VS Code fechado)

Objetivo: o site deve continuar no ar **sem** depender do VS Code, de um terminal aberto, do Live Server ou de alguém logado no servidor. Para isso, o Node.js roda como **serviço do Windows**, gerenciado pelo **NSSM** (*Non-Sucking Service Manager*), uma ferramenta pequena que transforma qualquer programa em serviço.

Este guia é executado na **VM 1** (aplicação), em um PowerShell aberto **como Administrador**, depois de concluir as partes 1 a 6 do [guia de implantação](IMPLANTACAO.md).

---

## 1. Como a aplicação foi preparada para isso

Não é preciso alterar o `server.js`. Ele já foi escrito para rodar como serviço:

| Cuidado no `server.js` | Por quê |
|---|---|
| Lê o `.env` pelo caminho do próprio projeto (`src/config/env.js`), não pela pasta atual | Um serviço do Windows não inicia dentro da pasta do projeto; assim o `.env` é sempre encontrado |
| Escuta em `HOST` e `PORT` do `.env` (`0.0.0.0:3000`) | Aceita conexões vindas da rede, não só do próprio servidor |
| Sobe mesmo que o MySQL ainda não esteja pronto e reconecta sozinho | Ao ligar as duas VMs ao mesmo tempo, a VM 1 pode iniciar antes do banco |
| Trata `SIGINT`/`SIGTERM` e encerra com calma | O NSSM envia esse sinal ao parar ou reiniciar o serviço |
| Escreve mensagens com prefixos (`[ok]`, `[aviso]`, `[erro]`) na saída padrão | O NSSM grava a saída em arquivos de log |

O arquivo de entrada é `server.js`, na raiz do projeto. O serviço executa: `node.exe server.js` com a pasta de trabalho em `C:\lanhouse`.

---

## 2. Instalar o NSSM

1. Baixe o NSSM em <https://nssm.cc/download> (arquivo `nssm-2.24.zip`).
2. Extraia e copie **`win64\nssm.exe`** para `C:\nssm\nssm.exe`.
3. Confira:

```powershell
C:\nssm\nssm.exe version
```

> Se você usa o Chocolatey, `choco install nssm -y` também funciona (nesse caso o `nssm.exe` já fica no PATH).
> Se o site nssm.cc estiver fora do ar, use a alternativa por **Agendador de Tarefas** da seção 9.

---

## 3. Descobrir o caminho do Node.js

```powershell
where.exe node
```

Normalmente: `C:\Program Files\nodejs\node.exe`. **Use o caminho completo**, porque o serviço não tem o mesmo PATH da sua sessão.

---

## 4. Criar o serviço

Execute os comandos abaixo (ajuste os caminhos se necessário). Eles criam a pasta de logs e registram o serviço `PingLounge`:

```powershell
$nssm = "C:\nssm\nssm.exe"
$node = "C:\Program Files\nodejs\node.exe"
$app  = "C:\lanhouse"

New-Item -ItemType Directory -Force -Path "$app\logs" | Out-Null

# Registra o serviço: programa = node.exe, argumento = server.js
& $nssm install PingLounge $node "server.js"

# Pasta de trabalho do serviço
& $nssm set PingLounge AppDirectory $app

# Nome e descrição que aparecem em services.msc
& $nssm set PingLounge DisplayName "Ping Lounge (aplicação web)"
& $nssm set PingLounge Description "Site e API de agendamento da lan house (Node.js + Express). Banco de dados na VM 2."

# Inicialização automática junto com o Windows
& $nssm set PingLounge Start SERVICE_AUTO_START

# Variável de ambiente adicional (o restante vem do arquivo .env)
& $nssm set PingLounge AppEnvironmentExtra "NODE_ENV=production"

# Logs: saída normal e erros, com rotação a cada ~5 MB
& $nssm set PingLounge AppStdout "$app\logs\saida.log"
& $nssm set PingLounge AppStderr "$app\logs\erros.log"
& $nssm set PingLounge AppRotateFiles 1
& $nssm set PingLounge AppRotateOnline 1
& $nssm set PingLounge AppRotateBytes 5242880

# Se o processo cair, reinicia sozinho após 5 segundos
& $nssm set PingLounge AppExit Default Restart
& $nssm set PingLounge AppRestartDelay 5000

# Ao parar o serviço, envia Ctrl+C primeiro (encerramento limpo) e espera até 10 s
& $nssm set PingLounge AppStopMethodConsole 10000
```

### Conferir a configuração

```powershell
& $nssm dump PingLounge
```

> **Prefere a janela gráfica?** Execute `C:\nssm\nssm.exe install PingLounge`. Na aba **Application** preencha *Path* (`node.exe`), *Startup directory* (`C:\lanhouse`) e *Arguments* (`server.js`); na aba **Details** o nome e o tipo de inicialização *Automatic*; na aba **I/O** os arquivos de log. É a mesma configuração dos comandos acima.

---

## 5. Iniciar o serviço

```powershell
Start-Service PingLounge
```

(ou `& $nssm start PingLounge`)

## 6. Verificar se está funcionando

```powershell
Get-Service PingLounge                      # Status: Running  |  StartType: Automatic
& $nssm status PingLounge                   # SERVICE_RUNNING
Invoke-RestMethod http://localhost:3000/api/saude
```

A última linha deve mostrar `aplicacao: ok` e `banco: ok`. Depois abra `http://IP-DA-VM1:3000` no navegador do seu computador.

Também é possível ver o serviço graficamente: `Win + R` → `services.msc` → **Ping Lounge (aplicação web)**.

## 7. Consultar os logs

```powershell
# últimas linhas e acompanhamento em tempo real (Ctrl+C para sair)
Get-Content C:\lanhouse\logs\saida.log -Tail 30 -Wait

# erros
Get-Content C:\lanhouse\logs\erros.log -Tail 30
```

Linhas esperadas na inicialização:

```
[ok] Ping Lounge no ar em http://0.0.0.0:3000
[ok] MySQL acessível em 192.168.56.20:3306
```

Se aparecer `[aviso] MySQL inacessível ...`, o site abre, mas login e agendamento só funcionam quando o banco responder. Verifique a VM 2 (`Get-Service MySQL*`) e rode `npm run testar-conexao`.

## 8. Reiniciar, parar e remover

```powershell
Restart-Service PingLounge     # obrigatório após alterar o .env ou o código
Stop-Service PingLounge

# remover o serviço (não apaga o projeto)
& $nssm stop PingLounge
& $nssm remove PingLounge confirm
```

Depois de qualquer mudança no `.env` ou nos arquivos `.js`, **reinicie o serviço**, senão a versão antiga continua em execução.

---

## 9. Teste final: VS Code fechado e Windows Server reiniciado

Faça estes testes **na ordem** e registre os prints para o PowerPoint:

1. **Feche tudo na VM 1:** VS Code, PowerShell, CMD e qualquer terminal. Se estiver usando Área de Trabalho Remota, pode até **desconectar** a sessão (não precisa estar logado).
2. No seu computador, abra `http://IP-DA-VM1:3000`: o site deve responder normalmente. 
3. Faça um cadastro e uma reserva para provar que o banco continua respondendo.
4. **Reinicie a VM 1** (`Restart-Computer`). Não abra terminal nem inicie nada manualmente.
5. Aguarde 1 a 2 minutos, abra o site de novo: deve estar no ar.
6. Reconecte à VM 1 e confira `Get-Service PingLounge` (`Running`) e o log (`saida.log`) com a hora do novo início.
7. **Reinicie também a VM 2** e confirme `Get-Service MySQL*` (`Running`). Em seguida, faça login no site: a aplicação reconecta ao banco sozinha, sem reiniciar o serviço.

> Dica de ordem de inicialização: ligue a VM 2 (banco) primeiro. Se a VM 1 iniciar antes, tudo bem: o log mostra o aviso e a aplicação passa a funcionar quando o MySQL ficar disponível.

---

## 10. Alternativa sem NSSM: Agendador de Tarefas

Se não for possível usar o NSSM, o próprio Windows pode iniciar o Node na inicialização do sistema (mesmo sem ninguém logado):

```powershell
$acao = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument "server.js" -WorkingDirectory "C:\lanhouse"
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "PingLounge" -Action $acao -Trigger $gatilho -Settings $config -User "SYSTEM" -RunLevel Highest
Start-ScheduledTask -TaskName "PingLounge"
```

Nesse modo não há arquivos de log automáticos; o serviço do NSSM é a opção recomendada.

---

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| Serviço fica em `Stopped` logo após iniciar | Veja `C:\lanhouse\logs\erros.log`. Causas típicas: `.env` ausente ou incompleto, porta 3000 em uso, caminho errado do `node.exe` |
| Serviço em `Paused` ou "não iniciou a tempo" no Windows Server 2019/2022 | Pode ser um problema conhecido da versão 2.24 do NSSM em versões recentes do Windows; use a versão de pré-lançamento `2.24-101` (disponível na página de downloads do NSSM) ou a alternativa da seção 10 |
| `[config] Variáveis ausentes no arquivo .env` | O `.env` precisa estar em `C:\lanhouse\.env` (mesma pasta do `server.js`) |
| Funciona com `npm start` mas não como serviço | Confirme o caminho **completo** do `node.exe` e o `AppDirectory` (`& $nssm dump PingLounge`) |
| Site não abre de fora da VM | Regra de firewall da porta 3000 na VM 1 (veja o guia de implantação, passo 3.2) |
| Mudei o `.env` e nada mudou | `Restart-Service PingLounge` |
