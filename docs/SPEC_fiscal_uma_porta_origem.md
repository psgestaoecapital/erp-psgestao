# SPEC · Fiscal — UMA PORTA de emissão + origem da nota (chamado #18)

> **Origem:** chamado #18, **aprovado pelo CEO com o Rodrigo presente**. Registrado em
> `erp_contexto_projeto`.
> **Status:** SPEC para validação. **Não codar** — é arquitetura de tela fiscal e mexe no **Hub V8**.

---

## 1. A regra (CEO)

**As verticais NÃO EMITEM — elas entregam.** A vertical (Serviços, Comércio/OTC, Odonto, Oficina,
Projetos…) **prepara** a nota; a **GE (Gestão Empresarial) emite**. É a mesma regra do dinheiro:
quem opera prepara, o núcleo executa o ato fiscal/financeiro.

**UMA PORTA:** só `/dashboard/fiscal/*` emite nota. Ponto único de emissão, numeração, trilha e prova.

## 2. Estado atual (RD-38 — provado no código/schema)

- **TRÊS telas emitem NFS-e hoje:** `/dashboard/fiscal/nfse`, `/dashboard/services/nfse` e
  `/dashboard/commerce/otc` (esta via `fn_pedido_nfse_dados` + `fn_pedido_nfse_marcar_emitida`,
  ancorada no pedido). Emissão real acontece por `/api/fiscal/nfse/emitir`.
- **A nota já tem âncoras, mas ESPALHADAS:** `erp_nfse_emitidas` tem `pedido_id`, `os_id`, `obra_id`
  (colunas separadas); `erp_nfe_emitidas` tem `pedido_id`, `os_id`, `erp_receber_id`,
  `chave_referenciada`. **Não há uma origem unificada.** (Correção do CEO: a **nº 9** NÃO estava
  invisível — ela **aparece** em NFes Emitidas; o que falta é **saber de onde ela veio** e **filtrar**
  por isso. Ela só não surge nas telas ancoradas em pedido/conta a receber, porque nenhuma âncora dessas
  aponta pra ela.)
- **Sem campo de CNO** (Cadastro Nacional de Obras) na nota.

## 3. Proposta

### 3.1 Uma porta
Só `/dashboard/fiscal/*` **emite**. `/dashboard/services/nfse` e `/dashboard/commerce/otc`
**deixam de emitir** — passam a **preparar**: o botão "Faturar" **redireciona** direto pra porta
fiscal **pré-preenchida** (decisão do CEO §6.1: **redireciona, não fila** — fila cria um estado a mais
pra alguém esquecer). A vertical continua **vendo** sua nota (via origem, §3.2), mas o **ato** de
emitir é um só, no Fiscal.

### 3.2 Origem da nota (o que costura tudo sem duplicar)
A nota guarda **`origem_tipo` + `origem_id`**:

```
origem_tipo ∈ (os · obra · pedido · venda · devolucao_compra · avulsa)
origem_id   = id da entidade de origem (NULL quando avulsa)
```

- Unifica os `pedido_id`/`os_id`/`obra_id` de hoje (migração de dados: backfill de `origem_tipo/id`
  a partir das colunas existentes; elas viram derivadas/legado, não se apaga nada — RD-30).
- Faz a nota ser **filtrável na vertical E no Fiscal sem duplicar** (a vertical filtra por
  `origem_tipo/origem_id`; o Fiscal lista todas e mostra a origem).
- **Serve a nº 9 pela razão certa:** a devolução de compra recebe `origem_tipo='devolucao_compra'` —
  não pra "fazer aparecer" (ela já aparece), mas pra dizer **de onde veio** e permitir filtrar/rastrear.

### 3.3 O CNO mora na NOTA, sempre
- **Com obra:** o CNO vem **pré-preenchido da obra**, editável.
- **Sem obra:** o usuário **digita** o CNO.
- **Quem só compra** (não usa Projetos): a **GE emite sem Projetos** — CNO digitado quando a lei exigir.
- Campo novo na nota (ex.: `erp_nfse_emitidas.cno`), independente de existir `obra_id`.

## 4. Corrige o Hub V8 — etapa ⑨ (não estava errado, estava incompleto)
A etapa ⑨ do Hub V8 assumia o CNO **vindo da obra**. Faltava o caminho **sem Hub / sem obra**, em
que o CNO é **digitado**. Os **dois cenários** têm que funcionar:
- **com Hub:** CNO herda da obra (pré-preenchido, editável);
- **sem Hub:** CNO digitado na nota.

## 5. Impacto no V8
Arquitetura de tela fiscal: a porta única `/dashboard/fiscal/*` passa a receber a preparação das
verticais (payload de origem). O V8 ganha o campo de origem e o CNO no fluxo de emissão. As telas
das verticais perdem o botão "emitir" e ganham "preparar / enviar pro Fiscal".

## 6. Decisões a confirmar com o CEO
1. Ao "preparar" numa vertical, o usuário é **redirecionado** para a porta fiscal pré-preenchida,
   ou a nota entra numa **fila de emissão** que a GE processa? (Proposta: redireciona pré-preenchido;
   fila só se a GE quiser revisar em lote.)
2. `origem_tipo` cobre os 6 casos citados — falta algum (ex.: `remessa`, `nfce`)?
3. Backfill: migrar os `pedido_id/os_id/obra_id` atuais para `origem_tipo/id` de uma vez (recomendado)
   e manter as colunas antigas como derivadas por 1 ciclo.

## 7. Fora de escopo (agora)
- Fila de emissão em lote (só se o CEO pedir na decisão §6.1).
- Unificação NF-e × NFS-e num único emissor (cada modelo tem sua porta dentro de `/dashboard/fiscal/*`).

## 8. Plano de prova (quando construir)
- ROLLBACK: nota de cada `origem_tipo` filtrável na vertical certa E no Fiscal, sem duplicar;
  a nº 9 recebe `origem_tipo='devolucao_compra'` (provado: já é assim após o backfill do PR #1373).
- Sem regressão: notas antigas (com `pedido_id/os_id/obra_id`) recebem `origem_tipo/id` no backfill
  e continuam visíveis onde já apareciam.
- CNO: com obra pré-preenche e edita; sem obra digita; emissão sem Projetos funciona.
