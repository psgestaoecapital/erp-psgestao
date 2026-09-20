-- Incidente LGPD (D) · fn_blueprint_cobertura: guarda padrão para servir a varredura interna.
--
-- Problema: a versão do R1c recusava QUALQUER chamada sem auth.uid() PS_ADMIN — inclusive a chamada
-- INTERNA (service_role, sem JWT) da varredura semanal do #1614, que passava a devolver {erro:apenas_ps_admin}.
-- Correção: sem JWT (auth.uid() NULL = service_role, só server-side) PASSA; usuário authenticated só
-- passa se for PS_ADMIN. anon segue sem EXECUTE (REVOKE). Nenhum dado sensível de cliente aqui — é a
-- cobertura da régua da demo.

CREATE OR REPLACE FUNCTION public.fn_blueprint_cobertura(p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  -- Chamada com JWT de usuário: exige PS_ADMIN. Chamada interna (service_role, auth.uid() NULL): passa.
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;

  WITH efetivo AS (
    SELECT r.id, r.tela_num, r.tela_nome, r.prioridade,
      COALESCE(
        (SELECT c.status FROM blueprint_tela_cobertura c
           WHERE c.requisito_id = r.id ORDER BY c.avaliado_em DESC LIMIT 1),
        r.status_baseline
      ) AS status_efetivo
    FROM blueprint_tela_requisito r
    WHERE r.vertical = p_vertical
  ),
  scored AS (
    SELECT tela_num, tela_nome, prioridade, status_efetivo,
      CASE status_efetivo WHEN 'atendido' THEN 1.0 WHEN 'parcial' THEN 0.5 ELSE 0 END AS score
    FROM efetivo
  ),
  por_tela AS (
    SELECT tela_num, min(tela_nome) AS tela_nome,
      count(*) AS requisitos,
      count(*) FILTER (WHERE status_efetivo IN ('atendido','parcial')) AS com_algo,
      round(100.0*avg(score), 1) AS pct,
      round(100.0*avg(score) FILTER (WHERE prioridade='essencial'), 1) AS pct_essenciais
    FROM scored GROUP BY tela_num
  )
  SELECT jsonb_build_object(
    'ok', true,
    'vertical', p_vertical,
    'gerado_em', now(),
    'total_requisitos', (SELECT count(*) FROM scored),
    'geral_pct', (SELECT round(100.0*avg(score),1) FROM scored),
    'essenciais_pct', (SELECT round(100.0*avg(score) FILTER (WHERE prioridade='essencial'),1) FROM scored),
    'por_tela', (SELECT jsonb_agg(jsonb_build_object(
        'tela_num', tela_num, 'tela_nome', tela_nome, 'pct', pct,
        'pct_essenciais', pct_essenciais, 'requisitos', requisitos, 'com_algo', com_algo
      ) ORDER BY tela_num) FROM por_tela)
  ) INTO v_out;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.fn_blueprint_cobertura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_blueprint_cobertura(text) TO authenticated, service_role;
