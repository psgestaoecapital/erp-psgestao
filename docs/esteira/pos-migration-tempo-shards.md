# @pos-migration: medição do tempo e análise de sharding (item C, CEO 25/11)

> Resposta à pergunta do Eng. Chefe: "o @pos pode rodar em 3–4 shards para cair a mediana para ≤ 15 min?"
> **Conclusão: NÃO shardar agora** — os specs disputam os MESMOS dados da DEMO. Medição e motivo abaixo.

## 1. Medição — onde vai o tempo do `@pos-migration`

Workflow: `.github/workflows/aceitacao-pos-migration.yml`, job `producao` (runner `ubuntu-24.04`), suíte
`npx playwright test e2e/jornadas/aceitacao --project=celular --grep @pos-migration` com `workers: 1`,
`fullyParallel: false` (playwright.config.ts). **181 arquivos de spec, 261 casos `@pos-migration`.**

Passos de dois runs reais (produção), do começo ao fim de cada passo:

| Passo | run #3428 (45721732143) | run #3419 (45713936254) |
|---|---|---|
| checkout | 7 s | 9 s |
| **Esperar a produção servir o commit** | **1 s** | **0 s** |
| setup-node + `npm ci` + `playwright install` | 45 s | 63 s |
| **Aceitação @pos (a suíte Playwright)** | **15 min 17 s** | **18 min 46 s** |
| teardown (soltar trava, registrar, avisos) | ~10 s | ~15 s |
| **tempo de runner** | **≈ 16,4 min** | **≈ 20 min** |

**A suíte Playwright é ~90–93% do tempo de runner; mediana da suíte ≈ 17 min.** O "esperar a produção servir
o commit" foi ~0–1 s nestes runs (a Vercel já servia); o teto é 30 min de polling e sobe só quando a Vercel
demora. O `npm ci`/`playwright install` é ~1 min.

> Observação: a maior latência da ESTEIRA **não** é o tempo de um run (~17 min), e sim a **serialização** — o grupo
> de concorrência `demo-e2e` roda **um `@pos` por vez**. Vários runs recentes aparecem `cancelled` após 2–9 min:
> são os "superados", cancelados na fila sem rodar a suíte (`pos-superado-cancelar.sh`). O lever de vazão é
> **batelar mais migrations por `@pos`** (itens A e B), não encurtar um run.

## 2. Por que sharding NÃO é seguro hoje — disputa de dados da DEMO

Todos os jornadas rodam contra **UMA empresa de demonstração** e com **UMA trava global**:

- `e2e/support/fixtures.ts`: `exigirEmpresaDemo` exige `sel === DEMO_REVENDA` (`b0700000-…-0003`) — a jornada
  "só pode rodar na empresa de demonstração". Os specs partilham o MESMO estado dessa empresa.
- `playwright.config.ts`: `globalSetup` loga o bot; o `global-teardown` chama **`fn_demo_reset(DEMO_REVENDA)`** —
  um **reset global** da DEMO ao fim da suíte.
- `e2e/support/api.ts`: **trava única** `fn_e2e_trava_pegar(p_nome: TRAVA_DEMO, …)`. Uma 2ª suíte espera até
  **20 min** pela trava ("demo ocupada há mais de N min — não rodo em cima de outra suíte").

Com isso, dois shards em paralelo cairiam num de dois buracos:

1. **Compartilham a trava** → serializam: o 2º shard espera o 1º soltar a trava → **zero ganho** (e até pior, por
   causa da espera de trava).
2. **Furam a trava** (cada shard pega/reseta a DEMO por conta) → `fn_demo_reset` e as escritas de um shard
   **apagam os dados do outro** no meio do teste → **falhas falsas / flaky**.

O que "impede o sharding" **não é uma lista pequena de specs** — é a ARQUITETURA da fixture: empresa única
(`DEMO_REVENDA`), trava global e reset global. O `check-e2e-delete-fisico` mostra o sintoma contrário (specs que
NEM limpam o que criam — 7 no débito grandfather: NF-e, NR-36, produtividade): esses vazam linhas na própria DEMO,
o que só agrava a disputa entre shards paralelos. Ou seja: a suíte é serial **de propósito**, para não disputar a DEMO.

## 3. Recomendação

- **Não shardar agora.** A suíte já está em ~15–19 min (perto da meta ≤ 15). O ganho de 3–4 shards (≈17→≈5 min) só
  existe com execução paralela, e paralelo na DEMO única = disputa de dados ou serialização na trava.
- **O lever de vazão do `@pos` é batelar** (itens A e B): mais migrations por `@pos`, menos `@pos` por migration.
- **Habilitador do sharding (futuro):** o "banco de testes por vaga" já citado pelo CEO — N datasets/empresas-DEMO
  isoladas, uma por shard, cada uma com sua trava e seu reset. Com isso, 3–4 shards (um DEMO por shard) rodam de
  verdade em paralelo e a mediana cai. Enquanto houver UMA DEMO + UMA trava + reset global, sharding não ajuda.
- **Micro-ganhos seguros, sem sharding** (se o Eng. Chefe quiser, em PR à parte): cachear o browser do Playwright
  entre runs (hoje `playwright install` ~1 min por run) e manter `--trace off` (já é o padrão). Nenhum muda a meta.

## 4. Quando revisitar

Reabrir o sharding assim que existir isolamento por vaga (uma empresa-DEMO por shard). Aí a divisão natural é por
VERTICAL (cada shard pega os jornadas de uma empresa-DEMO: Revenda, Comércio/GE, Indústria, Construtora, EHS), com
trava e reset por empresa — e o `check-e2e-delete-fisico` vira pré-requisito (todo spec tem de limpar o que cria,
ou usar RPC de limpeza, para a vaga não vazar entre runs).
