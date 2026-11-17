-- Limpa o vazamento e2e da coorte "26x" (Tryo #263/#264/#266) no GE-DEMO, que deixava o board
-- Orçamento→Pedido→Faturamento (/dashboard/commerce/otc) com 968 orçamentos de teste vivos e escondia
-- os poucos orçamentos DEMO reais (auditor_pdca 15/11 20:41, RD-38).
--
-- Causa: os specs tryo-orcando-gera-orcamento-263 e tryo-anexos-264-266 criavam orçamentos
-- ("CLIENTE 263 <run>", "Cliente Orc 264 <run>"…) e no afterAll só marcavam status='cancelado' —
-- deixavam deleted_at NULL. Como a lista do OTC filtra deleted_at IS NULL, a coorte seguia aparecendo
-- (só saía pelo guard de NOME, filtro de superfície). A MESMA PR passa os specs a soft-deletar (deleted_at)
-- o que criam; esta migration drena o resíduo já acumulado (968 linhas vivas → 0).
--
-- Seguro: só DEMO (is_demo=true), escopo estrito pelo padrão do nome de teste (mesmos dois padrões do
-- front, src/app/dashboard/commerce/otc/page.tsx: 'CLIENTE 26_ %' e 'Cliente Orc 26_ %'), idempotente
-- (soft-delete; re-rodar toca 0 vivos). Não toca itens, pedidos nem financeiro (a coorte não gera
-- erp_receber/pedido). Nunca toca dado de cliente real (RD-69/LGPD) — a empresa é a DEMO Comércio.
-- Code: desenvolvedor_4_g

DO $$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000004';
  v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo AND is_demo = true) THEN
    RAISE NOTICE 'empresa % não é DEMO — nada a limpar', v_demo;
    RETURN;
  END IF;

  UPDATE public.erp_orcamentos
     SET deleted_at = now()
   WHERE company_id = v_demo
     AND deleted_at IS NULL
     AND (cliente_nome ILIKE 'CLIENTE 26_ %' OR cliente_nome ILIKE 'Cliente Orc 26_ %');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RAISE NOTICE 'coorte e2e 26x soft-deletada no GE-DEMO: % orçamento(s)', v_n;
END $$;
