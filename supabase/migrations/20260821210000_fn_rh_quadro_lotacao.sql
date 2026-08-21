-- RH Industrial · Quadro de Lotação: leitura do quadro (postos projetados × alocação real). Vertical
-- industrial (operacional/planejamento). Fronteira GE: NÃO recria folha/ponto — isto é planejamento.
--
-- Premissa (RD-38/RD-26): as tabelas já existem (rh_posto_trabalho projetado, rh_alocacao real,
-- rh_remuneracao salário). Só faltava a RPC de leitura. Gate em 2 níveis:
--   • ver o quadro (postos/projetado/real/gap): acesso à empresa (operacional).
--   • ver salário/custo: só papel RH (rh_industrial/socio) ou admin — MESMO gate do fn_rh_importar_postos
--     (LGPD · Pilar 2). Sem o papel, os campos de custo voltam null (o resto do quadro aparece).
-- Funciona VAZIO (postos=0): retorna KPIs zerados + lista [] → a tela mostra o empty state de import.

CREATE OR REPLACE FUNCTION public.fn_rh_quadro_lotacao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pode_salario boolean; v_kpis jsonb; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  v_pode_salario := is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
       AND uc.role IN ('rh_industrial', 'socio'));

  SELECT jsonb_build_object(
    'postos_ativos',    count(*) FILTER (WHERE p.ativo),
    'postos_ocupados',  count(*) FILTER (WHERE p.ativo AND COALESCE(al.reais, 0) > 0),
    'vagas_abertas',    count(*) FILTER (WHERE p.ativo AND COALESCE(al.reais, 0) < p.qtd_proj_total),
    'proj_total',       COALESCE(sum(p.qtd_proj_total) FILTER (WHERE p.ativo), 0),
    'real_total',       COALESCE(sum(al.reais) FILTER (WHERE p.ativo), 0),
    'custo_registrado', CASE WHEN v_pode_salario THEN COALESCE(sum(al.custo) FILTER (WHERE p.ativo), 0) ELSE NULL END
  ) INTO v_kpis
  FROM rh_posto_trabalho p
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(a.qtd_real), 0) AS reais, COALESCE(sum(r.custo_total), 0) AS custo
    FROM rh_alocacao a LEFT JOIN rh_remuneracao r ON r.alocacao_id = a.id
    WHERE a.posto_id = p.id AND a.ativo
  ) al ON true
  WHERE p.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'setor'), (x->>'codigo_po')), '[]'::jsonb) INTO v_lista
  FROM (
    SELECT jsonb_build_object(
      'setor', COALESCE(s.nome, 'Sem setor'),
      'posto_id', p.id, 'codigo_po', p.codigo_po, 'cargo', p.cargo, 'atividade', p.atividade,
      'proj_t1', p.qtd_proj_t1, 'proj_t2', p.qtd_proj_t2, 'proj_t3', p.qtd_proj_t3, 'proj_total', p.qtd_proj_total,
      'real', COALESCE(al.reais, 0),
      'gap', p.qtd_proj_total - COALESCE(al.reais, 0),
      'custo', CASE WHEN v_pode_salario THEN COALESCE(al.custo, 0) ELSE NULL END
    ) AS x
    FROM rh_posto_trabalho p
    LEFT JOIN compliance_setores s ON s.id = p.setor_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.qtd_real), 0) AS reais, COALESCE(sum(r.custo_total), 0) AS custo
      FROM rh_alocacao a LEFT JOIN rh_remuneracao r ON r.alocacao_id = a.id
      WHERE a.posto_id = p.id AND a.ativo
    ) al ON true
    WHERE p.company_id = p_company_id AND p.ativo
  ) q;

  RETURN jsonb_build_object('ok', true, 'pode_salario', v_pode_salario, 'kpis', v_kpis, 'lista', v_lista);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_quadro_lotacao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_lotacao(uuid) TO authenticated;
