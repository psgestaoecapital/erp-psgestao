-- RD-78 · um verde de PREVIEW nunca pode ser lido como prova de PRODUÇÃO (pedido do CEO, 26/09).
--
-- Até aqui gold_jornada_resultado não dizia ONDE a jornada rodou nem QUAL build ela testou, e
-- fn_blueprint_cobertura contava o último verde de qualquer origem como requisito "atendido". Em 26/09 a
-- aceitacao-1806 já gravou vermelhos do preview do #1817 intercalados com verdes do preview do #1816 na
-- mesma demo — o "último status" deixou de significar alguma coisa.
--
-- 1) Colunas novas (nulas = desconhecido, nunca "produção"):
--      ambiente   'producao' | 'preview' | 'local' — derivado do PROD_BASE_URL pelo e2e/support/api.ts
--      commit_sha SHA do build SERVIDO (lido de /sw.js = VERCEL_GIT_COMMIT_SHA), não o do push: o juiz
--                 pós-merge pode rodar antes de a Vercel terminar o deploy.
--      base_url   URL exata aberta pelo robô
--      run_url    link do run do GitHub Actions
-- 2) fn_jornada_registrar_resultado aceita os 4 campos (defaults → chamadas antigas continuam válidas).
-- 3) fn_blueprint_cobertura só conta a ÚLTIMA execução de PRODUÇÃO. Preview/local/desconhecido não prova nada.
-- 4) Legado marcado COM PROVA (RD-38), só onde ambiente ainda é nulo:
--      - 10:14:07–10:18:27 UTC de 26/09 = job do "Juiz Revenda" run 36235117160 (PROD_BASE_URL =
--        https://erp-psgestao.vercel.app); nenhum outro workflow gravou jornada nessa janela → 'producao'.
--        Inclui as 4 jornadas mapeadas no blueprint (ficha, precificacao, vendas, vistoria), que SÓ
--        esse job gravou — a cobertura continua igual à de hoje.
--      - aceitacao-1806 depois de 10:18:27 = só o workflow aceitacao-pr.yml (preview) → 'preview'.
--      commit_sha do legado fica NULO: o juiz das 10:14 pode ter pegado o deploy anterior (o de 42669445
--      só ficou pronto às 10:14:46). Não se inventa SHA.

ALTER TABLE public.gold_jornada_resultado
  ADD COLUMN IF NOT EXISTS ambiente   text,
  ADD COLUMN IF NOT EXISTS commit_sha text,
  ADD COLUMN IF NOT EXISTS base_url   text,
  ADD COLUMN IF NOT EXISTS run_url    text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gold_jornada_resultado_ambiente_chk') THEN
    ALTER TABLE public.gold_jornada_resultado
      ADD CONSTRAINT gold_jornada_resultado_ambiente_chk
      CHECK (ambiente IS NULL OR ambiente IN ('producao', 'preview', 'local'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS gold_jornada_resultado_amb_idx
  ON public.gold_jornada_resultado (vertical, jornada, ambiente, avaliado_em DESC);

-- legado (idempotente: só toca ambiente nulo)
UPDATE public.gold_jornada_resultado
   SET ambiente = 'producao',
       run_url  = 'https://github.com/psgestaoecapital/erp-psgestao/actions/runs/36235117160',
       base_url = 'https://erp-psgestao.vercel.app'
 WHERE ambiente IS NULL
   AND avaliado_em >= '2026-09-26 10:14:07+00' AND avaliado_em <= '2026-09-26 10:18:27+00';

UPDATE public.gold_jornada_resultado
   SET ambiente = 'preview'
 WHERE ambiente IS NULL
   AND jornada = 'aceitacao-1806'
   AND avaliado_em > '2026-09-26 10:18:27+00';

-- ── gravador: aceita ambiente/sha/url (assinatura nova; a antiga sai para não haver ambiguidade no PostgREST)
DROP FUNCTION IF EXISTS public.fn_jornada_registrar_resultado(text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.fn_jornada_registrar_resultado(
  p_jornada text, p_status text, p_execucao_id uuid DEFAULT NULL, p_detalhe text DEFAULT NULL,
  p_vertical text DEFAULT 'revenda_veiculos', p_ambiente text DEFAULT NULL, p_commit_sha text DEFAULT NULL,
  p_base_url text DEFAULT NULL, p_run_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('verde','vermelho') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF p_ambiente IS NOT NULL AND p_ambiente NOT IN ('producao','preview','local') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ambiente_invalido'); END IF;
  INSERT INTO gold_jornada_resultado (vertical, jornada, status, execucao_id, detalhe, ambiente, commit_sha, base_url, run_url)
  VALUES (p_vertical, p_jornada, p_status, p_execucao_id, left(p_detalhe, 2000), p_ambiente,
          left(nullif(btrim(p_commit_sha), ''), 64), left(p_base_url, 300), left(p_run_url, 300))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_jornada_registrar_resultado(text, text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_jornada_registrar_resultado(text, text, uuid, text, text, text, text, text, text) TO service_role;

-- ── cobertura: só a ÚLTIMA execução de PRODUÇÃO prova requisito (resto idêntico ao 20260921180000)
CREATE OR REPLACE FUNCTION public.fn_blueprint_cobertura(p_vertical text DEFAULT 'revenda_veiculos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;

  WITH jverde AS (  -- requisitos cuja jornada mapeada teve a ÚLTIMA execução EM PRODUÇÃO verde (RD-78)
    SELECT DISTINCT jr.requisito_id
    FROM jornada_requisito jr
    WHERE jr.vertical = p_vertical
      AND EXISTS (
        SELECT 1 FROM gold_jornada_resultado g
        WHERE g.vertical = jr.vertical AND g.jornada = jr.jornada AND g.status = 'verde'
          AND g.ambiente = 'producao'
          AND g.avaliado_em = (SELECT max(g2.avaliado_em) FROM gold_jornada_resultado g2
                               WHERE g2.vertical = jr.vertical AND g2.jornada = jr.jornada
                                 AND g2.ambiente = 'producao')
      )
  ),
  comb AS (
    SELECT r.id, r.tela_num, r.tela_nome, r.prioridade,
      (r.id IN (SELECT requisito_id FROM jverde)) AS por_jornada,
      CASE WHEN r.id IN (SELECT requisito_id FROM jverde) THEN 'atendido'
        ELSE COALESCE(
          (SELECT c.status FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id ORDER BY c.avaliado_em DESC LIMIT 1),
          r.status_baseline
        )
      END AS s
    FROM blueprint_tela_requisito r WHERE r.vertical = p_vertical
  ),
  sc AS (
    SELECT tela_num, tela_nome, prioridade, s, por_jornada,
      (s <> 'nao_avaliavel') AS avaliavel,
      CASE s WHEN 'atendido' THEN 1.0 WHEN 'parcial' THEN 0.5 ELSE 0 END AS score
    FROM comb
  ),
  por_tela AS (
    SELECT tela_num, min(tela_nome) AS tela_nome,
      count(*) AS requisitos,
      count(*) FILTER (WHERE avaliavel) AS avaliaveis,
      count(*) FILTER (WHERE NOT avaliavel) AS nao_avaliaveis,
      count(*) FILTER (WHERE por_jornada) AS provado_por_jornada,
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
    'total_provado_por_jornada', (SELECT count(*) FROM sc WHERE por_jornada),
    'geral_pct', (SELECT round(100.0*avg(score) FILTER (WHERE avaliavel),1) FROM sc),
    'essenciais_pct', (SELECT round(100.0*avg(score) FILTER (WHERE avaliavel AND prioridade='essencial'),1) FROM sc),
    'por_tela', (SELECT jsonb_agg(jsonb_build_object(
        'tela_num', tela_num, 'tela_nome', tela_nome, 'pct', pct, 'pct_essenciais', pct_essenciais,
        'requisitos', requisitos, 'avaliaveis', avaliaveis, 'nao_avaliaveis', nao_avaliaveis,
        'provado_por_jornada', provado_por_jornada, 'com_algo', com_algo
      ) ORDER BY tela_num) FROM por_tela)
  ) INTO v_out;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.fn_blueprint_cobertura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_blueprint_cobertura(text) TO authenticated, service_role;
