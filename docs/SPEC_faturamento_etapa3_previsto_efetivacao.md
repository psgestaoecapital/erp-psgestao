# SPEC · Faturamento #18 v2 — ETAPA 3: previsão nasce no pedido, faturamento efetiva

> **Status: SPEC (desenho). NÃO construir ainda — aguardando aprovação do CEO.**
> Continuação das etapas 1 (blindagem: trigger preserva `previsto` + view `v_receber_efetivo`) e 2
> (`previsto` no CHECK de `erp_receber`), **ambas já em produção** (migrations `20260910230000` e
> `20260910240000`, deploy-migrations verde). Esta etapa faz o `previsto` **nascer** e **virar realidade**.

---

## 0. Auditoria do que existe hoje (RD-26 — não construir do zero)

Levantado no dado antes de escrever (produção):

- **`fn_faturar(p_pedido_id uuid, p_local_id uuid DEFAULT NULL)`** é HOJE o **único** criador de `erp_receber`
  a partir de pedido. Ele, numa só passada:
  1. baixa estoque + calcula CMV (itens produto e BOM de serviço → `erp_estoque_movimentacoes`, `erp_produtos`);
  2. cria **1 `erp_receber` por parcela** de `erp_pedidos_parcelas` (fallback à vista) com **`status='aberto'`**,
     `data_emissao = CURRENT_DATE`, `data_vencimento = parcela.vencimento`, `numero_documento`/`descricao`
     derivados do número do pedido;
  3. marca o pedido `status='faturado'`, `titulos_gerados=true`, `data_faturamento=now()`, grava `cmv`.
  - Guardas: recusa se `status='faturado'` OU `titulos_gerados=true` (**"já foi faturado"**) e se `status='cancelado'`.
  - Chamado do front em `src/app/dashboard/commerce/otc/page.tsx` (`supabase.rpc('fn_faturar', { p_pedido_id })`).
- **`erp_receber`** relevante: tem `status` (CHECK já aceita `previsto` — etapa 2), `data_emissao`,
  `data_pagamento`, `data_vencimento` (NOT NULL), `data_competencia`, `numero_nf`, `numero_documento`,
  `origem_recebivel_id uuid` (hoje sem uso claro), `observacoes`, soft-delete (`deleted_at`/`deleted_by`).
  **NÃO existe** coluna ligando o título ao **pedido** nem à **parcela** — a amarração hoje é só texto
  (`numero_documento`). **Isso é um bloqueio para a etapa 3** e o SPEC resolve na §5.
- **`erp_pedidos_parcelas`**: `id, pedido_id, numero, valor, vencimento, forma_pagamento, gerar_boleto,
  conta_bancaria_id`. É a fonte das parcelas.
- **Trigger `fn_trg_status_lancamento` (BEFORE em `erp_receber`)**: preserva `previsto` (linha em produção
  `IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto')`) — um `previsto` vencido
  **continua** `previsto`, não vira `vencido`. Normaliza status desconhecido para válido. **Não mexer.**
- **`v_receber_efetivo`** (= `erp_receber` sem `previsto`): as 9 funções de receita/A-receber leem dela →
  `previsto` **não** infla balanço, DSO, DFC, painéis, inadimplentes, contador, ge_listagem. **Não mexer.**
- **DRE / caixa / competência**: somam por `data_emissao` / `data_pagamento` / `data_competencia`. Como o
  `previsto` nasce com **as três NULAS** (§1), essas somas o ignoram sozinhas. **Não mexer.**
- **`fn_fluxo_caixa_projecao(p_company_id, p_dias_futuro)`**: lê `erp_receber` **cru** e hoje soma o
  `previsto` dentro de `receitas_previstas` (`status NOT IN ('pago','recebido','cancelado')`). É a **única**
  função que deve mostrar `previsto` — mas hoje o **mistura** com o aberto. A §6 separa.

**Princípio da etapa (RD-26):** o trabalho é **(a)** mudar o momento/estado inicial (previsão nasce no
pedido, `previsto`), **(b)** acrescentar a **efetivação** (parcelas marcadas viram `aberto` na emissão da
nota) e **(c)** separar o previsto no fluxo. Reaproveitar a lógica de parcelas/estoque de `fn_faturar`,
não reescrever.

---

## 1. O pedido nasce com PREVISÃO (financeiro previsto, zero fiscal)

**Regra:** ao **salvar** um pedido de serviço (com parcelas), o sistema cria os títulos previstos.

- Para cada `erp_pedidos_parcelas` (fallback à vista quando não há parcelas), cria um `erp_receber` com:
  - `status = 'previsto'`
  - `data_vencimento = parcela.vencimento` (preenchida — o previsto tem data-alvo)
  - `data_emissao = NULL`, `data_pagamento = NULL`, `data_competencia = NULL` (é o que mantém o previsto
    fora de DRE/caixa/competência automaticamente)
  - `valor`, `forma_pagamento`, `conta_bancaria_id`, `cliente_id`/`cliente_nome` da parcela/pedido
  - amarração forte ao pedido e à parcela (ver §5)
  - **nada fiscal**: sem ISS/alíquota, sem CNO, sem endereço de obra, sem `numero_nf`
- **NÃO** baixa estoque, **NÃO** calcula CMV, **NÃO** marca o pedido como `faturado`. Previsão é só
  fotografia financeira do que se espera receber.

**Onde plugar (RD-26):** hoje o pedido é salvo pelo front direto na tabela; a criação de previsão deve ser
um ponto único no backend, idempotente:

- **Recomendado:** nova RPC `fn_pedido_gerar_previsao(p_pedido_id uuid) RETURNS jsonb`, chamada pelo fluxo de
  salvar pedido (como o OTC hoje chama `fn_faturar`). Idempotente: se já existem previstos **não efetivados**
  para o pedido, **reconcilia** (recria/atualiza os `previsto`; nunca toca `aberto`/`cancelado`). Reusa o
  loop de parcelas de `fn_faturar`.
- Alternativa considerada e **descartada**: trigger em `erp_pedidos_parcelas` — fica implícito demais e
  dificulta o controle de "só recria os previstos, não os efetivados". Preferir a RPC explícita.

**Edição de pedido antes de faturar:** ao editar parcelas de um pedido ainda não efetivado, `fn_pedido_gerar_previsao`
reconcilia os `previsto` (remove/atualiza os que mudaram — **soft**, ver §3 sobre nunca-DELETE; um previsto
que deixou de existir vira `cancelado` com motivo `edicao_pedido`, mantendo trilha). Parcelas já efetivadas
(`aberto`/pago) **nunca** são tocadas.

---

## 2. O FATURAMENTO efetiva (tela de NFS-e, medição por checkbox)

**Regra:** a emissão da NFS-e é o gatilho que transforma previsão em realidade.

Fluxo na tela de NFS-e:
1. escolhe o **pedido** (origem);
2. **checkbox das parcelas previstas** a efetivar nesta nota (a medição **não segue calendário** — o
   operador marca as parcelas que aquela medição cobre);
3. preenche o **fiscal** desta nota: ISS/alíquota, **CNO quando houver**, endereço da obra, retenções;
4. ao **autorizar** a NFS-e, as parcelas marcadas:
   - `status`: `previsto → aberto`
   - `data_emissao = ` data de emissão da nota
   - `numero_nf = ` número da nota emitida (e `nfse_id`/chave — §5)
   - `data_competencia` conforme regra fiscal (a partir da emissão)
   - passam a contar nos painéis (saem da `previsto`, entram na `v_receber_efetivo`).

**Backend (RD-26 — reaproveitar `fn_faturar`):** transformar a lógica de `fn_faturar` numa **efetivação por
parcelas selecionadas**:

- Nova assinatura recomendada: `fn_faturar_efetivar(p_pedido_id uuid, p_parcela_ids uuid[], p_local_id uuid,
  p_numero_nf text, p_nfse_id uuid, p_data_emissao date, p_data_competencia date) RETURNS jsonb`.
  - flipa os `erp_receber` **previstos** daquelas parcelas para `aberto` + carimba `numero_nf`/`data_emissao`;
  - **estoque + CMV**: hoje `fn_faturar` baixa tudo de uma vez. Ver **decisão em aberto D-1** (§7) —
    recomendação: baixa **integral na primeira efetivação** do pedido; notas seguintes só flipam financeiro.
  - marca o pedido `faturado` **somente quando todas as parcelas estiverem resolvidas** (aberto/pago ou
    cancelado); enquanto houver `previsto`, o pedido fica `faturamento_parcial` (novo estado) — a guarda
    atual "já foi faturado" precisa relaxar para permitir N notas (§4 medição).
- `fn_faturar` legado (efetiva tudo de uma vez, à vista) permanece como caminho do pedido simples (§5 R.R.):
  1 pedido → 1 nota → efetiva todas as parcelas. **Mesmo mecanismo**, `p_parcela_ids` = todas.

**Integração de tela:** a rota de emissão (`src/app/api/fiscal/nfse/emitir/route.ts` e os modais
`NFSeEmitirGovModal`/`EmitirNFSeButton`) passam a: (a) receber o `pedido_id` + `parcela_ids` marcados;
(b) após a **autorização** da nota pelo provedor, chamar `fn_faturar_efetivar`. Efetivação só acontece com a
nota **autorizada** (rejeitada não efetiva nada).

---

## 3. CANCELAMENTO — receita perdida, nunca DELETE

- Pedido **cancelado sem faturar** → todos os `erp_receber` ainda `previsto` daquele pedido vão para
  `status='cancelado'` **+ motivo** (novo campo, §5). **NÃO é DELETE** (RD-30/RD-55: trilha nunca some).
- **Identificação de "receita perdida"** (elegante, sem status novo): um `erp_receber` com
  `status='cancelado'` **E `data_emissao IS NULL`** = título que **nunca** virou nota = **previsão perdida**.
  Um `cancelado` com `data_emissao` preenchida é uma nota efetivada e depois cancelada — caso diferente,
  fica **fora** da aba de receita perdida.
- **Aba "Receita perdida"** ao lado de **Inadimplentes** (mesmo módulo financeiro): lista os previstos
  cancelados por **período** (por `data_vencimento` ou `cancelado_em`) e por **motivo**. Só leitura + totais.
  - Nova função de leitura: `fn_receita_perdida(p_company_id uuid, p_inicio date, p_fim date) RETURNS ...`
    (espelha `fn_inadimplentes_por_status`), agrupando por motivo. Lê `erp_receber` filtrando
    `status='cancelado' AND data_emissao IS NULL AND deleted_at IS NULL`.

---

## 4. A MEDIÇÃO (R.R. Serviços) — 1 pedido, N notas; obra pequena — 1 pedido, 1 nota

Os dois casos usam **o mesmo mecanismo** (§2):

- **Medição (N notas):** cada emissão de NFS-e efetiva **as parcelas marcadas** naquela nota; o **saldo
  previsto baixa** (as parcelas restantes seguem `previsto`). O pedido só fecha (`faturado`) quando a última
  parcela vira `aberto`/`cancelado`. Nada de recalcular calendário — o operador escolhe as parcelas.
- **Obra pequena (1 nota):** 1 pedido, marca **todas** as parcelas, 1 emissão → tudo vira `aberto`. É o
  caso degenerado do mesmo `fn_faturar_efetivar` (`p_parcela_ids` = todas).

**Estado do pedido:** introduzir `faturamento_parcial` (entre `previsto`/aberto e `faturado`). O pedido é
`faturado` só quando não resta parcela `previsto`.

---

## 5. Mudanças de schema (mínimas, reversíveis, RD-52)

Migration nova (ex.: `2026091100xxxx_faturamento_etapa3_amarracao.sql`), aplicada via PR→merge→deploy.
Nenhuma coluna antiga é removida (RD-30).

Em **`erp_receber`** (ADD COLUMN IF NOT EXISTS):
- `pedido_id uuid` — amarração forte ao pedido (hoje não existe; `numero_documento` texto não serve para
  efetivar por seleção). Index `(pedido_id, status)`.
- `pedido_parcela_id uuid` — amarração à parcela exata (permite efetivar as marcadas).
- `motivo_perda text` — motivo do cancelamento da previsão (§3). `cancelado_em timestamptz`,
  `cancelado_por uuid` para trilha.
- `nfse_id uuid` (ou reuso de `numero_nf` + chave) — liga o título efetivado à nota que o efetivou.
- *Backfill:* nenhum necessário para títulos históricos (já são `aberto`/`pago`); as novas colunas nascem
  nulas e só passam a ser preenchidas para pedidos daqui pra frente.

Em **`erp_pedidos`**: aceitar o novo `status='faturamento_parcial'` no CHECK (se houver CHECK; auditar antes,
igual fizemos no `erp_receber_status_check`).

Funções: `fn_pedido_gerar_previsao` (nova), `fn_faturar_efetivar` (nova, extrai de `fn_faturar`),
`fn_receita_perdida` (nova), `fn_fluxo_caixa_projecao` (alterada, §6). `fn_faturar` mantém-se para o caminho
à-vista/tudo-de-uma-vez (delegando para `fn_faturar_efetivar` internamente para não duplicar lógica).

---

## 6. O FLUXO DE CAIXA separa previsto do realizado

`fn_fluxo_caixa_projecao` passa a distinguir, por dia:
- `receitas_a_receber` — `erp_receber` com `status IN ('aberto','vencido','parcial')` (comprometido/realizável);
- `receitas_previsao` — `erp_receber` com `status='previsto'` (previsão de pedido não faturado), **linha
  própria**, **nunca somada** ao anterior.

O `saldo_projetado` (headline, o número que o Diego olha) é calculado **só com o comprometido**
(`receitas_a_receber` − despesas). A previsão vira um **cenário separado** (`saldo_projetado_com_previsao`),
claramente rotulado como "se todos os pedidos previstos virarem nota". **Regra de ouro:** se o Diego vir um
número só, ele trata previsão como certeza — então a previsão nunca entra no número principal.

> Observação de blindagem: como a etapa 1 já isolou `previsto` de todos os painéis via `v_receber_efetivo`,
> e DRE/caixa/competência o ignoram pelas datas nulas, o `fn_fluxo_caixa_projecao` é o **único** ponto a
> mexer aqui — e mesmo assim só para **separar** o que hoje ele já mostra junto.

---

## 7. Decisões em aberto (para o CEO decidir na aprovação)

- **D-1 · Estoque/CMV na medição (N notas):** quando dar baixa de estoque e reconhecer CMV?
  - **(recomendado)** baixa **integral na primeira efetivação** do pedido (o material sai quando a obra
    começa a ser faturada); notas seguintes só flipam parcelas financeiras. Simples e não fraciona material.
  - alternativa: baixa **proporcional** ao valor efetivado em cada nota (mais fiel ao regime de competência,
    porém complexa — exige ratear itens por parcela, que hoje não têm essa relação).
- **D-2 · "Receita perdida" por qual data:** agrupar por `data_vencimento` da previsão (quando *seria*
  recebida) ou por `cancelado_em` (quando se perdeu)? Recomendo **`data_vencimento`** (alinha com o fluxo),
  com `cancelado_em` disponível como coluna.
- **D-3 · Previsão automática vs. opt-in:** todo pedido de serviço com parcelas gera previsão automática ao
  salvar, ou só quando o usuário marca "gerar previsão"? Recomendo **automática** (é o pedido do CEO:
  "previsão em todo pedido de serviço"), com a reconciliação idempotente cuidando das edições.

---

## 8. O que fica de FORA (escopo explícito)

- **A tela de Vendas/Faturamento continua existindo** para **registrar a venda / cadastrar o pedido**. O que
  ela **perde é a EMISSÃO** da nota (a emissão passa a ser a porta única de NFS-e, §2), **não** o cadastro do
  pedido. Registrar pedido/venda segue onde está; só o ato de emitir a nota fiscal migra para a tela de NFS-e.
- **NF-e (produto)** não entra nesta etapa — é só NFS-e (serviço), como no #18 v2.
- Boleto/remessa não muda aqui (continua no fluxo de `aberto`).

> ⚠️ **Ponto a confirmar com o Rodrigo antes de aprovar:** a decisão da §8 (a tela de Vendas/Faturamento
> perde a *emissão*, não o *cadastro*). Se o Rodrigo discordar — por exemplo, se ele emite hoje direto da
> tela de Vendas e quer manter isso —, **avisar o CEO antes de aprovar** este SPEC.

---

## 9. Ordem de construção sugerida (quando aprovado)

1. Migration da amarração (§5) — colunas + CHECK do pedido. Provar em rollback.
2. `fn_pedido_gerar_previsao` + plugar no salvar-pedido (§1). Provar: pedido salvo cria `previsto`, painéis
   inalterados (blindagem etapa 1 cobre), fluxo mostra na linha de previsão.
3. `fn_faturar_efetivar` + tela de NFS-e com checkbox de parcelas (§2, §4). Provar: efetivar parcela vira
   `aberto` com `numero_nf`; medição N notas baixa saldo previsto; obra pequena 1 nota.
4. Cancelamento + aba "Receita perdida" (§3).
5. `fn_fluxo_caixa_projecao` separa a linha de previsão (§6).

Cada passo: arquivo → PR próprio → prova em rollback (RD-38) → merge → deploy verde (RD-52).
