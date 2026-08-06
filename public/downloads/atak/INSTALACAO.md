# Instalação do Agente PS (coletor ATAK) — passo a passo do TI

Tempo estimado: ~15 minutos. Faça na máquina que fica **dentro da rede** da empresa e enxerga o SQL Server.

## 1) Instalar o Node.js
- Baixe o **Node.js 18 LTS ou superior** em https://nodejs.org e instale (next, next, finish).
- Confirme no Prompt de Comando:
  ```
  node --version
  where node
  ```
  Anote o caminho completo do `node.exe` (ex.: `C:\Program Files\nodejs\node.exe`) — vai precisar no passo 5.

## 2) Extrair o coletor
- Crie a pasta do agente, ex.: `C:\agente-ps`.
- Extraia ali o `collector.js` e o `package.json` do pacote (Baixar conector).

## 3) Colocar o `.env` e preencher a senha
- Coloque na mesma pasta o arquivo **`.env`** que você baixou na tela (Baixar configuração desta empresa).
- Abra o `.env` no **Bloco de Notas** e preencha **`ATAK_SENHA=`** com a senha do usuário de leitura do SQL Server.
  > A senha fica **só aqui**, na máquina da empresa. Nunca é enviada para a nuvem PS.
- **Salvar como → Codificação: ANSI** (importante — evita erro de acento/leitura).

## 4) Instalar dependências e testar
Na pasta do agente, no Prompt de Comando:
```
cd C:\agente-ps
npm install
node collector.js
```
Esperado: linhas `[ATAK] Conectando ...`, contagem de registros por domínio e `Concluído`. Se der erro de
conexão, revise host/porta/usuário/senha no `.env`.

## 5) Criar o `run-collector.bat`
Na pasta do agente, crie um arquivo `run-collector.bat` com o **caminho completo do node** (do passo 1):
```
@echo off
cd /d C:\agente-ps
"C:\Program Files\nodejs\node.exe" collector.js >> coletor.log 2>&1
```

## 6) Agendar a cada 10 minutos (Agendador de Tarefas)
- Abra o **Agendador de Tarefas** → Criar Tarefa (não "tarefa básica").
- **Geral**: "Executar estando o usuário conectado ou não" + "Executar com privilégios mais altos".
- **Disparadores**: Novo → Diariamente → **Repetir a cada 10 minutos** por **indefinidamente**.
- **Ações**: Iniciar programa → `C:\agente-ps\run-collector.bat`.
- **Configurações**: "Se a tarefa já estiver em execução, **não iniciar uma nova instância**".

## 7) Confirmar no painel
- No painel PS: **Industrial → Conectores** (com a empresa selecionada).
- Após o 1º ciclo, o monitor acende **🟢 verde** com a última carga, a máquina (host) e os domínios.
- 🟡 amarelo = atrasado · 🔴 vermelho = parado/erro. Veja `coletor.log` na pasta do agente se ficar vermelho.
