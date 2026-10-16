-- Observabilidade da esteira — BASE compartilhada (CEO 10/10, sessão interativa). "Parar de voar cego": o motivo real
-- de cada PR presa só saía no log da fila (gh api). Aqui a BASE que as próximas PRs (dashboard e vigia self-heal) leem:
--   (1) erp_esteira_pr_estado — snapshot "por que esta PR está presa", gravado a cada run da fila-merge.sh;
--   (2) erp_esteira_vigia_acao — log de ação do vigia self-heal (o humano VÊ o que o robô fez); esquema só, usado na
--       PR do workflow esteira-selfheal.
-- Escrita só pela service_role (canal protegido, como erp_dev_entrega); leitura só da equipe PS (fn_dev_painel_pode_ver).
-- Sem dado de cliente — é só esteira. RD-79 (nada ao anon), RD-52 (migration por arquivo, nunca apply_migration à mão).

-- ── (1) estado por PR: por que está presa ───────────────────────────────────────────────────────────────────────────
-- Snapshot VIVO: a fila regrava a cada run (upsert + remove quem saiu da fila). A aba agrupa por `motivo`, não mostra
-- "44 prontas" solto. `motivo` é exatamente a frase que a fila loga para a PR (bate com o log — RD-38).
CREATE TABLE IF NOT EXISTS public.erp_esteira_pr_estado (
  pr_numero     integer PRIMARY KEY CHECK (pr_numero > 0),
  via           text        CHECK (via IN ('rapida','revisada')),
  estado        text        NOT NULL,                     -- esperando | fora-da-rodada | mergeada | avaliando
  motivo        text        NOT NULL,                     -- frase curta da fila (o porquê)
  tem_migration boolean     NOT NULL DEFAULT false,
  checks_resumo jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {gates, check_fn_guards, aceitacao, vercel...} quando a fila tiver
  run_url       text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_esteira_pr_estado IS
  'Snapshot vivo do porquê de cada PR da fila estar presa (gravado pela fila-merge.sh a cada run). Leitura: equipe PS.';
ALTER TABLE public.erp_esteira_pr_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_esteira_pr_estado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_esteira_pr_estado TO authenticated;  -- filtrado pela policy abaixo (equipe PS)
DROP POLICY IF EXISTS erp_esteira_pr_estado_sel_ps ON public.erp_esteira_pr_estado;
CREATE POLICY erp_esteira_pr_estado_sel_ps ON public.erp_esteira_pr_estado
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());
-- Escrita: nenhuma policy → só a service_role (bypassa RLS). anon/authenticated não escrevem.

-- ── (2) log de ação do vigia self-heal (esquema; usado na PR do workflow) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_esteira_vigia_acao (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quando      timestamptz NOT NULL DEFAULT now(),
  acao        text        NOT NULL,   -- cancelar-superado | rerun-cancelado | redisparar-deploy | acionar-quarentena | alerta-preso
  alvo        text,                   -- run id / #PR / sha
  resultado   text,                   -- ok | no-op | falhou | parou
  detalhe     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ciclo_chave text                    -- idempotência: no máx 1 ação por chave (ex.: acao+run+sha)
);
COMMENT ON TABLE public.erp_esteira_vigia_acao IS
  'Toda ação do vigia self-heal da esteira (só encanamento, nunca aprovação). O humano vê o que o robô fez. Escrita: service_role.';
CREATE UNIQUE INDEX IF NOT EXISTS erp_esteira_vigia_acao_ciclo_uk
  ON public.erp_esteira_vigia_acao (ciclo_chave) WHERE ciclo_chave IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_esteira_vigia_acao_quando_idx ON public.erp_esteira_vigia_acao (quando DESC);
ALTER TABLE public.erp_esteira_vigia_acao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_esteira_vigia_acao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_esteira_vigia_acao TO authenticated;
DROP POLICY IF EXISTS erp_esteira_vigia_acao_sel_ps ON public.erp_esteira_vigia_acao;
CREATE POLICY erp_esteira_vigia_acao_sel_ps ON public.erp_esteira_vigia_acao
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

-- ── Writer (service_role): regrava o snapshot inteiro a cada run da fila ──────────────────────────────────────────────
-- p_estados = jsonb array de {pr, via, estado, motivo, tem_migration, checks}. Upsert de cada um e REMOVE as PRs que
-- não vieram no snapshot (saíram da fila / mergearam). Idempotente. Só service_role.
-- ci-sem-guarda: fn_esteira_pr_estado_gravar — erp_esteira_pr_estado é meta da esteira (números de PR), SEM company_id e
-- sem dado de cliente; escrita fechada à service_role (REVOKE anon/authenticated), então não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_esteira_pr_estado_gravar(p_run_url text, p_estados jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prs integer[];
BEGIN
  IF p_estados IS NULL OR jsonb_typeof(p_estados) <> 'array' THEN RETURN 0; END IF;
  SELECT array_agg((e->>'pr')::int) INTO v_prs FROM jsonb_array_elements(p_estados) e WHERE (e->>'pr') ~ '^\d+$';
  v_prs := coalesce(v_prs, ARRAY[]::integer[]);

  INSERT INTO public.erp_esteira_pr_estado (pr_numero, via, estado, motivo, tem_migration, checks_resumo, run_url, atualizado_em)
  SELECT (e->>'pr')::int,
         nullif(e->>'via',''),
         coalesce(nullif(e->>'estado',''), 'avaliando'),
         coalesce(nullif(e->>'motivo',''), '(sem motivo)'),
         coalesce((e->>'tem_migration')::boolean, false),
         coalesce(e->'checks', '{}'::jsonb),
         p_run_url, now()
  FROM jsonb_array_elements(p_estados) e
  WHERE (e->>'pr') ~ '^\d+$'
  ON CONFLICT (pr_numero) DO UPDATE SET
    via = EXCLUDED.via, estado = EXCLUDED.estado, motivo = EXCLUDED.motivo,
    tem_migration = EXCLUDED.tem_migration, checks_resumo = EXCLUDED.checks_resumo,
    run_url = EXCLUDED.run_url, atualizado_em = EXCLUDED.atualizado_em;

  DELETE FROM public.erp_esteira_pr_estado WHERE pr_numero <> ALL (v_prs);
  RETURN cardinality(v_prs);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_esteira_pr_estado_gravar(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_esteira_pr_estado_gravar(text, jsonb) TO service_role;

-- ── Reader (equipe PS): a pilha AGRUPADA por motivo + as linhas ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_esteira_pr_estado_listar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RAISE EXCEPTION 'sem permissão' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object(
    'atualizado_em', (SELECT max(atualizado_em) FROM erp_esteira_pr_estado),
    'total', (SELECT count(*) FROM erp_esteira_pr_estado),
    'por_motivo', (SELECT coalesce(jsonb_agg(m ORDER BY (m->>'qtd')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('motivo', motivo, 'estado', min(estado), 'qtd', count(*),
                                  'prs', jsonb_agg(pr_numero ORDER BY pr_numero)) AS m
        FROM erp_esteira_pr_estado GROUP BY motivo) g),
    'prs', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'pr', pr_numero, 'via', via, 'estado', estado, 'motivo', motivo,
        'tem_migration', tem_migration, 'checks', checks_resumo, 'atualizado_em', atualizado_em
      ) ORDER BY pr_numero), '[]'::jsonb) FROM erp_esteira_pr_estado)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_esteira_pr_estado_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_esteira_pr_estado_listar() TO authenticated, service_role;
