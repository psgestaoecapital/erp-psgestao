-- NÚCLEO/tooling · fn_matriz_registrar_nota — writer da FONTE OFICIAL da nota (erp_auditor_matriz_resultados).
-- Dois defeitos provados no dado (RD-38) que travam/corrompem a recontagem dos 95 (diretriz dura do CEO):
--
-- DEFEITO 1 — resolução de módulo LOSSY:
--   A versão viva resolve o módulo por `WHERE rota_completa LIKE p_rota || '%'` + ORDER BY consultado_em.
--   PROVA RD-38: para p_rota='/dashboard/produtividade', o LIKE casa 5 sub-rotas com MÓDULOS DIFERENTES
--     (produtividade_apontamento, projetos_custos-posto, projetos_mapa, ind_produtos_planta, projetos_tarefas) e
--     grava a nota no módulo de uma sub-rota qualquer (a mais recente). E rota NOVA sem histórico cai no fallback
--     `regexp_replace(p_rota,'^.*/','projetos_')` -> odonto/bpo/oficina/financeiro viram projetos_X (rótulo errado).
--     Hoje há 81 rotas reais gravadas SÓ com esse padrão corrompido (ex.: /dashboard/financeiro/extrato ->
--     projetos_extrato; módulos projetos reais são UUID, nunca `projetos_<slug>`).
--
-- DEFEITO 2 — INSERT sem ON CONFLICT:
--   A tabela tem UNIQUE uq_run_modulo(run_id,modulo_id). O run do dia (aud8-max) é reusado; re-pontuar um módulo
--   já gravado no run estoura unique_violation -> impossível recontar a mesma tela 2x/dia.
--
-- CORREÇÃO (aditiva, núcleo tooling, sensível -> revisao-eng-chefe):
--   (1) DEPARA EXPLÍCITO rota->módulo em tabela nova `erp_auditor_matriz_depara` (global, sem company_id, como
--       module_catalog). Semeada a partir do histórico CONFIÁVEL (exclui o padrão corrompido projetos_<rota-não-projetos>).
--       A resolução passa a ser por ROTA EXATA normalizada (sem query string, sem barra final) — acaba a colisão de prefixo.
--   (2) Sem match no depara nem no histórico exato (confiável): NÃO inventa projetos_X — LEVANTA erro nomeando a rota;
--       a nota NÃO é gravada, para não corromper a matriz (comportamento pedido pelo aud8). O eng/aud8 adiciona a linha
--       em erp_auditor_matriz_depara e a recontagem segue. (RAISE desfaz escritas da mesma transação, por isso o
--       registro da rota desconhecida é o próprio erro — não um INSERT que o rollback apagaria.)
--   (3) INSERT ... ON CONFLICT (run_id,modulo_id) DO UPDATE — recontar 2x/dia atualiza a linha em vez de estourar.
--
-- RD-52: arquivo em supabase/migrations/, versão acima da main (segundos :35 = faixa code-desenvolvedor-3). Aditivo:
--   NÃO altera dado existente da matriz (a limpeza dos 81 corrompidos fica para tarefa própria), NÃO toca dado de
--   cliente. Prova RD-38 BEGIN..ROLLBACK no corpo da tarefa antes do merge.
-- Code: code-desenvolvedor-3

-- ========== (1) DEPARA EXPLÍCITO rota -> módulo (global, espelha o padrão de module_catalog) ==========
CREATE TABLE IF NOT EXISTS public.erp_auditor_matriz_depara (
  rota          text PRIMARY KEY,
  modulo_id     text NOT NULL,
  modulo_nome   text,
  rota_base     text,
  screen_id     text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_auditor_matriz_depara IS
  'Depara explícito rota->módulo da matriz de auditoria (fn_matriz_registrar_nota). Global (sem company_id), como module_catalog. Rota sem linha aqui e sem histórico confiável = desconhecida: a função levanta erro nomeando a rota para mapeamento manual do eng/aud8.';

ALTER TABLE public.erp_auditor_matriz_depara ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_auditor_matriz_depara_select_authenticated ON public.erp_auditor_matriz_depara;
CREATE POLICY erp_auditor_matriz_depara_select_authenticated
  ON public.erp_auditor_matriz_depara FOR SELECT TO authenticated USING (true);
REVOKE ALL ON TABLE public.erp_auditor_matriz_depara FROM anon;
GRANT SELECT ON TABLE public.erp_auditor_matriz_depara TO authenticated;

-- Semeia o depara com o histórico CONFIÁVEL (latest por rota, excluindo o padrão corrompido projetos_<rota-não-projetos>).
-- Idempotente: ON CONFLICT DO NOTHING preserva qualquer mapeamento manual já corrigido.
INSERT INTO public.erp_auditor_matriz_depara (rota, modulo_id, modulo_nome, rota_base, screen_id)
SELECT DISTINCT ON (rota) rota, modulo_id, modulo_nome, rota_base, screen_id
FROM (
  SELECT regexp_replace(split_part(rota_completa, '?', 1), '/+$', '') AS rota,
         modulo_id, modulo_nome, rota_base, screen_id, consultado_em
  FROM public.erp_auditor_matriz_resultados
  WHERE modulo_id IS NOT NULL
) s
WHERE rota <> ''
  AND NOT (modulo_id ~ '^projetos_' AND rota !~ '^/dashboard/projetos/')
ORDER BY rota, consultado_em DESC NULLS LAST
ON CONFLICT (rota) DO NOTHING;

-- ========== (2)(3) WRITER corrigido ==========
-- ci-sem-guarda: fn_matriz_registrar_nota — writer GLOBAL da matriz de auditoria (sem company_id; não há empresa a conferir). Acesso restrito a service_role/aud8 via REVOKE anon; chamada por conexão de serviço, não por usuário final.
CREATE OR REPLACE FUNCTION public.fn_matriz_registrar_nota(
  p_rota text,
  p_score integer,
  p_bugs text[] DEFAULT '{}'::text[],
  p_recomendacoes text[] DEFAULT '{}'::text[],
  p_proximo_passo text DEFAULT NULL::text,
  p_area text DEFAULT 'hub'::text
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run  bigint;
  v_mod  text;
  v_base text;
  v_nome text;
  v_scr  text;
  v_rc   text;
  v_rota text;
  v_id   bigint;
BEGIN
  -- rota normalizada: sem query string, sem barra final
  v_rota := regexp_replace(split_part(p_rota, '?', 1), '/+$', '');

  -- (A) DEPARA EXPLÍCITO (autoridade).
  SELECT d.modulo_id, d.modulo_nome, d.rota_base, d.screen_id
    INTO v_mod, v_nome, v_base, v_scr
    FROM erp_auditor_matriz_depara d
   WHERE d.rota = v_rota;

  -- (B) Fallback: histórico por ROTA EXATA normalizada (não LIKE), excluindo o padrão corrompido projetos_<não-projetos>.
  IF v_mod IS NULL THEN
    SELECT r.modulo_id, r.modulo_nome, r.rota_base, r.screen_id
      INTO v_mod, v_nome, v_base, v_scr
      FROM erp_auditor_matriz_resultados r
     WHERE regexp_replace(split_part(r.rota_completa, '?', 1), '/+$', '') = v_rota
       AND r.modulo_id IS NOT NULL
       AND NOT (r.modulo_id ~ '^projetos_' AND v_rota !~ '^/dashboard/projetos/')
     ORDER BY r.consultado_em DESC NULLS LAST
     LIMIT 1;
  END IF;

  -- (C) Desconhecida: NÃO inventa projetos_X. Levanta erro nomeando a rota (nota não gravada; sem corromper a matriz).
  IF v_mod IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format('fn_matriz_registrar_nota: rota "%s" sem depara — adicione em erp_auditor_matriz_depara(rota, modulo_id, ...); nota NÃO gravada para não corromper a matriz.', v_rota);
  END IF;

  v_base := COALESCE(v_base, v_rota);
  v_rc   := p_rota;  -- preserva a rota completa (com query string), como antes

  -- run do dia (aud8-max), reusado
  SELECT id INTO v_run FROM erp_auditor_matriz_runs
    WHERE modo = 'manual' AND trigger_origin = 'aud8-max'
      AND iniciado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ORDER BY id DESC LIMIT 1;
  IF v_run IS NULL THEN
    INSERT INTO erp_auditor_matriz_runs (area_id, modo, status, trigger_origin, observacao, custo_estimado_usd)
    VALUES (p_area, 'manual', 'em_andamento', 'aud8-max', 'Auditoria no Max (vazamento 2) — custo externo zero', 0)
    RETURNING id INTO v_run;
  END IF;

  -- (3) grava/atualiza a nota — recontar 2x/dia atualiza em vez de estourar o uq_run_modulo
  INSERT INTO erp_auditor_matriz_resultados
    (run_id, modulo_id, modulo_nome, rota_base, rota_completa, screen_id, t0_dispatch,
     status, consultado_em, score_pct, bugs_detectados, recomendacoes, proximo_passo)
  VALUES (v_run, v_mod, v_nome, v_base, COALESCE(v_rc, p_rota), v_scr, now(),
     'completo', now(), p_score, p_bugs, p_recomendacoes, p_proximo_passo)
  ON CONFLICT (run_id, modulo_id) DO UPDATE SET
     score_pct       = EXCLUDED.score_pct,
     bugs_detectados = EXCLUDED.bugs_detectados,
     recomendacoes   = EXCLUDED.recomendacoes,
     proximo_passo   = EXCLUDED.proximo_passo,
     modulo_nome     = COALESCE(EXCLUDED.modulo_nome, erp_auditor_matriz_resultados.modulo_nome),
     rota_base       = EXCLUDED.rota_base,
     rota_completa   = EXCLUDED.rota_completa,
     screen_id       = COALESCE(EXCLUDED.screen_id, erp_auditor_matriz_resultados.screen_id),
     consultado_em   = now(),
     status          = 'completo',
     updated_at      = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_matriz_registrar_nota(text, integer, text[], text[], text, text) FROM PUBLIC, anon;
