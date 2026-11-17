-- PDCA GE (auditor_pdca_2, RD-38) — rota /dashboard/gestao-empresarial/resultado-por-negocio.
-- A tela/calc (fn_ge_resultado_por_negocio_calc) está CORRETA; o problema era de DADO/CONFIG no GE-DEMO
-- (Comércio (GE) - DEMO, b0700000-0000-4000-a000-000000000004): a receita caía toda em "Sem negócio"/
-- "nao_operacional" e as 2 linhas de negócio ficavam sem resultado (metodo_rateio=sem_receita_sem_rateio).
--
-- Causa raiz (2 frentes, só dado/config do DEMO — NÃO toca o código do calc):
--   1. As contas de RECEITA do GE-DEMO não estavam em psgc_depara -> dpr retornava null -> grupo
--      SEM_CLASSIFICACAO -> a tela classificava como nao_operacional em vez de ROB (receita operacional).
--   2. As receber do GE-DEMO não tinham regra em cost_center_map que casasse -> receita sem linha de negócio
--      -> "Sem negócio" -> sem receita atribuída -> sem como ratear os custos comuns.
--
-- Correção ADITIVA e idempotente, só o DEMO, só tabelas de CONFIG (nenhum UPDATE/DELETE em erp_receber/erp_pagar
-- nem em título pago; RD-69/LGPD preservados — empresa is_demo):
--   [1] psgc_depara: "Receita de vendas" -> 1.1 (ROB mercadorias/produtos) e "Receita Recorrente" -> 1.3
--       (ROB contratos recorrentes). Assim a receita deixa de cair como nao_operacional.
--   [2] cost_center_map (source_type='conta'): "Receita de vendas" -> linha Comercial; "Receita Recorrente"
--       -> linha Geral. (O calc ignora centro_custo em receber — só usa linha_negocio/texto/conta — por isso a
--       atribuição é por conta.) Com isso as 2 linhas passam a ter receita e o rateio dos comuns funciona.
--   [3] system_screens.views_consumidas desta rota: estava {erp_lancamentos,erp_pec_propriedade} (o calc NÃO usa
--       erp_lancamentos) -> corrige para as origens reais (RD-98 pilar 3).
--
-- PROVA RD-38 (fn_ge_resultado_por_negocio_calc, período 2026, competência), no corpo da PR:
--   ANTES: metodo_rateio=sem_receita_sem_rateio; 1 linha ("Geral") receita 0; sem_negocio.outras R$ 33.075,69.
--   DEPOIS: metodo_rateio=receita; Comercial receita R$ 18.541,28 / resultado +R$ 2.703,17 (88,54% do rateio);
--           Geral receita R$ 2.400,00 / resultado -R$ 3.400,10 (11,46%); sem_negocio.outras R$ 12.134,41
--           (resíduo de 14 lançamentos de categoria NULL, fora do escopo desta tarefa).
-- Code: code-desenvolvedor-3

DO $$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_geral uuid;
  v_comercial uuid;
BEGIN
  -- Só aplica se a empresa for DEMO (segurança: nunca toca config de cliente real).
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_bot AND is_demo = true) THEN
    RAISE NOTICE 'empresa % não é DEMO — nada a configurar', v_bot;
    RETURN;
  END IF;

  SELECT id INTO v_geral     FROM public.business_lines WHERE company_id = v_bot AND lower(name) = 'geral'     AND is_active LIMIT 1;
  SELECT id INTO v_comercial FROM public.business_lines WHERE company_id = v_bot AND lower(name) = 'comercial' AND is_active LIMIT 1;
  IF v_geral IS NULL OR v_comercial IS NULL THEN
    RAISE NOTICE 'linhas de negócio Geral/Comercial não encontradas no GE-DEMO — abortando config';
    RETURN;
  END IF;

  -- [1] Receita -> ROB (de-para do PSGC)
  INSERT INTO public.psgc_depara (company_id, origem_codigo, origem_sistema, psgc_codigo, metodo, confianca, revisado, ativo, observacao)
  VALUES
    (v_bot, 'Receita de vendas',  'erp', '1.1', 'manual', 100, true, true, 'DEMO GE: receita de vendas -> ROB (resultado por negócio)'),
    (v_bot, 'Receita Recorrente', 'erp', '1.3', 'manual', 100, true, true, 'DEMO GE: receita recorrente -> ROB (resultado por negócio)')
  ON CONFLICT (company_id, origem_codigo, origem_sistema)
  DO UPDATE SET psgc_codigo = EXCLUDED.psgc_codigo, ativo = true, revisado = true, updated_at = now();

  -- [2] Atribuição por conta -> linha de negócio
  INSERT INTO public.cost_center_map (company_id, source_type, source_key, business_line_id, allocation_pct, cost_scope, priority, ativo, tipo_apropriacao)
  VALUES
    (v_bot, 'conta', 'Receita de vendas',  v_comercial, 100, 'todos', 5, true, 'direto'),
    (v_bot, 'conta', 'Receita Recorrente', v_geral,     100, 'todos', 5, true, 'direto')
  ON CONFLICT (company_id, source_type, source_key, business_line_id, cost_scope)
  DO UPDATE SET ativo = true, allocation_pct = EXCLUDED.allocation_pct, updated_at = now();

  RAISE NOTICE 'GE-DEMO resultado-por-negócio configurado: receita -> ROB + atribuição por linha';
END $$;

-- [3] Metadata da rota: origens reais que o calc consome (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_pagar','erp_receber','business_lines','cost_center_map','psgc_depara','psgc_contas','erp_plano_contas']::text[]
 WHERE rota = '/dashboard/gestao-empresarial/resultado-por-negocio';
