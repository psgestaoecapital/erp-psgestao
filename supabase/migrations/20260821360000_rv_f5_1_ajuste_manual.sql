-- RV-F5.1 · Ajuste individual por motorista numa competência (adicional/desconto avulso, com motivo).
-- Aditivo sobre o RV-F5; a única sobreposição é fn_rh_rv_calcular (patch para somar os ajustes).

-- 1.1 Tabela de ajustes.
CREATE TABLE IF NOT EXISTS public.rh_rv_ajuste_manual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  funcionario_id uuid NOT NULL,
  competencia text NOT NULL,                 -- 'YYYY-MM'
  tipo text NOT NULL CHECK (tipo IN ('adicional','desconto')),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  motivo text NOT NULL,                       -- obrigatório (rastreabilidade)
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rv_ajuste_comp
  ON public.rh_rv_ajuste_manual (company_id, funcionario_id, competencia) WHERE ativo;
ALTER TABLE public.rh_rv_ajuste_manual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_rv_ajuste_sel ON public.rh_rv_ajuste_manual;
CREATE POLICY rh_rv_ajuste_sel ON public.rh_rv_ajuste_manual
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 1.2 Salvar / excluir ajuste (gateado rh_industrial/socio/admin · bloqueia competência fechada).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_ajuste_salvar(
  p_company_id uuid, p_funcionario_id uuid, p_competencia text,
  p_tipo text, p_valor numeric, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id=p_company_id AND uc.user_id=auth.uid()
        AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao'); END IF;
  IF p_tipo NOT IN ('adicional','desconto') THEN RETURN jsonb_build_object('ok',false,'erro','tipo_invalido'); END IF;
  IF COALESCE(p_valor,-1) < 0 THEN RETURN jsonb_build_object('ok',false,'erro','valor_invalido'); END IF;
  IF COALESCE(trim(p_motivo),'')='' THEN RETURN jsonb_build_object('ok',false,'erro','motivo_obrigatorio'); END IF;
  IF EXISTS (SELECT 1 FROM rh_rv_competencia
       WHERE company_id=p_company_id AND competencia=p_competencia AND status='fechada') THEN
    RETURN jsonb_build_object('ok',false,'erro','competencia_fechada'); END IF;
  INSERT INTO rh_rv_ajuste_manual (company_id, funcionario_id, competencia, tipo, valor, motivo, criado_por)
  VALUES (p_company_id, p_funcionario_id, p_competencia, p_tipo, p_valor, p_motivo, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_rh_rv_ajuste_excluir(p_company_id uuid, p_ajuste_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id=p_company_id AND uc.user_id=auth.uid()
        AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao'); END IF;
  UPDATE rh_rv_ajuste_manual a SET ativo=false
   WHERE a.id=p_ajuste_id AND a.company_id=p_company_id
     AND NOT EXISTS (SELECT 1 FROM rh_rv_competencia c
        WHERE c.company_id=a.company_id AND c.competencia=a.competencia AND c.status='fechada');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado_ou_fechada'); END IF;
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- 2. Patch no cálculo: soma os ajustes ativos da competência e os inclui no total.
CREATE OR REPLACE FUNCTION public.fn_rh_rv_calcular(p_company_id uuid, p_competencia text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pode_salario boolean; v_lista jsonb; v_kpis jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_competencia !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'competencia_invalida (use YYYY-MM)'); END IF;

  v_pode_salario := is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
     WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'));

  WITH base AS (
    SELECT
      part.funcionario_id, f.cargo, pl.perfil, pl.faixa,
      pl.salario_base, pl.premio_util, pl.diaria_valor, pl.he_min_dia, pl.valor_entrega,
      pl.bonus_sem_infracao, pl.infracoes_zera, pl.inss_pct, pl.calcula_inss,
      COALESCE((SELECT count(DISTINCT d.data) FROM ind_ponto_dia d
                WHERE d.company_id = p_company_id
                  AND regexp_replace(COALESCE(d.cpf,''),'\D','','g') = regexp_replace(COALESCE(f.cpf,''),'\D','','g')
                  AND to_char(d.data,'YYYY-MM') = p_competencia AND COALESCE(d.worked_seconds,0) > 0), 0) AS dias,
      COALESCE((SELECT sum(l.entregas_qtd) FROM rh_rv_lancamento_dia l
                WHERE l.company_id = p_company_id AND l.funcionario_id = part.funcionario_id
                  AND to_char(l.data,'YYYY-MM') = p_competencia), 0) AS entregas,
      COALESCE((SELECT count(*) FROM rh_rv_lancamento_dia l
                WHERE l.company_id = p_company_id AND l.funcionario_id = part.funcionario_id
                  AND to_char(l.data,'YYYY-MM') = p_competencia
                  AND l.infracao = true AND l.infracao_tipo = 'registrada'), 0) AS infr_reg,
      -- RV-F5.1: soma dos ajustes manuais ativos da competência (adicional +, desconto −)
      COALESCE((SELECT sum(CASE WHEN aj.tipo='adicional' THEN aj.valor ELSE -aj.valor END)
                FROM rh_rv_ajuste_manual aj
                WHERE aj.company_id = p_company_id AND aj.ativo
                  AND aj.funcionario_id = part.funcionario_id
                  AND aj.competencia = p_competencia), 0) AS v_ajuste
    FROM rh_rv_participante part
    JOIN rh_rv_plano pl ON pl.id = part.plano_id
    JOIN compliance_funcionarios f ON f.id = part.funcionario_id
    WHERE part.company_id = p_company_id AND part.ativo AND pl.ativo
  ),
  calc AS (
    SELECT b.*,
      round(b.diaria_valor * b.dias, 2) AS v_diaria,
      round((b.he_min_dia::numeric/60) * b.dias * (b.salario_base/220), 2) AS v_he,
      round(b.valor_entrega * b.entregas, 2) AS v_entregas,
      CASE WHEN b.infr_reg < b.infracoes_zera THEN b.bonus_sem_infracao ELSE 0 END AS v_bonus,
      CASE WHEN b.calcula_inss THEN round(b.salario_base * b.inss_pct/100, 2) ELSE NULL END AS v_inss
    FROM base b
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'funcionario_id', c.funcionario_id, 'cargo', c.cargo, 'perfil', c.perfil, 'faixa', c.faixa,
      'dias', c.dias, 'entregas', c.entregas, 'infracoes_registradas', c.infr_reg,
      'sem_infracao', (c.infr_reg < c.infracoes_zera),
      'salario_base',  CASE WHEN v_pode_salario THEN c.salario_base ELSE NULL END,
      'premio_util',   CASE WHEN v_pode_salario THEN c.premio_util ELSE NULL END,
      'diaria',        CASE WHEN v_pode_salario THEN c.v_diaria ELSE NULL END,
      'hora_extra',    CASE WHEN v_pode_salario THEN c.v_he ELSE NULL END,
      'por_entrega',   CASE WHEN v_pode_salario THEN c.v_entregas ELSE NULL END,
      'bonus',         CASE WHEN v_pode_salario THEN c.v_bonus ELSE NULL END,
      'ajuste_manual', CASE WHEN v_pode_salario THEN c.v_ajuste ELSE NULL END,
      'inss',          CASE WHEN v_pode_salario THEN c.v_inss ELSE NULL END,
      'variavel_total', CASE WHEN v_pode_salario THEN round(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste, 2) ELSE NULL END,
      'bruto_total',    CASE WHEN v_pode_salario THEN round(c.salario_base + c.premio_util + c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste, 2) ELSE NULL END
    ) ORDER BY c.cargo, c.funcionario_id), '[]'::jsonb),
    jsonb_build_object(
      'no_plano', count(*),
      'dias_apurados', COALESCE(sum(c.dias), 0),
      'sem_infracao', count(*) FILTER (WHERE c.infr_reg < c.infracoes_zera),
      'variavel_mes', CASE WHEN v_pode_salario THEN COALESCE(round(sum(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste), 2), 0) ELSE NULL END)
  INTO v_lista, v_kpis
  FROM calc c;

  RETURN jsonb_build_object('ok', true, 'competencia', p_competencia, 'pode_salario', v_pode_salario,
    'inss_pela_folha', true, 'kpis', v_kpis, 'lista', v_lista);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_ajuste_salvar(uuid,uuid,text,text,numeric,text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_rh_rv_ajuste_excluir(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_ajuste_salvar(uuid,uuid,text,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_ajuste_excluir(uuid,uuid) TO authenticated;
