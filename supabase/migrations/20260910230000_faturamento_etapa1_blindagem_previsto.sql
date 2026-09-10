-- ============================================================
-- Faturamento #18 v2 · ETAPA 1 — BLINDAGEM antes do 'previsto' existir (ordem do CEO)
-- ============================================================
-- Regra do CEO: blindar as somas de receita PRIMEIRO (narrowing puro, no-op enquanto não há linha
-- 'previsto') e só DEPOIS (etapa 2) subir 'previsto' no CHECK. Se invertesse, haveria uma janela em
-- produção com previsto no banco e as somas ainda não blindadas — e o resultado inflaria.
--
-- DUAS ARMADILHAS achadas na auditoria (documentadas p/ a próxima pessoa — inclusive nós em 3 meses):
--
--  ARMADILHA 1 · TRIGGER que sobrescreve o status. fn_trg_status_lancamento (trg_status_receber)
--    recomputa o status no INSERT/UPDATE e NÃO preservava 'previsto' → uma linha 'previsto' com
--    vencimento no passado virava 'vencido' na hora, e aí era contada como a receber/inadimplência em
--    TODO painel. Sem preservar 'previsto' no trigger, o status 'previsto' é IMPOSSÍVEL. Aqui ele passa
--    a ser preservado (como cancelado/renegociado/estornado já eram). A efetivação (etapa 3) seta
--    status='aberto' explicitamente e deixa o trigger recomputar dali.
--
--  ARMADILHA 2 · LITERAL DE STATUS COMPARTILHADO entre receber e pagar. Vários painéis usam
--    status NOT IN ('pago','cancelado'[,'CANCELADO']) TANTO no somatório de erp_receber QUANTO no de
--    erp_pagar, na MESMA função. Trocar o literal no atacado (add 'previsto') consertaria o receber e
--    mexeria no pagar em silêncio. Por isso NÃO se blinda por literal — blinda-se POR TABELA: uma view
--    v_receber_efetivo (= erp_receber sem 'previsto') e reponta-se só as leituras de RECEBER pra ela.
--    O erp_pagar (tabela diferente) nunca é tocado; o literal compartilhado deixa de importar.
--
-- Protegidos POR NATUREZA (não precisam de view): DRE (soma por data_emissao), caixa (por
-- data_pagamento) e competência do contador (por data_competencia) — o 'previsto' nasce (etapa 3) com
-- essas três datas NULAS, então essas somas o ignoram sozinhas. A view cobre o resto (a receber/AR).
--
-- PROVA (rollback, Tryo Gessos, 2 previstos = 1 vencido + 1 futuro, R$333.333): os 10 painéis auditados
-- ficaram IDÊNTICOS (balanço, DSO, DFC, painel executivo, painel operacional, ge_kpis, inadimplentes,
-- resumo_contador, ge_listagem, contador); balanço contas a receber 1.366.779,93 → 1.366.779,93 (não
-- inflou); FLUXO muda (o previsto aparece — a única que DEVE mostrar; separá-lo em linha própria é etapa 3).

DO $mig$
DECLARE
  f text; d text; d0 text;
  fns text[] := ARRAY[
    'public.fn_balanco_patrimonial(uuid,date)',
    'public.fn_psgc_raiox_1(uuid[],integer,integer,text)',
    'public.fn_psgc_dfc_indireto(uuid[],integer,integer)',
    'public.fn_psgc_painel_executivo(uuid[],integer,integer,text)',
    'public.fn_psgc_painel_operacional(uuid[])',
    'public.fn_ge_kpis_dashboard(uuid)',
    'public.fn_resumo_contador_financeiro(uuid,integer)',
    'public.fn_inadimplentes_por_status(uuid)',
    'public.fn_ge_listagem_v2(uuid,text,date,date,text,text[])'
  ];
BEGIN
  -- (A) trigger preserva 'previsto' (idempotente)
  d0 := pg_get_functiondef('public.fn_trg_status_lancamento()'::regprocedure);
  IF position($p$'estornado','previsto'$p$ in d0) = 0 THEN
    d := replace(d0,
      $x$IN ('cancelado','cancelled','canceled','renegociado','estornado')$x$,
      $y$IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto')$y$);
    IF d = d0 THEN RAISE EXCEPTION 'etapa1: lista de preservados do trigger nao encontrada — abortando'; END IF;
    EXECUTE d;
  END IF;

  -- (B) view "receber efetivo" = tudo menos 'previsto'
  CREATE OR REPLACE VIEW public.v_receber_efetivo AS
    SELECT * FROM public.erp_receber WHERE status IS DISTINCT FROM 'previsto';
  COMMENT ON VIEW public.v_receber_efetivo IS
    'erp_receber SEM os títulos previstos (previsão de pedido não faturado). Somas de RECEITA/A RECEBER leem daqui; o fluxo de caixa lê erp_receber cru (mostra o previsto, separado).';

  -- (C) reponta SÓ referências de tabela (FROM/JOIN [public.]erp_receber) — não toca strings, aliases nem erp_pagar
  FOREACH f IN ARRAY fns LOOP
    d0 := pg_get_functiondef(f::regprocedure);
    d := regexp_replace(d0, '((?:FROM|JOIN)[[:space:]]+(?:public\.)?)erp_receber', '\1v_receber_efetivo', 'gi');
    IF d = d0 THEN
      -- já repontada (re-run) ou não tem FROM erp_receber: só aborta se AINDA houver FROM erp_receber cru
      IF d0 ~* '(FROM|JOIN)[[:space:]]+(public\.)?erp_receber\M' THEN
        RAISE EXCEPTION 'etapa1: repointe falhou em % — abortando', f;
      END IF;
    ELSE
      EXECUTE d;
    END IF;
  END LOOP;
END $mig$;
