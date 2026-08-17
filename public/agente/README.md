# Agente PS ATAK — hosting no Supabase Storage (bucket público `agente`)

> **Atualização:** o hosting do `.exe` + `versao.json` mudou de `public/agente/` (no git) para o
> **Supabase Storage** (bucket público `agente`). O **CI publica sozinho** na tag `agente-v*` — zero
> binário no git, zero passo manual. Os arquivos abaixo (`versao.json` deste dir) ficam só como
> referência/template; a fonte viva é o Storage.

URLs públicas (baixadas por qualquer máquina de cliente, HTTPS):
- `.../storage/v1/object/public/agente/agente-atak.exe`
- `.../storage/v1/object/public/agente/versao.json`

O botão **"Gerar instalador"** (Conectores · Industrial) e o **auto-update do agente** buscam desses
URLs do Storage. Enquanto o `.exe` não estiver publicado, o botão avisa em PT-BR (valida o cabeçalho
`MZ` — não zipa um HTML de 404).

## Fluxo de release (automático)
0. **Antes de taggear, faça o bump da versão em DOIS lugares** (senão o build falha de propósito):
   `collectors/atak-agente/agent.js` → `VERSAO_AGENTE` **e** `collectors/atak-agente/package.json` → `version`.
   A tag `agente-vX.Y.Z` tem que casar com esses. **Nunca anuncie uma versão que o binário não carrega** —
   foi o que criou o loop 2.1.1↔2.1.0 (manifesto 2.1.1 em cima de binário 2.1.0 → re-download infinito).
1. `git tag agente-v2.1.1 && git push --tags` → o workflow "Build Agente ATAK" valida (guard) que
   binário == package.json == tag, builda o `.exe`, gera o `versao.json` **a partir da versão do binário**
   (com sha256 + `url` absoluto do Storage) e **publica os dois no bucket**.
2. Pronto — todos os agentes se atualizam no próximo ciclo; a tela Conectores gera o instalador
   com o `.exe` do Storage.

> **Circuit-breaker (RD-57):** se mesmo assim um update não "vingar" (o binário não vira a versão
> anunciada), o agente tenta no máximo **3×** para o mesmo alvo, então **para**, fica na versão estável
> que coleta e grava `status = update_travado:<versao>` em `erp_agente_status`. Um update quebrado nunca
> mais zera a coleta. O estado fica em `update-state.json` ao lado do `.exe` (sobrevive a restart).

Requer (1×, pelo CEO) os secrets `SUPABASE_URL` e `SUPABASE_STORAGE_KEY` no repo (Pilar 2 — a chave
só serve pro Storage, vive nos Secrets do GitHub, nunca no código; vault intocado).

---

## (Legado) Como publicar o `.exe` manualmente em `public/agente/`

## Como publicar o `.exe` (Parte A.1 — manual, hoje)

1. Rode o workflow **"Build Agente ATAK (.exe)"** (aba *Actions* → *Run workflow*) ou publique uma tag
   `agente-v*`. Ele builda no runner `windows-latest` via `pkg`.
2. Baixe o artefato **`agente-atak-exe`** da run verde.
3. Extraia e coloque o `agente-atak.exe` **aqui** como `public/agente/agente-atak.exe`.
4. Commit + deploy. Pronto — o botão passa a incluir o executável no `.zip`.

> Build verde de referência (run #2, sha `39040a5`):
> `sha256:dd4d2ee0d2df70b96e4746354ec5ea06a4e39cf341cef2e10cb504b46f88e961` (~25,5 MB).
> Confira o digest do arquivo baixado com `certutil -hashfile agente-atak.exe SHA256` (Windows) ou
> `sha256sum agente-atak.exe` (Linux/Mac) antes de commitar.

## Auto-update (o que faz o agente escalar)

Ao lado do `.exe` vai o **`versao.json`** (manifesto). O agente instalado consulta
`/agente/versao.json` de tempos em tempos (HTTPS de saída): se a `versao` do manifesto for maior
que a dele, baixa o novo `.exe`, **confere o sha256** (nunca instala arquivo errado), faz backup e
troca via updater (com rollback automático). Assim **1 publicação atualiza todos os agentes**.

Publicar uma versão nova:
1. Rode o build (tag `agente-v2.1.0`) → o CI gera `agente-atak.exe` **e** `versao.json` (com o sha256
   já calculado — sem erro de sha manual).
2. Baixe os dois do artefato e coloque em `public/agente/` (substituindo os atuais).
3. Commit + deploy. Em ~1 ciclo os agentes se atualizam sozinhos.

> O `versao.json` deste repo é o manifesto servido. Mantenha `versao` = a versão do `.exe` publicado
> e `sha256` = o hash real do `.exe` (o CI preenche). Enquanto o `.exe` não estiver publicado, o
> `sha256` fica vazio e os agentes não atualizam (download 404 → seguem coletando).

## Evolução (Parte A.2 — automático, depois)

Um passo no workflow publica o `.exe` no Supabase Storage (bucket público `agente`) a cada build, e o
botão passa a buscar de lá (sempre a versão mais nova, sem recommit). Precisa de service key nos
GitHub Secrets. Fica pra quando quiser o pipeline 100% automático.

## Por que o `.exe` não está versionado aqui ainda

O binário (~25 MB) é gerado pelo CI (máquina Windows) e não pode ser buscado pelo ambiente de
desenvolvimento (o proxy de rede bloqueia o download de artefatos do GitHub). Por isso a colocação do
arquivo é o único passo manual — feito por quem tem acesso à run do Actions.
