# Agente PS · coletor ATAK config-driven (F3)

Um agente, N frigoríficos. A **única** configuração por cliente é o **token**. Host,
banco, credencial (via Vault), de-paras e janela vêm da nuvem PS pela RPC
`fn_atak_agente_config(token)`. Trocar de servidor = editar 1 campo na tela
(**Industrial › Administração › Conectores (ERPs)**), sem tocar na máquina.

## Como funciona (ciclo)

1. Puxa a config por token (`fn_atak_agente_config`).
2. Se a tela pediu um **Teste de conexão** (`teste_pendente`), faz `SELECT 1` e
   responde em português (`fn_atak_teste_responder`): _conectou_ / _não alcança o
   host (rede?)_ / _credencial inválida_ / _banco não existe_.
3. Coleta cada domínio ativo. A `chave_fato_sql` do de-para é uma **expressão SQL** —
   quem computa é o próprio banco (`SELECT *, (<chave_fato_sql>) AS __chave_fato FROM <tabela>`),
   com janela por `coluna_watermark` quando houver. Sem adivinhar casing no JS.
4. Empurra pro edge `atak-ingest` (idempotente). O edge **já grava o heartbeat** em
   `erp_sync_log` → alimenta o **monitor / semáforo** da tela.
5. **Heartbeat de vivacidade (RD-58, v1.1):** se o ciclo conectou e varreu tudo mas a
   janela veio **vazia** (0 linhas novas), o agente bate um lote vazio mesmo assim —
   senão um agente saudável ficaria mudo e o monitor o mostraria _Parado_ (mentira).
   Só bate quando **não houve erro de domínio**; se algo falhou, o silêncio é honesto
   e o `fn_atak_alerta_silencio` acende o vermelho.

Resiliência: um domínio que falha não derruba os outros (try/catch); conexão com
retry + backoff.

## Configuração da máquina (mínima)

Só o token muda por cliente. O resto são constantes de **plataforma** (idênticas em
todos os agentes; não são segredo do cliente):

```
PS_AGENTE_TOKEN=<token gerado na tela ao salvar a conexão>   # ← único por cliente
PS_SUPABASE_URL=https://horsymhsinqcimflrtjo.supabase.co
PS_SUPABASE_ANON_KEY=<anon key do projeto PS>
PS_INGEST_URL=https://horsymhsinqcimflrtjo.supabase.co/functions/v1/atak-ingest
# opcional — se a nuvem não devolver ingest_secret (Vault: atak_ingest_secret):
# PS_INGEST_SECRET=<segredo do ingest>
# opcional:
# PS_JANELA_DIAS=7
```

> O `ingest_secret` ideal vem da nuvem (Vault `atak_ingest_secret`) dentro do
> `fn_atak_agente_config` — assim nem ele fica na máquina. `PS_INGEST_SECRET` é só
> fallback.

## Rodar

```
npm install
PS_AGENTE_TOKEN=... node agent.js      # um ciclo
```

Agendar o ciclo (a cada `sync_minuto`): Agendador de Tarefas do Windows ou o serviço
(abaixo).

## Instalador `.msi` / serviço do Windows (próximo passo — precisa do servidor)

Meta: "next, next, finish" — instala como **serviço do Windows** (roda sozinho,
reinicia com a máquina) e pede **só o token** na instalação. Fim do `.env`/PowerShell/
encoding.

Caminho recomendado (a validar no servidor da rede 20.x, com o Jian):

- **Serviço**: empacotar com [`node-windows`](https://github.com/coreybutler/node-windows)
  (`svc.install()`) ou `nssm` apontando pra `node agent.js` num laço com intervalo =
  `sync_minuto`. O instalador grava o token em variável de ambiente do serviço.
- **`.msi`**: [WiX Toolset](https://wixtoolset.org/) ou
  [`electron-builder`/`msi`] empacotando Node + `agent.js` + `node_modules`. Tela
  única pedindo o token; as constantes de plataforma vão embutidas.
- **Auto-atualização** (scaffold — ainda não ligado): o agente consulta a versão
  publicada na nuvem no início do ciclo e, se houver nova, baixa e troca o binário
  (padrão `squirrel`/`electron-updater`, ou um `updater.ps1` disparado pelo serviço).
  Assim uma melhoria (ex.: novo domínio) chega aos N clientes sem `git pull` manual.

Enquanto o `.msi` não sai, o agente já roda como script agendado — cadastra-se o
cliente pela tela e roda-se `node agent.js` no servidor certo. Isso já mata o cliente
e valida o F3 no mesmo movimento.

## Validação na Frioeste (piloto)

1. Pela tela: cadastrar Frioeste → **Testar conexão** (do servidor certo) → ✅.
2. Instalar/rodar o agente no servidor da rede 20.x com o **token** da Frioeste.
3. O agente puxa a config, coleta embalagem/estoque → `ind_atak_fato` → cards acendem.
4. Monitor mostra Frioeste **verde**. Trocar o host na tela e ver o agente seguir.
   Parar o agente e ver o alerta **vermelho** (`fn_atak_alerta_silencio`).
