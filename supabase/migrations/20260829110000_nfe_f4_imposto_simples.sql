-- NFE-F4 · correção (RD-44/45): a alíquota do Simples JÁ EXISTE e está preenchida.
-- Está em erp_fiscal_provider_config.percentual_total_tributos_sn (KGF = 6,00), na config ATIVA
-- (ativo = true → focusnfe; a gov_nfse_nacional está inativa). fn_produto_margem_real deixava o
-- imposto em 0 + aviso porque só olhava erp_oficina_parametros/erp_precificacao_config. Agora, quando
-- regime_tributario = 'simples_nacional', lê esse campo como imposto de venda (o DAS é all-in — não soma
-- PIS/COFINS por cima). RD-26: não cria tela nem tabela; reusa a config fiscal que já existe.
--
-- ⚠️ HONESTIDADE (RD-58/RD-51): esse % é a alíquota de SERVIÇO (Anexo III · o migration que criou o campo
-- documenta "KGF: 6,00 Anexo III serviços"). A precificação em massa precifica PEÇA (Anexo I), que pode ter
-- alíquota diferente. Enquanto o CEO não decidir separar, o motor usa 6% para peça E emite um aviso dizendo
-- que é a taxa de serviço — nunca finge precisão. O override por empresa (imposto_venda_pct) já é a alavanca
-- para separar sem inventar número.
--
-- Comissão continua sem campo em lugar nenhum (confirmado): a coluna comissao_venda_pct existe (F4) mas
-- nada a preenchia. A tela de custo ganha um campo simples pra imposto (override) e comissão da venda.

-- ── imposto de venda com consciência do regime tributário (config fiscal ativa) ──────────────────────
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

  -- custo fixo: config direta → rateio (categorias ÷ faturamento 90d) → 0 + aviso
  -- RD-51: rateio ≥ 100% NÃO é dedução confiável (custo fixo passou do faturamento registrado no
  -- contas a receber — falta registrar faturamento ou as categorias estão largas). Nesse caso entra 0 +
  -- aviso com os números reais, nunca um % inventado que faz TODO produto virar "margem impossível".
  v_cf_pct := o.custo_fixo_pct;
  IF v_cf_pct IS NULL AND o.categorias_custo_fixo IS NOT NULL THEN
    DECLARE v_cf_val numeric; v_fat numeric;
    BEGIN
      SELECT (SELECT COALESCE(sum(valor),0) FROM erp_pagar WHERE company_id=p_company_id AND categoria = ANY(o.categorias_custo_fixo) AND data_competencia >= CURRENT_DATE - 90),
             (SELECT COALESCE(sum(valor),0) FROM erp_receber WHERE company_id=p_company_id AND data_competencia >= CURRENT_DATE - 90)
        INTO v_cf_val, v_fat;
      IF COALESCE(v_fat,0) > 0 THEN
        v_cf_pct := round(v_cf_val/v_fat*100, 4);
        IF v_cf_pct >= 100 THEN
          v_avisos := v_avisos || to_jsonb(format('Custo fixo dos últimos 90 dias (R$ %s) passou do faturamento registrado no contas a receber (R$ %s) — o rateio de %s%% não é confiável e entrou 0. Cadastre a meta (custo_fixo_pct) ou registre o faturamento.', trim_scale(round(v_cf_val,2)), trim_scale(round(v_fat,2)), trim_scale(v_cf_pct))::text);
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
