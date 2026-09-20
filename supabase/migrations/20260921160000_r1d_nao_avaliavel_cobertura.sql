-- Revenda R1d ajuste 1 · status 'nao_avaliavel' + fn_blueprint_cobertura ignora no denominador.
--
-- Um requisito que só aparece APÓS interação (clique/preenchimento) não pode virar "ausente" só porque o
-- juiz viu o estado inicial. Ex.: Tela 6 (Vistoria) deu 13% (manual 62%) porque a foto era da tela "Iniciar
-- vistoria". Novo status 'nao_avaliavel' não conta como atendido NEM como ausente — sai do denominador.

ALTER TABLE public.blueprint_tela_cobertura DROP CONSTRAINT IF EXISTS blueprint_tela_cobertura_status_chk;
ALTER TABLE public.blueprint_tela_cobertura
  ADD CONSTRAINT blueprint_tela_cobertura_status_chk
  CHECK (status IN ('atendido','parcial','ausente','quebrado','nao_avaliavel'));

CREATE OR REPLACE FUNCTION public.fn_blueprint_cobertura(p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;

  WITH efetivo AS (
    SELECT r.id, r.tela_num, r.tela_nome, r.prioridade,
      COALESCE(
        (SELECT c.status FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id ORDER BY c.avaliado_em DESC LIMIT 1),
        r.status_baseline
      ) AS s
    FROM blueprint_tela_requisito r WHERE r.vertical = p_vertical
  ),
  sc AS (
    SELECT tela_num, tela_nome, prioridade, s,
      (s <> 'nao_avaliavel') AS avaliavel,
      CASE s WHEN 'atendido' THEN 1.0 WHEN 'parcial' THEN 0.5 ELSE 0 END AS score
    FROM efetivo
  ),
  por_tela AS (
    SELECT tela_num, min(tela_nome) AS tela_nome,
      count(*) AS requisitos,
      count(*) FILTER (WHERE avaliavel) AS avaliaveis,
      count(*) FILTER (WHERE NOT avaliavel) AS nao_avaliaveis,
      count(*) FILTER (WHERE avaliavel AND s IN ('atendido','parcial')) AS com_algo,
      round(100.0*avg(score) FILTER (WHERE avaliavel), 1) AS pct,
      round(100.0*avg(score) FILTER (WHERE avaliavel AND prioridade='essencial'), 1) AS pct_essenciais
    FROM sc GROUP BY tela_num
  )
  SELECT jsonb_build_object(
    'ok', true, 'vertical', p_vertical, 'gerado_em', now(),
    'total_requisitos', (SELECT count(*) FROM sc),
    'total_avaliaveis', (SELECT count(*) FROM sc WHERE avaliavel),
    'total_nao_avaliaveis', (SELECT count(*) FROM sc WHERE NOT avaliavel),
    'geral_pct', (SELECT round(100.0*avg(score) FILTER (WHERE avaliavel),1) FROM sc),
    'essenciais_pct', (SELECT round(100.0*avg(score) FILTER (WHERE avaliavel AND prioridade='essencial'),1) FROM sc),
    'por_tela', (SELECT jsonb_agg(jsonb_build_object(
        'tela_num', tela_num, 'tela_nome', tela_nome, 'pct', pct, 'pct_essenciais', pct_essenciais,
        'requisitos', requisitos, 'avaliaveis', avaliaveis, 'nao_avaliaveis', nao_avaliaveis, 'com_algo', com_algo
      ) ORDER BY tela_num) FROM por_tela)
  ) INTO v_out;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.fn_blueprint_cobertura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_blueprint_cobertura(text) TO authenticated, service_role;
