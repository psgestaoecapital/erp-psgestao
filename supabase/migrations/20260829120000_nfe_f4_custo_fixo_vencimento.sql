-- NFE-F4 · correção do rateio de custo fixo (RD-44/45 · diagnóstico do CEO refinado pela auditoria).
--
-- Premissa do CEO: "a janela >= CURRENT_DATE-90 não tinha teto superior; limite para
-- BETWEEN CURRENT_DATE-90 AND CURRENT_DATE". Auditei e o teto SOZINHO não resolve: os 48 lançamentos
-- de salário da KGF (categoria 2.03.01, R$ 199.913) estão COLAPSADOS em data_competencia = 2026-07-01
-- (artefato de importação), todos dentro da janela — então por competência o custo fixo continua R$ 260 mil
-- e o rateio 259%. Quem espalha os salários futuros (74 lançamentos com vencimento até 2027-08) é o
-- data_VENCIMENTO. Medido:
--   custo fixo por vencimento [teto] = R$ 22.187  ·  faturamento por vencimento [teto] = R$ 68.380
--   → rateio = 32,45% (são; era 259% por competência).
-- Correção: o rateio passa a usar data_vencimento nos DOIS lados (obrigações e recebíveis que vencem nos
-- últimos 90 dias), com o teto. Faturamento usa `valor` (o faturado), não `valor_pago` — confirmado: usar
-- valor_pago cortaria o faturamento pela metade (87 recebíveis da KGF têm valor_pago = 0).
--
-- Datas corrompidas (0002 / 20026): confirmado que NÃO afetam o rateio — o teto (<= CURRENT_DATE) exclui as
-- futuras e o piso (>= CURRENT_DATE-90) exclui as antigas. (Eram parcelas OMIE legítimas da Tryo Gesso, até 2033.)
--
-- Guarda de "rateio >= 100%": mantida como REDE DE SEGURANÇA transparente. Com o campo certo a KGF fica em
-- 32%, então ela não dispara mais; mas se alguma empresa tiver custo fixo real > faturamento registrado no
-- período, um % >= 100 não é dedução usável (trava TODO produto em "margem impossível") — RD-51 manda entrar
-- 0 + aviso com os números reais, nunca um número que finge precisão.

CREATE OR REPLACE FUNCTION public.fn_produto_margem_real(p_company_id uuid, p_custo numeric, p_preco numeric, p_produto_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  o erp_oficina_parametros%ROWTYPE; c erp_precificacao_config%ROWTYPE; v_tem_precif boolean;
  v_imp_pct numeric := 0; v_pc_pct numeric := 0; v_cred numeric := 0; v_com_pct numeric := 0; v_cf_pct numeric := 0;
  v_mono boolean := false; v_avisos jsonb := '[]'::jsonb;
  v_imp numeric; v_com numeric; v_cf numeric; v_ded_pct numeric; v_margem numeric; v_equil numeric; v_fonte text;
  v_regime text; v_sn_pct numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_preco,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','preco_invalido'); END IF;
  SELECT * INTO o FROM erp_oficina_parametros WHERE company_id=p_company_id;
  SELECT * INTO c FROM erp_precificacao_config WHERE company_id=p_company_id AND COALESCE(ativo,true) ORDER BY vigencia_inicio DESC NULLS LAST LIMIT 1;
  v_tem_precif := FOUND;
  IF p_produto_id IS NOT NULL THEN v_mono := fn_produto_monofasico(p_company_id, p_produto_id); END IF;

  -- regime tributário + alíquota Simples da config fiscal ATIVA (RD-44/45: a alíquota já existe)
  SELECT regime_tributario, percentual_total_tributos_sn INTO v_regime, v_sn_pct
    FROM erp_fiscal_provider_config
   WHERE company_id=p_company_id AND ativo=true
   ORDER BY (percentual_total_tributos_sn IS NOT NULL) DESC, atualizado_em DESC NULLS LAST
   LIMIT 1;

  -- imposto de venda, em ordem de prioridade:
  --   1) override explícito da empresa (o.imposto_venda_pct) — também é a alavanca pra separar peça (Anexo I) de serviço
  --   2) Simples Nacional → % total de tributos aprox. do DAS (all-in; NÃO soma PIS/COFINS por cima)
  --   3) precificacao_config do Hub (ICMS + PIS/COFINS − créditos)
  --   4) nada → 0 + aviso
  IF o.imposto_venda_pct IS NOT NULL THEN
    v_imp_pct := o.imposto_venda_pct; v_pc_pct := COALESCE(o.pis_cofins_venda_pct,0); v_cred := 0;
    v_fonte := 'override_empresa';
  ELSIF v_regime='simples_nacional' AND v_sn_pct IS NOT NULL THEN
    v_imp_pct := v_sn_pct; v_pc_pct := 0; v_cred := 0;
    v_fonte := 'simples_nacional_das';
    v_avisos := v_avisos || to_jsonb(format('Imposto = %s%% do Simples (%% total de tributos aprox., Anexo III / serviço). Peça é Anexo I e pode ter alíquota diferente — cadastre o imposto da venda pra sobrescrever se precisar.', trim_scale(v_sn_pct))::text);
  ELSE
    v_imp_pct := c.icms_pct; v_pc_pct := COALESCE(o.pis_cofins_venda_pct, c.pis_cofins_pct, 0); v_cred := COALESCE(c.creditos_pct,0);
    IF v_imp_pct IS NULL AND NOT v_tem_precif THEN v_avisos := v_avisos || to_jsonb('imposto de venda não configurado — cadastre a alíquota (Simples/ICMS) nos parâmetros'::text); v_imp_pct := 0; END IF;
    v_fonte := CASE WHEN v_tem_precif THEN 'precificacao_config' ELSE 'parametros_empresa' END;
  END IF;

  -- monofásico zera a parte de PIS/COFINS — só relevante fora do DAS all-in (segregação de receita no SN fica p/ depois)
  IF v_mono AND v_fonte <> 'simples_nacional_das' THEN v_pc_pct := 0; v_fonte := 'monofasico_pis_cofins_zero'; END IF;
  v_imp_pct := GREATEST(COALESCE(v_imp_pct,0) + v_pc_pct - v_cred, 0);

  -- comissão
  v_com_pct := COALESCE(o.comissao_venda_pct, c.comissao_pct);
  IF v_com_pct IS NULL THEN v_avisos := v_avisos || to_jsonb('comissão não configurada — entrou 0'::text); v_com_pct := 0; END IF;

  -- custo fixo: config direta → rateio por VENCIMENTO nos últimos 90 dias (categorias ÷ faturamento) → 0 + aviso.
  -- Usa data_vencimento (não competência) porque a competência de salário vem colapsada num dia só; o
  -- vencimento espalha as obrigações no tempo. Faturamento usa `valor` (o faturado), não valor_pago.
  v_cf_pct := o.custo_fixo_pct;
  IF v_cf_pct IS NULL AND o.categorias_custo_fixo IS NOT NULL THEN
    DECLARE v_cf_val numeric; v_fat numeric;
    BEGIN
      SELECT (SELECT COALESCE(sum(valor),0) FROM erp_pagar WHERE company_id=p_company_id AND categoria = ANY(o.categorias_custo_fixo) AND data_vencimento BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE),
             (SELECT COALESCE(sum(valor),0) FROM erp_receber WHERE company_id=p_company_id AND data_vencimento BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE)
        INTO v_cf_val, v_fat;
      IF COALESCE(v_fat,0) > 0 THEN
        v_cf_pct := round(v_cf_val/v_fat*100, 4);
        -- RD-51 · rede de segurança: rateio >= 100% não é dedução usável → 0 + aviso com os números reais
        IF v_cf_pct >= 100 THEN
          v_avisos := v_avisos || to_jsonb(format('Custo fixo dos últimos 90 dias (R$ %s) passou do faturamento registrado (R$ %s) — o rateio de %s%% não é confiável e entrou 0. Confira lançamentos e faturamento do período.', trim_scale(round(v_cf_val,2)), trim_scale(round(v_fat,2)), trim_scale(v_cf_pct))::text);
          v_cf_pct := 0;
        END IF;
      END IF;
    END;
  END IF;
  IF v_cf_pct IS NULL THEN v_avisos := v_avisos || to_jsonb('custo fixo estimado em 0 — meta de produção/faturamento não cadastrado'::text); v_cf_pct := 0; END IF;

  v_imp := round(p_preco * v_imp_pct/100, 2);
  v_com := round(p_preco * v_com_pct/100, 2);
  v_cf  := round(p_preco * v_cf_pct/100, 2);
  v_ded_pct := v_imp_pct + v_com_pct + v_cf_pct;
  v_margem := p_preco - COALESCE(p_custo,0) - v_imp - v_com - v_cf;
  v_equil := CASE WHEN v_ded_pct < 100 THEN round(COALESCE(p_custo,0)/(1 - v_ded_pct/100), 2) ELSE NULL END;

  RETURN jsonb_build_object('ok',true,'preco',p_preco,'custo',p_custo,
    'markup_pct', CASE WHEN COALESCE(p_custo,0)>0 THEN round((p_preco/p_custo - 1)*100,2) END,
    'deducoes', jsonb_build_object('imposto_venda',v_imp,'comissao',v_com,'custo_fixo',v_cf,
      'pct', jsonb_build_object('imposto',v_imp_pct,'comissao',v_com_pct,'custo_fixo',v_cf_pct)),
    'margem_liquida', round(v_margem,2), 'margem_liquida_pct', round(v_margem/p_preco*100,2),
    'preco_equilibrio', v_equil, 'monofasico', v_mono, 'fonte_imposto', v_fonte, 'avisos', v_avisos);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_produto_margem_real(uuid,numeric,numeric,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_produto_margem_real(uuid,numeric,numeric,uuid) TO authenticated, service_role;
