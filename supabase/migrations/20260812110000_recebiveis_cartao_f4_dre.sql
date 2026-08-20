-- ============================================================
-- Recebíveis de Cartão · F4 — DRE competência × caixa (SENSÍVEL · RD-53)
-- Filtros ADITIVOS nas leituras de erp_receber do motor PSGC + auditores:
--   · competência (data_emissao): exclui eh_repasse_cartao (o recebível da adquirente NÃO é receita).
--   · caixa (data_pagamento): exclui a baixa da venda no cartão (forma cartao_*); o repasse recebido entra.
-- Sempre-verdadeiro p/ quem não usa cartão → não-regressão (DRE de cliente sem cartão idêntico).
-- Injeção EXATA via pg_get_functiondef + replace (sem retype das funções de 12KB), IDEMPOTENTE (só injeta
-- se ainda não houver o filtro). Já aplicado em prod via MCP; este arquivo é o registro/replay seguro.
-- ============================================================
DO $mig$
DECLARE d text;
BEGIN
  -- 1) fn_psgc_recalcular_dre_mes (motor mensal → psgc_dre)
  d := pg_get_functiondef('public.fn_psgc_recalcular_dre_mes'::regproc);
  IF d NOT LIKE '%eh_repasse_cartao%' THEN
    d := replace(d,
      $q$r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL$q$,
      $q$r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)$q$);
    d := replace(d,
      $q$r.data_pagamento::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL$q$,
      $q$r.data_pagamento::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')$q$);
    EXECUTE d;
  END IF;

  -- 2) fn_psgc_dre_diario (regime dinâmico v_regime)
  d := pg_get_functiondef('public.fn_psgc_dre_diario'::regproc);
  IF d NOT LIKE '%eh_repasse_cartao%' THEN
    d := replace(d,
      $q$r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim$q$,
      $q$r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim AND (CASE WHEN v_regime='caixa' THEN COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito') ELSE NOT COALESCE(r.eh_repasse_cartao,false) END)$q$);
    EXECUTE d;
  END IF;

  -- 3) fn_psgc_dre_horizontal_dia (regime dinâmico v_regime)
  d := pg_get_functiondef('public.fn_psgc_dre_horizontal_dia'::regproc);
  IF d NOT LIKE '%eh_repasse_cartao%' THEN
    d := replace(d,
      $q$r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim$q$,
      $q$r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim AND (CASE WHEN v_regime='caixa' THEN COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito') ELSE NOT COALESCE(r.eh_repasse_cartao,false) END)$q$);
    EXECUTE d;
  END IF;

  -- 4) fn_truth_audit_dre — ground-truth de receita consistente com o motor (exclui repasse)
  d := pg_get_functiondef('public.fn_truth_audit_dre'::regproc);
  IF d NOT LIKE '%eh_repasse_cartao%' THEN
    d := replace(d,
      $q$FROM erp_receber r WHERE r.valor > 0 AND r.data_emissao IS NOT NULL$q$,
      $q$FROM erp_receber r WHERE r.valor > 0 AND r.data_emissao IS NOT NULL AND NOT COALESCE(r.eh_repasse_cartao,false)$q$);
    EXECUTE d;
  END IF;

  -- 5) v_dre_receita_3_fontes — ground_truth de receita (auditoria 3 fontes) exclui repasse
  d := 'CREATE OR REPLACE VIEW public.v_dre_receita_3_fontes AS ' || pg_get_viewdef('public.v_dre_receita_3_fontes'::regclass, true);
  IF d NOT LIKE '%eh_repasse_cartao%' THEN
    d := replace(d,
      $q$WHERE erp_receber.data_emissao IS NOT NULL$q$,
      $q$WHERE erp_receber.data_emissao IS NOT NULL AND NOT COALESCE(erp_receber.eh_repasse_cartao, false)$q$);
    EXECUTE d;
  END IF;
END $mig$;
