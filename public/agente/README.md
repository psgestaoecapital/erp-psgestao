# public/agente — executável do Agente PS ATAK

O botão **"Gerar instalador"** (tela Conectores · Industrial) busca o executável em
`/agente/agente-atak.exe` (ou seja, o arquivo **`public/agente/agente-atak.exe`** deste repo) e o
empacota, no navegador, num `.zip` junto com o `config.json` (token da empresa), o `instalar.bat` e o
`LEIA-ME.md`. Enquanto o `.exe` não estiver aqui, o botão avisa em português que a publicação está
pendente (ele valida o cabeçalho `MZ` do executável — não zipa um HTML de 404 por engano).

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
