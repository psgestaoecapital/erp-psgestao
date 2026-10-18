-- Reserva de vaga da esteira no banco (CEO 18/10, sessão interativa) — corrige a CORRIDA do sorteio de vaga.
-- Problema: scripts/merge/aceitacao-sortear-vaga.sh mede a ocupação lendo o marcador no LOG da triagem dos runs ativos.
-- Runs recém-criados ainda não têm log → quando várias triagens rodam juntas (ex.: 9 PRs às 10:47), todas veem as
-- vagas vazias e quase todas escolhem a vaga 0 (6 na fila da vaga 0, vaga 2 parada).
-- Solução: uma RESERVA transacional no banco (pg_advisory_xact_lock) que conta reservas ATIVAS por vaga e grava a reserva
-- na vaga com MENOS reservas (empate → menor número). Como o lock serializa as triagens concorrentes, a 1ª vê 0/0 e pega
-- a 0, a 2ª já vê 1/0 e pega a 2, e assim por diante — divisão real entre as vagas.
-- Só orquestração da esteira: SEM company_id e SEM dado de cliente. Escrita fechada à service_role (como erp_dev_entrega
-- / erp_esteira_pr_estado); leitura só da equipe PS. RD-79 (nada ao anon). RD-52 (migration por arquivo, nunca apply à mão).

-- ── Tabela de reservas ────────────────────────────────────────────────────────────────────────────────────────────
-- A chave da tentativa é (run_id, run_attempt): um re-run do mesmo run (run_attempt novo) NÃO herda a vaga antiga —
-- faz reserva nova, escolhendo a vaga com menos reservas NA HORA (revisão do Eng. Chefe 18/10).
CREATE TABLE IF NOT EXISTS public.erp_esteira_vaga_reserva (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pr_numero   integer     NOT NULL CHECK (pr_numero > 0),
  run_id      bigint      NOT NULL,
  run_attempt integer     NOT NULL DEFAULT 1 CHECK (run_attempt > 0),
  vaga        integer     NOT NULL CHECK (vaga >= 0),
  criada_em   timestamptz NOT NULL DEFAULT now(),
  liberada_em timestamptz,                               -- preenchida quando o run acaba (fn_esteira_liberar_vaga)
  motivo      text
);
COMMENT ON TABLE public.erp_esteira_vaga_reserva IS
  'Reservas de vaga da esteira (orquestração do sorteio ciente de ocupação). Sem dado de cliente. Escrita: service_role.';

-- Reserva ATIVA = liberada_em nula E criada_em nas últimas 2 h (reserva esquecida expira sozinha, não trava a vaga).
CREATE INDEX IF NOT EXISTS erp_esteira_vaga_reserva_ativa_idx
  ON public.erp_esteira_vaga_reserva (vaga, criada_em) WHERE liberada_em IS NULL;
-- Uma TENTATIVA (run_id, run_attempt) tem no máximo uma reserva ATIVA (idempotência de re-chamada dentro da tentativa).
CREATE UNIQUE INDEX IF NOT EXISTS erp_esteira_vaga_reserva_tentativa_ativa_uk
  ON public.erp_esteira_vaga_reserva (run_id, run_attempt) WHERE liberada_em IS NULL;

ALTER TABLE public.erp_esteira_vaga_reserva ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_esteira_vaga_reserva FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_esteira_vaga_reserva TO authenticated;  -- filtrado pela policy (equipe PS)
DROP POLICY IF EXISTS erp_esteira_vaga_reserva_sel_ps ON public.erp_esteira_vaga_reserva;
CREATE POLICY erp_esteira_vaga_reserva_sel_ps ON public.erp_esteira_vaga_reserva
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());
-- Escrita: nenhuma policy → só a service_role (bypassa RLS). anon/authenticated não escrevem.

-- ── Reservar (service_role): escolhe e grava a vaga com menos reservas ativas ─────────────────────────────────────────
-- ci-sem-guarda: fn_esteira_reservar_vaga — meta da esteira (orquestração de vaga), SEM company_id e sem dado de cliente;
-- escrita fechada à service_role (REVOKE anon/authenticated), então não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_esteira_reservar_vaga(p_pr integer, p_run_id bigint, p_run_attempt integer, p_vagas integer[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_elegiveis integer[];
  v_vaga      integer;
  v_existente integer;
BEGIN
  -- serializa as triagens concorrentes (a corrida das 9 às 10:47): entram em fila neste lock e cada uma já vê a reserva
  -- da anterior. O lock é de TRANSAÇÃO (cai no commit/rollback), nunca fica preso.
  PERFORM pg_advisory_xact_lock(hashtext('erp_esteira_vaga_reserva'));

  -- a vaga 1 é RESERVADA para a aceitação da main: nunca entra no sorteio de PR, mesmo que o chamador a passe.
  SELECT array_agg(v ORDER BY v) INTO v_elegiveis
  FROM unnest(coalesce(p_vagas, ARRAY[]::integer[])) AS v
  WHERE v <> 1;
  IF v_elegiveis IS NULL OR cardinality(v_elegiveis) = 0 THEN
    v_elegiveis := ARRAY[0];   -- cinto de segurança: sem elegíveis → vaga 0 (serial), como o sorteio antigo
  END IF;

  -- idempotência SÓ se a reserva DESTA tentativa (run_id, run_attempt) ainda está ATIVA (liberada_em nula E < 2 h):
  -- re-chamada dentro da mesma tentativa devolve a mesma vaga. Se a reserva já foi LIBERADA, ou se é uma tentativa NOVA
  -- (run_attempt diferente), NÃO reaproveita — cai no sorteio abaixo e escolhe a vaga com menos reservas na hora.
  SELECT vaga INTO v_existente
  FROM erp_esteira_vaga_reserva
  WHERE run_id = p_run_id AND run_attempt = p_run_attempt
    AND liberada_em IS NULL AND criada_em >= now() - interval '2 hours'
  ORDER BY criada_em DESC
  LIMIT 1;
  IF v_existente IS NOT NULL THEN
    RETURN v_existente;
  END IF;

  -- escolhe a vaga elegível com MENOS reservas ATIVAS (liberada_em nula e criada_em nas últimas 2 h); empate → menor.
  SELECT e.v INTO v_vaga
  FROM unnest(v_elegiveis) AS e(v)
  LEFT JOIN erp_esteira_vaga_reserva r
    ON r.vaga = e.v AND r.liberada_em IS NULL AND r.criada_em >= now() - interval '2 hours'
  GROUP BY e.v
  ORDER BY count(r.id) ASC, e.v ASC
  LIMIT 1;

  INSERT INTO erp_esteira_vaga_reserva (pr_numero, run_id, run_attempt, vaga, motivo)
  VALUES (p_pr, p_run_id, p_run_attempt, v_vaga, 'reserva de vaga na triagem (sorteio ciente de ocupação no banco)');

  RETURN v_vaga;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_esteira_reservar_vaga(integer, bigint, integer, integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_esteira_reservar_vaga(integer, bigint, integer, integer[]) TO service_role;

-- ── Liberar (service_role): marca liberada_em da reserva da tentativa ao fim do run ───────────────────────────────────
-- ci-sem-guarda: fn_esteira_liberar_vaga — meta da esteira; só marca liberada_em da reserva do run; escrita fechada à
-- service_role, sem company_id nem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_esteira_liberar_vaga(p_run_id bigint, p_run_attempt integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE erp_esteira_vaga_reserva
  SET liberada_em = now()
  WHERE run_id = p_run_id AND run_attempt = p_run_attempt AND liberada_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_esteira_liberar_vaga(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_esteira_liberar_vaga(bigint, integer) TO service_role;
