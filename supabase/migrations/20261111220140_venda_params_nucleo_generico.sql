-- PDCA GE · /dashboard/compras/custo-config — Princípio 1 (NÚCLEO UNIVERSAL)
-- Desacopla os parâmetros de VENDA (imposto / comissão / PIS-COFINS da venda) da tabela da vertical
-- AUTOMOTIVA erp_oficina_parametros para uma tabela GENÉRICA de núcleo: erp_venda_params.
--
-- Por quê: a seção "Imposto e comissão da venda" do custo-config renderiza para TODA empresa (conceito de
-- núcleo, usado na margem real da precificação), mas persistia em erp_oficina_parametros via
-- fn_oficina_venda_params_salvar, que exige "configure a oficina primeiro" — logo uma empresa pura de
-- comércio (ex.: Comércio (GE) - DEMO b0700000-0000-4000-a000-000000000004, sem linha de oficina) NÃO
-- conseguia nem salvar. A fonte semanticamente errada acoplava o núcleo à vertical.
--
-- Esta migration é ADITIVA e idempotente (RD-52): cria a fonte genérica, RPCs guardadas, faz backfill
-- sem clobber e migra o leitor de cálculo (fn_produto_margem_real). NÃO apaga nem altera dado em
-- erp_oficina_parametros (os campos de venda legados ficam lá; os campos automotivos SÃO da vertical e
-- permanecem). Anti-regressão (Princípio 5): a ordem de prioridade do imposto/comissão na margem é
-- preservada — o número da margem NÃO muda (hoje os 4 registros de oficina têm os 3 campos de venda
-- NULOS, então vp.* = o.* = NULL e o cálculo é idêntico).

-- ========================================================================================
-- 1) Tabela genérica de VENDA do núcleo
-- ========================================================================================
CREATE TABLE IF NOT EXISTS public.erp_venda_params (
  company_id            uuid PRIMARY KEY,
  imposto_venda_pct     numeric,
  comissao_venda_pct    numeric,
  pis_cofins_venda_pct  numeric,
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_por        uuid
);

ALTER TABLE public.erp_venda_params ENABLE ROW LEVEL SECURITY;

-- RLS por empresa (padrão do núcleo — igual a erp_precificacao_parametros)
DROP POLICY IF EXISTS erp_venda_params_empresa ON public.erp_venda_params;
CREATE POLICY erp_venda_params_empresa ON public.erp_venda_params
  FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON TABLE public.erp_venda_params FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_venda_params TO authenticated;
GRANT ALL ON TABLE public.erp_venda_params TO service_role;

-- ========================================================================================
-- 2) RPCs guardadas (genéricas, por empresa)
-- ========================================================================================

-- Ler os parâmetros de venda da empresa
CREATE OR REPLACE FUNCTION public.fn_venda_params_obter(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r public.erp_venda_params%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO r FROM public.erp_venda_params WHERE company_id = p_company_id;
  RETURN jsonb_build_object(
    'ok', true,
    'imposto_venda_pct', r.imposto_venda_pct,
    'comissao_venda_pct', r.comissao_venda_pct,
    'pis_cofins_venda_pct', r.pis_cofins_venda_pct);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_venda_params_obter(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_venda_params_obter(uuid) TO authenticated, service_role;

-- Salvar os parâmetros de venda da empresa (upsert, com trilha em audit_log_global).
-- p_imposto_venda_pct / p_comissao_venda_pct: NULL explícito = limpar (usa o regime automaticamente).
-- p_pis_cofins_venda_pct: a tela de custo-config NÃO gerencia este campo; quando vem NULL, PRESERVA o
-- valor existente (COALESCE) para não apagar um dado que a UI não edita. Campo reservado p/ UI futura.
CREATE OR REPLACE FUNCTION public.fn_venda_params_salvar(
  p_company_id uuid,
  p_imposto_venda_pct numeric,
  p_comissao_venda_pct numeric,
  p_pis_cofins_venda_pct numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_ant public.erp_venda_params%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF p_imposto_venda_pct IS NOT NULL AND (p_imposto_venda_pct < 0 OR p_imposto_venda_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'o imposto da venda deve ficar entre 0 e 100%'); END IF;
  IF p_comissao_venda_pct IS NOT NULL AND (p_comissao_venda_pct < 0 OR p_comissao_venda_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'a comissão da venda deve ficar entre 0 e 100%'); END IF;
  IF p_pis_cofins_venda_pct IS NOT NULL AND (p_pis_cofins_venda_pct < 0 OR p_pis_cofins_venda_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'o PIS/COFINS da venda deve ficar entre 0 e 100%'); END IF;

  SELECT * INTO v_ant FROM public.erp_venda_params WHERE company_id = p_company_id;

  INSERT INTO public.erp_venda_params AS vp
    (company_id, imposto_venda_pct, comissao_venda_pct, pis_cofins_venda_pct, atualizado_em, atualizado_por)
  VALUES
    (p_company_id, p_imposto_venda_pct, p_comissao_venda_pct, p_pis_cofins_venda_pct, now(), v_uid)
  ON CONFLICT (company_id) DO UPDATE SET
    imposto_venda_pct    = EXCLUDED.imposto_venda_pct,
    comissao_venda_pct   = EXCLUDED.comissao_venda_pct,
    pis_cofins_venda_pct = COALESCE(EXCLUDED.pis_cofins_venda_pct, vp.pis_cofins_venda_pct),
    atualizado_em        = now(),
    atualizado_por       = v_uid;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_venda_params', p_company_id::text,
          'venda_params_salvar',
          jsonb_build_object('imposto_venda_pct', v_ant.imposto_venda_pct, 'comissao_venda_pct', v_ant.comissao_venda_pct, 'pis_cofins_venda_pct', v_ant.pis_cofins_venda_pct),
          jsonb_build_object('imposto_venda_pct', p_imposto_venda_pct, 'comissao_venda_pct', p_comissao_venda_pct, 'pis_cofins_venda_pct', p_pis_cofins_venda_pct));

  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_venda_params_salvar(uuid, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_venda_params_salvar(uuid, numeric, numeric, numeric) TO authenticated, service_role;

-- ========================================================================================
-- 3) Backfill idempotente (não clobbera o que já exista na fonte nova)
-- ========================================================================================
INSERT INTO public.erp_venda_params (company_id, imposto_venda_pct, comissao_venda_pct, pis_cofins_venda_pct, atualizado_em)
SELECT company_id, imposto_venda_pct, comissao_venda_pct, pis_cofins_venda_pct, now()
FROM public.erp_oficina_parametros
WHERE imposto_venda_pct IS NOT NULL
   OR comissao_venda_pct IS NOT NULL
   OR pis_cofins_venda_pct IS NOT NULL
ON CONFLICT (company_id) DO NOTHING;

-- ========================================================================================
-- 4) Migrar o leitor de cálculo: fn_produto_margem_real passa a ler a VENDA da fonte genérica
--    (mesma ordem de prioridade; custo_fixo continua vindo da oficina — fora do escopo desta migration).
--    Função SENSÍVEL (CREATE OR REPLACE existente): leva revisao-eng-chefe + MERGE AUTORIZADO.
-- ========================================================================================
CREATE OR REPLACE FUNCTION public.fn_produto_margem_real(p_company_id uuid, p_custo numeric, p_preco numeric, p_produto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o erp_oficina_parametros%ROWTYPE; c erp_precificacao_config%ROWTYPE; v_tem_precif boolean;
  vp erp_venda_params%ROWTYPE;
  v_imp_pct numeric := 0; v_pc_pct numeric := 0; v_cred numeric := 0; v_com_pct numeric := 0; v_cf_pct numeric := 0;
  v_mono boolean := false; v_avisos jsonb := '[]'::jsonb;
  v_imp numeric; v_com numeric; v_cf numeric; v_ded_pct numeric; v_margem numeric; v_equil numeric; v_fonte text;
  v_regime text; v_sn_pct numeric;
  v_ge_imp numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_preco,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','preco_invalido'); END IF;
  SELECT * INTO o FROM erp_oficina_parametros WHERE company_id=p_company_id;
  -- parâmetros de VENDA do núcleo (genérico, qualquer ramo) — substitui a leitura dos campos de venda da oficina
  SELECT * INTO vp FROM erp_venda_params WHERE company_id=p_company_id;
  SELECT * INTO c FROM erp_precificacao_config WHERE company_id=p_company_id AND COALESCE(ativo,true) ORDER BY vigencia_inicio DESC NULLS LAST LIMIT 1;
  v_tem_precif := FOUND;
  IF p_produto_id IS NOT NULL THEN v_mono := fn_produto_monofasico(p_company_id, p_produto_id); END IF;

  -- parâmetro de imposto do GE (erp_precificacao_parametros) — fonte de maior prioridade, sem tocar oficina/fiscal
  SELECT imposto_venda_pct INTO v_ge_imp FROM erp_precificacao_parametros WHERE company_id=p_company_id;

  -- regime tributário + alíquota Simples da config fiscal ATIVA (RD-44/45: a alíquota já existe)
  SELECT regime_tributario, percentual_total_tributos_sn INTO v_regime, v_sn_pct
    FROM erp_fiscal_provider_config
   WHERE company_id=p_company_id AND ativo=true
   ORDER BY (percentual_total_tributos_sn IS NOT NULL) DESC, atualizado_em DESC NULLS LAST
   LIMIT 1;

  -- imposto de venda, em ordem de prioridade:
  --   0) parâmetro do GE (erp_precificacao_parametros.imposto_venda_pct) — informado na tela de Precificação
  --   1) override explícito da empresa (vp.imposto_venda_pct) — também é a alavanca pra separar peça (Anexo I) de serviço
  --   2) Simples Nacional → % total de tributos aprox. do DAS (all-in; NÃO soma PIS/COFINS por cima)
  --   3) precificacao_config do Hub (ICMS + PIS/COFINS − créditos)
  --   4) nada → 0 + aviso
  IF v_ge_imp IS NOT NULL THEN
    v_imp_pct := v_ge_imp; v_pc_pct := 0; v_cred := 0;
    v_fonte := 'parametros_ge';
  ELSIF vp.imposto_venda_pct IS NOT NULL THEN
    v_imp_pct := vp.imposto_venda_pct; v_pc_pct := COALESCE(vp.pis_cofins_venda_pct,0); v_cred := 0;
    v_fonte := 'override_empresa';
  ELSIF v_regime='simples_nacional' AND v_sn_pct IS NOT NULL THEN
    v_imp_pct := v_sn_pct; v_pc_pct := 0; v_cred := 0;
    v_fonte := 'simples_nacional_das';
    v_avisos := v_avisos || to_jsonb(format('Imposto = %s%% do Simples (%% total de tributos aprox., Anexo III / serviço). Peça é Anexo I e pode ter alíquota diferente — cadastre o imposto da venda pra sobrescrever se precisar.', trim_scale(v_sn_pct))::text);
  ELSE
    v_imp_pct := c.icms_pct; v_pc_pct := COALESCE(vp.pis_cofins_venda_pct, c.pis_cofins_pct, 0); v_cred := COALESCE(c.creditos_pct,0);
    IF v_imp_pct IS NULL AND NOT v_tem_precif THEN v_avisos := v_avisos || to_jsonb('imposto de venda não configurado — cadastre a alíquota (Simples/ICMS) nos parâmetros'::text); v_imp_pct := 0; END IF;
    v_fonte := CASE WHEN v_tem_precif THEN 'precificacao_config' ELSE 'parametros_empresa' END;
  END IF;

  -- monofásico zera a parte de PIS/COFINS — só relevante fora do DAS all-in (segregação de receita no SN fica p/ depois)
  IF v_mono AND v_fonte <> 'simples_nacional_das' THEN v_pc_pct := 0; v_fonte := 'monofasico_pis_cofins_zero'; END IF;
  v_imp_pct := GREATEST(COALESCE(v_imp_pct,0) + v_pc_pct - v_cred, 0);

  -- comissão
  v_com_pct := COALESCE(vp.comissao_venda_pct, c.comissao_pct);
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
END $function$;
REVOKE ALL ON FUNCTION public.fn_produto_margem_real(uuid, numeric, numeric, uuid) FROM anon;

-- ========================================================================================
-- 5) Compat (Princípio 5): fn_oficina_venda_params_salvar mantém a assinatura antiga, mas agora grava na
--    fonte genérica do núcleo (delega), sem exigir "configure a oficina primeiro". Não removida.
-- ========================================================================================
CREATE OR REPLACE FUNCTION public.fn_oficina_venda_params_salvar(p_company_id uuid, p_imposto_venda_pct numeric, p_comissao_venda_pct numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  -- wrapper de compatibilidade: a verdade dos parâmetros de venda vive em erp_venda_params (núcleo).
  RETURN public.fn_venda_params_salvar(p_company_id, p_imposto_venda_pct, p_comissao_venda_pct);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_oficina_venda_params_salvar(uuid, numeric, numeric) FROM anon;
