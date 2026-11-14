-- Limpa o vazamento de dados de teste e2e ("Cliente Aceitação N") no GE-DEMO, que tornava o board
-- Orçamento→Pedido→Faturamento ilegível e escondia os pedidos DEMO reais (auditor_pdca 14/11, RD-38).
--
-- Causa: fn_demo_seed_ge_comercial só purga as PRÓPRIAS linhas (observacoes='seed:ge-comercial'); os pedidos/
-- orçamentos criados pelos specs e2e ("Cliente Aceitação %") nunca eram limpos e cresciam a cada run (~160 → 2216).
--
-- Seguro: só DEMO (is_demo=true), escopo estrito pelo padrão do nome do cliente de teste, idempotente
-- (re-rodar apaga 0). CASCADE cobre itens/parcelas/orçamentos_itens; provado no dado que NÃO há referência de
-- erp_receber nem de CRM (erp_crm_oportunidade/erp_crm_visita) a essas linhas — então nenhum NO ACTION bloqueia.
-- Preserva os 7 pedidos DEMO reais (Cliente Demo PF / Comércio Demo). Nunca toca dado de cliente real (RD-69/LGPD).
-- Code: code-desenvolvedor-3

DO $$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_ped int;
  v_orc int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_bot AND is_demo = true) THEN
    RAISE NOTICE 'empresa % não é DEMO — nada a limpar', v_bot;
    RETURN;
  END IF;

  DELETE FROM public.erp_pedidos
   WHERE company_id = v_bot AND cliente_nome ILIKE 'Cliente Aceita%';
  GET DIAGNOSTICS v_ped = ROW_COUNT;

  DELETE FROM public.erp_orcamentos
   WHERE company_id = v_bot AND cliente_nome ILIKE 'Cliente Aceita%';
  GET DIAGNOSTICS v_orc = ROW_COUNT;

  RAISE NOTICE 'vazamento e2e limpo no GE-DEMO: % pedidos, % orçamentos', v_ped, v_orc;
END $$;
