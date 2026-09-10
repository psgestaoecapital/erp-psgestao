# SPEC · Faturamento de NFS-e em dois momentos + financeiro previsto→efetivo (chamado #18 v2)

> **Origem:** chamado #18, alinhado CEO + Rodrigo (10/09). **Escopo: só NFS-e** (a NF-e ficou de fora).
> **Status:** SPEC para validação. **Não codar** — é arquitetura de faturamento e mexe no financeiro/DRE.
> RD-26/RD-38: auditado o que já existe antes de propor (§2).

---

## 1. A regra — dois momentos separados

**MOMENTO 1 · O PEDIDO (tela de Vendas)** — cliente, serviços, quantidade, valor, parcelas/vencimentos.
**Nada de fiscal:** sem alíquota de ISS, sem CNO, sem endereço de obra. Quem digita o pedido não precisa
saber de imposto.

**MOMENTO 2 · O FATURAMENTO (tela de NFS-e)** — puxa o pedido e AÍ preenche o fiscal (ISS, CNO quando
houver, endereço da obra, retenções) e emite a NFS-e. **O botão de emitir na tela de NFS-e continua** —
o que muda é que ele passa a **puxar o pedido** em vez de exigir digitação do zero.

## 2. O que JÁ existe (auditoria — RD-38)

- **`fn_faturar(p_pedido_id, p_local_id)` é o ÚNICO ponto que cria conta a receber a partir do pedido.**
  Hoje ele, no FATURAMENTO: baixa estoque + CMV, cria `erp_receber` (**status `'aberto'`**, 1 título por
  parcela de `erp_pedidos_parcelas`, ou 1 à vista), e marca o pedido `faturado`/`titulos_gerados=true`.
- **O pedido (criado por `fn_converter_orcamento_em_pedido`) gera parcelas, mas NENHUM `erp_receber`.**
  → **Não existe previsão hoje.** O recebível nasce direto `'aberto'`, só quando fatura.
- **Emissão de NFS-e já é separada do faturar** (modais "Emitir NFS-e" nas verticais + `fn_registrar_nfse_emitida`).
- `erp_receber` já tem **`origem_recebivel_id`** e **`data_previsao`** (peças prontas para reusar).
- `erp_receber.status` CHECK atual: `aberto·pago·parcial·vencido·cancelado·renegociado` — **sem `previsto`**.

**Resposta direta do CEO:** o que cria receber de pedido é `fn_faturar`; hoje cria `'aberto'` no
faturamento. O trabalho é **mudar o estado inicial** (nascer `'previsto'` no pedido) e **efetivar** no
faturamento — não construir do zero.

## 3. Proposta — financeiro em dois estágios

### 3.1 Nasce no PEDIDO como PREVISÃO
Ao criar o pedido (com parcelas), gerar `erp_receber` com **`status='previsto'`**, `data_previsao` =
vencimento previsto, `origem_recebivel_id` = pedido/parcela. Aparece no **fluxo de caixa como PREVISTO**;
**não** conta como receita efetiva.
- Adicionar `'previsto'` ao CHECK de `erp_receber.status`.

### 3.2 Efetiva no FATURAMENTO
No faturamento (emissão da NFS-e puxando o pedido), a previsão vira recebível de verdade: o título
`'previsto'` correspondente vira **`'aberto'`**, ganha `numero_documento` da nota e `data_emissao` real.
- `fn_faturar` deixa de **criar** `'aberto'` do zero e passa a **efetivar** o `'previsto'` existente
  (flip por `origem_recebivel_id`), evitando duplicata. Sem previsão (fluxo legado) → mantém o
  comportamento atual como fallback.

### 3.3 ⚠️ `'previsto'` NÃO entra em soma de receita (a linha do resultado)
Auditoria: **dezenas de funções somam `erp_receber` com `status <> 'cancelado'`** — um `'previsto'` novo
**entraria** nessas somas e **inflaria** DRE/faturamento/dashboards. A regra do CEO exige o contrário.
- **Trocar `status <> 'cancelado'` por `status NOT IN ('cancelado','previsto')`** (ou allowlist explícita)
  em toda soma de RECEITA EFETIVA. Superfícies a ajustar (auditar uma a uma):
  `fn_psgc_recalcular_dre_mes`, `fn_psgc_dre_diario`, `fn_psgc_dre_horizontal_dia`,
  `fn_psgc_painel_executivo`, `fn_psgc_painel_operacional`, `fn_ge_kpis_dashboard`,
  `fn_contador_resumo_competencia`, `fn_resumo_contador_financeiro`, `fn_psgc_dfc_indireto`,
  `fn_balanco_patrimonial`, `fn_ge_listagem_v2`, `fn_inadimplentes_por_status` (previsto não é inadimplência).
- **Fluxo de caixa é a EXCEÇÃO:** `'previsto'` aparece lá **como previsto** (linha separada do efetivo) —
  `fn_fluxo_caixa_projecao` / `fn_psgc_recalcular_fluxo` devem mostrar previsto sem misturar com realizado.
- **Prova obrigatória:** somar receita com e sem uma previsão de teste e confirmar que o total NÃO muda
  (RD-38 — se mudar em qualquer painel, inflou).

## 4. Cancelamento = perda de receita (não DELETE)
Pedido cancelado sem faturar → a previsão vira **`status='cancelado'` + motivo** (some do fluxo de caixa),
mas **fica registrada como PERDA DE RECEITA**. Nova visão "receita perdida" por período e por motivo
(o CEO quer saber quanto se deixou de vender). Nunca DELETE (RD-30).

## 5. Medição (R.R. Serviços) — 1 pedido, N notas
- Obra grande fatura por **medição mensal**: o pedido tem a previsão do **total** (em parcelas previstas);
  **cada NFS-e efetiva a parcela medida**; o **saldo previsto vai baixando**.
- Obra pequena: 1 pedido, 1 nota no fim.
- **Mesmo mecanismo** nos dois: parcelas previstas efetivadas uma a uma. O pedido só fica `faturado`
  quando o saldo previsto zera (parcial enquanto houver saldo).

## 6. Decisões a confirmar com o CEO
1. A previsão nasce em TODO pedido de serviço, ou só quando o cliente marca "vai faturar"? (Proposta: todo
   pedido de serviço com parcelas — é o previsto do fluxo.)
2. Medição: a tela de NFS-e escolhe **quais parcelas** efetivar nesta nota (a "medição do mês"), certo?
3. "Receita perdida": entra num painel próprio ou vira uma aba no financeiro? (Proposta: visão no financeiro.)

## 7. Fora de escopo (agora)
- NF-e (só NFS-e neste #18).
- Uma porta fiscal única / origem_tipo já foi entregue no PR #1373 (fundação); aqui é o fluxo pedido→nota.

## 8. Plano de prova (quando construir)
- ROLLBACK: pedido novo → 1+ `erp_receber` `'previsto'`; DRE/faturamento/painéis **não** mudam (só fluxo,
  como previsto). Faturar → previsto vira `'aberto'` com nº da nota; DRE passa a contar. Sem duplicata.
- Medição: pedido total previsto; 2 notas efetivam 2 parcelas; saldo previsto baixa; pedido `parcial`→`faturado`.
- Cancelar pedido sem faturar → previsão `'cancelado'`+motivo; some do fluxo; aparece em "receita perdida".
- Sem regressão: fluxo legado sem previsão (fn_faturar fallback) continua criando `'aberto'`.
