-- RV-F4 · backend da tela de Remuneração Variável (motoristas · Frioeste).
-- Reusa fn_rh_rv_calcular / fn_rh_rv_lancar_dia (#1096). Adiciona: gestão de participante,
-- controle de competência + fechamento (evento GE = conta a pagar por motorista), e guard
-- de competência fechada no lançamento diário.

-- 1.1 Vincular/gerir participante do plano (índice único (company_id,funcionario_id) já existe).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_participante_salvar(
  p_company_id uuid, p_funcionario_id uuid, p_plano_id uuid, p_ativo boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM compliance_funcionarios WHERE id=p_funcionario_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok',false,'erro','funcionario_invalido'); END IF;
  IF NOT EXISTS (SELECT 1 FROM rh_rv_plano WHERE id=p_plano_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok',false,'erro','plano_invalido'); END IF;
  INSERT INTO rh_rv_participante (company_id, funcionario_id, plano_id, ativo)
  VALUES (p_company_id, p_funcionario_id, p_plano_id, p_ativo)
  ON CONFLICT (company_id, funcionario_id) DO UPDATE
    SET plano_id=excluded.plano_id, ativo=excluded.ativo, updated_at=now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $fn$;

-- 1.2 Controle de competência.
CREATE TABLE IF NOT EXISTS public.rh_rv_competencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  competencia text NOT NULL,               -- 'YYYY-MM'
  status text NOT NULL DEFAULT 'aberta',   -- aberta | fechada
  total_variavel numeric(14,2),
  fechada_em timestamptz, fechada_por uuid,
  UNIQUE (company_id, competencia)
);
ALTER TABLE public.rh_rv_competencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_rv_competencia_sel ON public.rh_rv_competencia;
CREATE POLICY rh_rv_competencia_sel ON public.rh_rv_competencia
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Fechamento: gera 1 conta a pagar por motorista (despesa de pessoal · RV) — rastreável e idempotente.
CREATE OR REPLACE FUNCTION public.fn_rh_rv_fechar_competencia(
  p_company_id uuid, p_competencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_calc jsonb; v_row record; v_total numeric := 0; v_venc date; v_n int := 0;
BEGIN
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id=p_company_id AND uc.user_id=auth.uid()
        AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao_fechar'); END IF;
  IF p_competencia !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok',false,'erro','competencia_invalida (use YYYY-MM)'); END IF;

  v_calc := fn_rh_rv_calcular(p_company_id, p_competencia);
  IF NOT (v_calc->>'ok')::boolean THEN RETURN v_calc; END IF;

  -- vencimento: 5º dia do mês seguinte
  v_venc := (to_date(p_competencia||'-01','YYYY-MM-DD') + interval '1 month' + interval '4 days')::date;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_calc->'lista')
    AS x(funcionario_id uuid, cargo text, variavel_total numeric)
  LOOP
    INSERT INTO erp_pagar (company_id, descricao, categoria, valor, valor_pago,
       data_emissao, data_competencia, data_vencimento, status, linha_negocio,
       recorrente, ref_externa_id, ref_externa_sistema)
    VALUES (p_company_id,
       format('RV %s - %s', p_competencia, coalesce(v_row.cargo,'motorista')),
       '4 - Despesas com Pessoal', coalesce(v_row.variavel_total,0), 0,
       to_date(p_competencia||'-01','YYYY-MM-DD'), to_date(p_competencia||'-01','YYYY-MM-DD'),
       v_venc, 'aberto', 'Logística', false,
       format('rv:%s:%s', p_competencia, v_row.funcionario_id), 'rh_rv')
    ON CONFLICT DO NOTHING;   -- idempotente por ref_externa (partial unique)
    v_total := v_total + coalesce(v_row.variavel_total,0); v_n := v_n + 1;
  END LOOP;

  INSERT INTO rh_rv_competencia (company_id, competencia, status, total_variavel, fechada_em, fechada_por)
  VALUES (p_company_id, p_competencia, 'fechada', v_total, now(), auth.uid())
  ON CONFLICT (company_id, competencia) DO UPDATE
    SET status='fechada', total_variavel=excluded.total_variavel, fechada_em=now(), fechada_por=auth.uid();

  RETURN jsonb_build_object('ok',true,'competencia',p_competencia,'motoristas',v_n,'total',v_total,'vencimento',v_venc);
END $fn$;

-- Guard: lançar dia recusa competência FECHADA (aditivo — resto idêntico ao #1096).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_lancar_dia(p_company_id uuid, p_funcionario_id uuid, p_data date, p_entregas_qtd integer DEFAULT 0, p_infracao boolean DEFAULT false, p_infracao_tipo text DEFAULT NULL::text, p_infracao_motivo text DEFAULT NULL::text, p_obs text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM compliance_funcionarios WHERE id = p_funcionario_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'funcionario_invalido'); END IF;
  IF EXISTS (SELECT 1 FROM rh_rv_competencia
             WHERE company_id = p_company_id AND competencia = to_char(p_data,'YYYY-MM') AND status = 'fechada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'competencia_fechada',
      'orientacao', 'A competência desse dia já foi fechada e enviada à folha. Reabra antes de lançar.'); END IF;

  INSERT INTO rh_rv_lancamento_dia (company_id, funcionario_id, data, entregas_qtd, infracao, infracao_tipo, infracao_motivo, obs, registrado_por)
  VALUES (p_company_id, p_funcionario_id, p_data, GREATEST(COALESCE(p_entregas_qtd,0),0), COALESCE(p_infracao,false),
          NULLIF(btrim(p_infracao_tipo),''), NULLIF(btrim(p_infracao_motivo),''), NULLIF(btrim(p_obs),''), auth.uid())
  ON CONFLICT (company_id, funcionario_id, data) DO UPDATE SET
    entregas_qtd = EXCLUDED.entregas_qtd, infracao = EXCLUDED.infracao, infracao_tipo = EXCLUDED.infracao_tipo,
    infracao_motivo = EXCLUDED.infracao_motivo, obs = EXCLUDED.obs, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_participante_salvar(uuid,uuid,uuid,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.fn_rh_rv_fechar_competencia(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_participante_salvar(uuid,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_fechar_competencia(uuid,text) TO authenticated;
