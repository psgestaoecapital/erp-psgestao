-- Conserta o LEAK de reserva de vaga da esteira (gilberto-desenv 19/10). Diagnóstico no dado (RD-38):
-- o aceitacao-pr.yml dispara em deployment_status; cada evento da Vercel (building→ready) cria um RUN novo (run_id novo),
-- e cada triagem RESERVA uma vaga. Uma PR acumula VÁRIAS reservas (ex.: #2563 com 2 reservas ativas, runs 39309756842 e
-- 39310076822) e os runs superados/cancelados NÃO liberam: o job liberar-reserva tem `needs: aceitacao`, que o GitHub
-- cancela junto quando o run é cancelado. Resultado: reservas ativas acumulam dentro da janela de 2 h, o sorteio vê as
-- vagas cheias e serializa (cadência ~48 min, ~1/h). Em 19/10 16:57 havia 14 reservas abertas, presas 220–290 min.
--
-- Duas correções no banco (a 3ª, reconciliação contra o run real + alerta > 90 min, fica no vigia-runs.yml, que tem a
-- API do GitHub; aqui exponho só a leitura que o vigia usa):
--   (A) fn_esteira_reservar_vaga passa a LIBERAR a reserva ATIVA anterior da MESMA PR antes de gravar a nova — assim cada
--       PR tem no máximo UMA reserva ativa (a do run corrente). Mata a duplicata na origem e faz o leak se auto-curar no
--       próximo run da PR. Feito DENTRO do pg_advisory_xact_lock que já serializa as triagens, então é atômico.
--   (B) fn_esteira_vagas_presas(p_min): lista as reservas ativas abertas há mais de p_min minutos (o vigia usa para
--       reconciliar contra o run real e alertar as presas > 90 min). Só leitura.
-- NÃO adiciono índice único em pr_numero WHERE liberada_em IS NULL: o INSERT da reserva quebraria numa corrida e travaria
-- a triagem (a PR não pegaria vaga). A liberação-da-anterior sob o lock já garante no máximo 1 ativa por PR.
-- Só orquestração da esteira: SEM company_id, SEM dado de cliente. Escrita fechada à service_role. RD-52 (arquivo+PR+merge).

-- ── (A) reservar: libera a reserva ativa anterior da MESMA PR antes de gravar a nova ─────────────────────────────────
-- ci-sem-guarda: fn_esteira_reservar_vaga — orquestração de vaga da esteira, SEM company_id e sem dado de cliente;
-- escrita fechada à service_role (REVOKE anon/authenticated), então não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_esteira_reservar_vaga(p_pr integer, p_run_id bigint, p_run_attempt integer, p_vagas integer[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_elegiveis integer[];
  v_vaga      integer;
  v_existente integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('erp_esteira_vaga_reserva'));

  SELECT array_agg(v ORDER BY v) INTO v_elegiveis
  FROM unnest(coalesce(p_vagas, ARRAY[]::integer[])) AS v
  WHERE v <> 1;                                 -- vaga 1 é da aceitação da main, nunca entra no sorteio de PR
  IF v_elegiveis IS NULL OR cardinality(v_elegiveis) = 0 THEN
    v_elegiveis := ARRAY[0];                    -- cinto de segurança: sem elegíveis → vaga 0 (serial)
  END IF;

  -- idempotência DENTRO da mesma tentativa (run_id, run_attempt): re-chamada devolve a mesma vaga.
  SELECT vaga INTO v_existente
  FROM erp_esteira_vaga_reserva
  WHERE run_id = p_run_id AND run_attempt = p_run_attempt
    AND liberada_em IS NULL AND criada_em >= now() - interval '2 hours'
  ORDER BY criada_em DESC
  LIMIT 1;
  IF v_existente IS NOT NULL THEN
    RETURN v_existente;
  END IF;

  -- 19/10 (leak): uma PR dispara vários runs (deployment_status building→ready); cada triagem reservava e os runs
  -- superados não liberavam. Antes de gravar a reserva DESTA tentativa, libera as reservas ATIVAS de OUTRAS tentativas
  -- da MESMA PR (run/attempt diferentes) — o run corrente é o único que vale. Cada PR fica com no máximo 1 reserva ativa.
  UPDATE erp_esteira_vaga_reserva
  SET liberada_em = now(),
      motivo = coalesce(motivo, '') || ' | liberada: reserva anterior da mesma PR substituída pelo run ' || p_run_id || '/' || p_run_attempt
  WHERE pr_numero = p_pr
    AND liberada_em IS NULL
    AND NOT (run_id = p_run_id AND run_attempt = p_run_attempt);

  -- escolhe a vaga elegível com MENOS reservas ATIVAS (liberada_em nula e < 2 h); empate → menor.
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

-- ── (B) leitura das reservas presas (o vigia reconcilia contra o run real e alerta > 90 min) ─────────────────────────
-- ci-sem-guarda: fn_esteira_vagas_presas — só leitura de orquestração da esteira, sem company_id nem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_esteira_vagas_presas(p_min integer DEFAULT 90)
RETURNS TABLE (pr_numero integer, vaga integer, run_id bigint, run_attempt integer, min_aberta integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pr_numero, vaga, run_id, run_attempt,
         (extract(epoch FROM (now() - criada_em)) / 60)::integer AS min_aberta
  FROM public.erp_esteira_vaga_reserva
  WHERE liberada_em IS NULL
    AND criada_em <= now() - make_interval(mins => greatest(coalesce(p_min, 90), 0))
  ORDER BY criada_em;
$$;
REVOKE ALL ON FUNCTION public.fn_esteira_vagas_presas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_esteira_vagas_presas(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_esteira_vagas_presas(integer) TO authenticated;  -- leitura no painel (equipe PS); função só lê a tabela já exposta por policy
