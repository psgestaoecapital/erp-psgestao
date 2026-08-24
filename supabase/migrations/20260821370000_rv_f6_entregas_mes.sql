-- RV-F6 · Entregas do mês (total por pessoa/competência, digitável) + expõe edição de salário base.
-- Aditivo sobre F5/F5.1. Princípio: automático vem automático (dias = ponto); o resto é digitado.
-- Patcheia fn_rh_rv_calcular PRESERVANDO o ajuste_manual do F5.1.

-- 1.1 Total mensal de entregas por pessoa.
CREATE TABLE IF NOT EXISTS public.rh_rv_entregas_mes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  funcionario_id uuid NOT NULL,
  competencia text NOT NULL,               -- 'YYYY-MM'
  entregas_qtd integer NOT NULL DEFAULT 0 CHECK (entregas_qtd >= 0),
  obs text, registrado_por uuid, updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, funcionario_id, competencia)
);
ALTER TABLE public.rh_rv_entregas_mes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_rv_entregas_mes_sel ON public.rh_rv_entregas_mes;
CREATE POLICY rh_rv_entregas_mes_sel ON public.rh_rv_entregas_mes
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE OR REPLACE FUNCTION public.fn_rh_rv_entregas_mes_salvar(
  p_company_id uuid, p_funcionario_id uuid, p_competencia text, p_entregas integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_competencia !~ '^\d{4}-\d{2}$' THEN RETURN jsonb_build_object('ok',false,'erro','competencia_invalida'); END IF;
  IF EXISTS (SELECT 1 FROM rh_rv_competencia
       WHERE company_id=p_company_id AND competencia=p_competencia AND status='fechada') THEN
    RETURN jsonb_build_object('ok',false,'erro','competencia_fechada'); END IF;
  INSERT INTO rh_rv_entregas_mes (company_id, funcionario_id, competencia, entregas_qtd, registrado_por)
  VALUES (p_company_id, p_funcionario_id, p_competencia, GREATEST(COALESCE(p_entregas,0),0), auth.uid())
  ON CONFLICT (company_id, funcionario_id, competencia) DO UPDATE
    SET entregas_qtd=excluded.entregas_qtd, registrado_por=auth.uid(), updated_at=now();
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- 1.2 Patch no cálculo: entregas = total mensal digitado (se houver) senão soma dos dias.
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
      -- RV-F6: total mensal digitado tem prioridade; senão soma dos lançamentos diários.
      COALESCE(
        (SELECT em.entregas_qtd FROM rh_rv_entregas_mes em
          WHERE em.company_id=p_company_id AND em.funcionario_id=part.funcionario_id AND em.competencia=p_competencia),
        (SELECT sum(l.entregas_qtd) FROM rh_rv_lancamento_dia l
          WHERE l.company_id=p_company_id AND l.funcionario_id=part.funcionario_id AND to_char(l.data,'YYYY-MM')=p_competencia),
        0) AS entregas,
      CASE WHEN EXISTS (SELECT 1 FROM rh_rv_entregas_mes em
             WHERE em.company_id=p_company_id AND em.funcionario_id=part.funcionario_id AND em.competencia=p_competencia)
           THEN 'mensal' ELSE 'diario' END AS entregas_origem,
      COALESCE((SELECT count(*) FROM rh_rv_lancamento_dia l
                WHERE l.company_id = p_company_id AND l.funcionario_id = part.funcionario_id
                  AND to_char(l.data,'YYYY-MM') = p_competencia
                  AND l.infracao = true AND l.infracao_tipo = 'registrada'), 0) AS infr_reg,
      COALESCE((SELECT sum(CASE WHEN aj.tipo='adicional' THEN aj.valor ELSE -aj.valor END)
                FROM rh_rv_ajuste_manual aj
                WHERE aj.company_id = p_company_id AND aj.ativo
                  AND aj.funcionario_id = part.funcionario_id AND aj.competencia = p_competencia), 0) AS v_ajuste
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
      'dias', c.dias, 'entregas', c.entregas, 'entregas_origem', c.entregas_origem, 'infracoes_registradas', c.infr_reg,
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

REVOKE ALL ON FUNCTION public.fn_rh_rv_entregas_mes_salvar(uuid,uuid,text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_entregas_mes_salvar(uuid,uuid,text,integer) TO authenticated;
