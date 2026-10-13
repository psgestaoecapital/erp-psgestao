-- RV-F7 · Salário base e % de encargos POR MOTORISTA (individual > plano) + custo total (c/ encargos).
-- Aditivo sobre F5/F6. Patcheia fn_rh_rv_calcular preservando entregas_mes (F6) e ajuste_manual (F5.1).
-- DECISÃO DO CEO: encargos incidem sobre (salário base + horas extras).

ALTER TABLE public.rh_rv_participante
  ADD COLUMN IF NOT EXISTS salario_base numeric(14,2),
  ADD COLUMN IF NOT EXISTS encargos_pct numeric(6,3);

-- Editar salário base / % encargos do participante (individual). Gate RH/sócio/admin; trava fechada.
CREATE OR REPLACE FUNCTION public.fn_rh_rv_participante_valores_salvar(
  p_company_id uuid, p_funcionario_id uuid,
  p_salario_base numeric DEFAULT NULL, p_encargos_pct numeric DEFAULT NULL, p_competencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id=p_company_id AND uc.user_id=auth.uid()
        AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao'); END IF;
  IF p_competencia IS NOT NULL AND EXISTS (SELECT 1 FROM rh_rv_competencia
       WHERE company_id=p_company_id AND competencia=p_competencia AND status='fechada') THEN
    RETURN jsonb_build_object('ok',false,'erro','competencia_fechada'); END IF;
  UPDATE rh_rv_participante SET
     salario_base = COALESCE(p_salario_base, salario_base),
     encargos_pct = COALESCE(p_encargos_pct, encargos_pct),
     updated_at = now()
   WHERE company_id=p_company_id AND funcionario_id=p_funcionario_id AND ativo;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','participante_nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- Patch no cálculo: salário base/encargos individuais (fallback plano) + encargos (base+HE) + custo total.
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
      -- RV-F7: salário base e encargos individuais do participante têm prioridade sobre o plano.
      COALESCE(part.salario_base, pl.salario_base, 0) AS salario_base,
      COALESCE(part.encargos_pct, 0)                  AS encargos_pct,
      pl.premio_util, pl.diaria_valor, pl.he_min_dia, pl.valor_entrega,
      pl.bonus_sem_infracao, pl.infracoes_zera, pl.inss_pct, pl.calcula_inss,
      COALESCE((SELECT count(DISTINCT d.data) FROM ind_ponto_dia d
                WHERE d.company_id = p_company_id
                  AND regexp_replace(COALESCE(d.cpf,''),'\D','','g') = regexp_replace(COALESCE(f.cpf,''),'\D','','g')
                  AND to_char(d.data,'YYYY-MM') = p_competencia AND COALESCE(d.worked_seconds,0) > 0), 0) AS dias,
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
  ),
  custo AS (
    -- encargos incidem sobre (salário base + horas extras) — decisão do CEO.
    SELECT c.*, round((c.salario_base + c.v_he) * c.encargos_pct/100, 2) AS v_encargos FROM calc c
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'funcionario_id', c.funcionario_id, 'cargo', c.cargo, 'perfil', c.perfil, 'faixa', c.faixa,
      'dias', c.dias, 'entregas', c.entregas, 'entregas_origem', c.entregas_origem, 'infracoes_registradas', c.infr_reg,
      'sem_infracao', (c.infr_reg < c.infracoes_zera),
      'salario_base',  CASE WHEN v_pode_salario THEN c.salario_base ELSE NULL END,
      'encargos_pct',  CASE WHEN v_pode_salario THEN c.encargos_pct ELSE NULL END,
      'encargos_valor',CASE WHEN v_pode_salario THEN c.v_encargos ELSE NULL END,
      'premio_util',   CASE WHEN v_pode_salario THEN c.premio_util ELSE NULL END,
      'diaria',        CASE WHEN v_pode_salario THEN c.v_diaria ELSE NULL END,
      'hora_extra',    CASE WHEN v_pode_salario THEN c.v_he ELSE NULL END,
      'por_entrega',   CASE WHEN v_pode_salario THEN c.v_entregas ELSE NULL END,
      'bonus',         CASE WHEN v_pode_salario THEN c.v_bonus ELSE NULL END,
      'ajuste_manual', CASE WHEN v_pode_salario THEN c.v_ajuste ELSE NULL END,
      'inss',          CASE WHEN v_pode_salario THEN c.v_inss ELSE NULL END,
      'variavel_total', CASE WHEN v_pode_salario THEN round(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste, 2) ELSE NULL END,
      'bruto_total',    CASE WHEN v_pode_salario THEN round(c.salario_base + c.premio_util + c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste, 2) ELSE NULL END,
      'custo_total',    CASE WHEN v_pode_salario THEN round(c.salario_base + c.premio_util + c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste + c.v_encargos, 2) ELSE NULL END
    ) ORDER BY c.cargo, c.funcionario_id), '[]'::jsonb),
    jsonb_build_object(
      'no_plano', count(*),
      'dias_apurados', COALESCE(sum(c.dias), 0),
      'sem_infracao', count(*) FILTER (WHERE c.infr_reg < c.infracoes_zera),
      'variavel_mes', CASE WHEN v_pode_salario THEN COALESCE(round(sum(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste), 2), 0) ELSE NULL END,
      'custo_total_mes', CASE WHEN v_pode_salario THEN COALESCE(round(sum(c.salario_base + c.premio_util + c.v_diaria + c.v_he + c.v_entregas + c.v_bonus + c.v_ajuste + c.v_encargos), 2), 0) ELSE NULL END)
  INTO v_lista, v_kpis
  FROM custo c;

  RETURN jsonb_build_object('ok', true, 'competencia', p_competencia, 'pode_salario', v_pode_salario,
    'inss_pela_folha', true, 'kpis', v_kpis, 'lista', v_lista);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_participante_valores_salvar(uuid,uuid,numeric,numeric,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_participante_valores_salvar(uuid,uuid,numeric,numeric,text) TO authenticated;
