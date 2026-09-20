-- Revenda R1 item 1c · jornadas ↔ juiz. Uma jornada Playwright VERDE (clicou-salvou-conferiu no banco)
-- PROVA o requisito e PREVALECE sobre a foto do juiz. Duas tabelas novas + writer + precedência no
-- fn_blueprint_cobertura. Nada finge cobertura: só a ÚLTIMA execução verde de uma jornada mapeada conta.

-- ── jornada_requisito: que requisito da régua cada jornada PROVA ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jornada_requisito (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical     text NOT NULL,
  jornada      text NOT NULL,
  requisito_id uuid NOT NULL REFERENCES public.blueprint_tela_requisito(id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jornada, requisito_id)
);
ALTER TABLE public.jornada_requisito ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jornada_requisito_sel_ps_admin ON public.jornada_requisito;
CREATE POLICY jornada_requisito_sel_ps_admin ON public.jornada_requisito FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- ── gold_jornada_resultado: resultado (verde/vermelho) de cada execução de jornada ──────────────────
CREATE TABLE IF NOT EXISTS public.gold_jornada_resultado (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical     text NOT NULL,
  jornada      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('verde','vermelho')),
  execucao_id  uuid,
  detalhe      text,
  avaliado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gold_jornada_resultado_jornada_idx
  ON public.gold_jornada_resultado (vertical, jornada, avaliado_em DESC);
ALTER TABLE public.gold_jornada_resultado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gold_jornada_resultado_sel_ps_admin ON public.gold_jornada_resultado;
CREATE POLICY gold_jornada_resultado_sel_ps_admin ON public.gold_jornada_resultado FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- ── writer: a jornada (service_role no runner do GitHub Actions) grava seu resultado ────────────────
CREATE OR REPLACE FUNCTION public.fn_jornada_registrar_resultado(
  p_jornada text, p_status text, p_execucao_id uuid DEFAULT NULL, p_detalhe text DEFAULT NULL,
  p_vertical text DEFAULT 'revenda_veiculos'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('verde','vermelho') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  INSERT INTO gold_jornada_resultado (vertical, jornada, status, execucao_id, detalhe)
  VALUES (p_vertical, p_jornada, p_status, p_execucao_id, left(p_detalhe, 2000))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_jornada_registrar_resultado(text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_jornada_registrar_resultado(text,text,uuid,text,text) TO service_role;

-- ── mapa jornada→requisito (o que CADA jornada R1b/R2 realmente exercita — RD-38, sem super-declarar) ─
-- Casado por tela_num + texto do requisito (robusto a mudança de id).
WITH mapa(jornada, tela_num, req_like) AS (VALUES
  ('ficha',        4,  'Detalhes gravam e limpam%'),                      -- edita/apaga versão e confere no banco (#49)
  ('precificacao', 8,  'Encargos e preço mínimo por dentro%'),            -- preço mínimo (fonte única) na precificação
  ('precificacao', 4,  'Preço mínimo da fonte única%'),                   -- e o MESMO preço mínimo na ficha
  ('vistoria',     6,  'Rápida (9) padrão%'),                             -- abrir não cria; rápida 9 itens
  ('vistoria',     6,  'Foto obrigatória%'),                              -- sem foto não conclui
  ('vistoria',     6,  'Estado do item em 4 níveis%'),                    -- marca reparo/ok
  ('vistoria',     6,  'Previsão de gastos alimenta a precificação%'),    -- previsão vai ao custo total
  ('vendas',       10, 'Trava de entrega sem nota%'),                     -- Civic sem botão; HB20 demo com selo
  ('vendas',       10, 'Recebimentos por parte%')                         -- banco devedor na venda
)
INSERT INTO public.jornada_requisito (vertical, jornada, requisito_id)
SELECT 'revenda_veiculos', m.jornada, r.id
FROM mapa m
JOIN public.blueprint_tela_requisito r
  ON r.vertical = 'revenda_veiculos' AND r.tela_num = m.tela_num AND r.requisito LIKE m.req_like
ON CONFLICT (jornada, requisito_id) DO NOTHING;

-- ── fn_blueprint_cobertura: jornada verde prevalece sobre a foto ────────────────────────────────────
-- Precedência por requisito: jornada verde (última execução) → 'atendido'; senão a última foto; senão baseline.
CREATE OR REPLACE FUNCTION public.fn_blueprint_cobertura(p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;

  WITH jverde AS (  -- requisitos cuja jornada mapeada teve a ÚLTIMA execução verde
    SELECT DISTINCT jr.requisito_id
    FROM jornada_requisito jr
    WHERE jr.vertical = p_vertical
      AND EXISTS (
        SELECT 1 FROM gold_jornada_resultado g
        WHERE g.vertical = jr.vertical AND g.jornada = jr.jornada AND g.status = 'verde'
          AND g.avaliado_em = (SELECT max(g2.avaliado_em) FROM gold_jornada_resultado g2
                               WHERE g2.vertical = jr.vertical AND g2.jornada = jr.jornada)
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
