-- Sócios (rodrigo-code, jordana-code) entram no pool de devs plenos da esteira (CEO 09/11).
-- Causa: fn_dev_mais_vazio e o roteador de gaps só olhavam papel 'dev_hub'/'dev_ui' e execução em erp_code_execucao_log,
-- que os sócios nunca gravam (logam na conta deles). Entregam PR em erp_dev_entrega.
--
-- 1) Pool: papel de dev + os dois sócios (explícitos; erp_agente_papel tem chave só em agente, então não se dá papel).
-- 2) "Ativo": execução nas últimas 2 h (erp_code_execucao_log) OU entrega de PR nas últimas 3 h (erp_dev_entrega).
-- 3) Teto de elegibilidade: menos de 10 CHAMADO# abertos (carteira). Carteira NÃO conta no ranking de gaps:
--    o ranking do roteador de gaps conta só as tarefas 'GAPS ·' abertas.
-- 4) Núcleo continua indo só para code-desenvolvedor-3 (excluído do pool de gaps como antes).
-- Aditiva: nenhuma tabela, nenhum papel novo, nenhum cron. Sem execução no merge.

-- ── 1. Pool do chamado (fn_dev_mais_vazio) ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dev_mais_vazio()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT q.agente
    FROM (
      SELECT p.agente FROM public.erp_agente_papel p
       WHERE p.papel = 'dev_hub' AND p.agente <> 'gilberto-desenv'
      UNION
      SELECT x.agente FROM (VALUES ('jordana-code'), ('rodrigo-code')) AS x(agente)
    ) q
   WHERE (EXISTS (SELECT 1 FROM public.erp_code_execucao_log l
                   WHERE l.agente = q.agente AND l.iniciada_em > now() - interval '2 hours')
          OR EXISTS (SELECT 1 FROM public.erp_dev_entrega e
                      WHERE e.code = q.agente AND e.ocorrido_em > now() - interval '3 hours'))
     AND (SELECT count(*) FROM public.erp_agente_mensagem m
           WHERE m.para = q.agente AND m.assunto LIKE 'CHAMADO #%'
             AND m.status IN ('nova', 'recebida', 'em_andamento')
             AND coalesce(m.arquivada, false) = false) < 10
   ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = q.agente AND m.status IN ('nova', 'recebida', 'em_andamento')
                AND coalesce(m.arquivada, false) = false) ASC,
            q.agente ASC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_dev_mais_vazio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_mais_vazio() TO service_role;

-- ── 2. Roteador de gaps (corpo da 20261110161545; só o pool e o ranking mudam) ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rotear_gaps_geral()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_hash text;
  v_n int;
  v_lista text;
  v_assunto text;
  v_code text;
  v_roteadas int := 0;
  v_pulou int := 0;
  v_sem_dev int := 0;
  v_detalhe jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_rotear_gaps_geral é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    WITH ult AS (
      SELECT DISTINCT ON (m.rota_base) m.rota_base, m.score_pct, m.bugs_detectados
        FROM public.erp_auditor_matriz_resultados m
       WHERE m.status = 'completo' AND m.rota_base IS NOT NULL
       ORDER BY m.rota_base, m.consultado_em DESC
    )
    SELECT u.rota_base, u.bugs_detectados,
           coalesce(s.area IN ('financeiro', 'fiscal', 'cadastros', 'permissoes')
            -- financeiro/contábil em qualquer área: conciliação, extrato, balanço, patrimônio, plano de contas, demonstração, ativo/passivo
            OR u.rota_base ~* '(conciliac|extrato|balan[cç]o|patrim[oô]nio|patrimonial|plano[-_]de[-_]contas|demonstra[cç]|/ativos?(/|-|$)|/passivos?(/|-|$))'
            -- só na GE: financeiro, DRE e fluxo de caixa
            OR (s.area = 'gestao_empresarial' AND u.rota_base ~* '(financeir|/dre|fluxo-de-caixa)'), false) AS nucleo
      FROM ult u
      LEFT JOIN public.system_screens s ON s.rota = u.rota_base
     WHERE u.score_pct < 95
       AND cardinality(u.bugs_detectados) > 0
       AND NOT EXISTS (SELECT 1 FROM public.hub_tela_dono h WHERE u.rota_base LIKE h.rota_prefixo || '%')
       -- rota com UUID de registro específico não é tela genérica: fora dos alvos
       AND u.rota_base !~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
     ORDER BY u.rota_base
  LOOP
    EXIT WHEN v_roteadas >= 40;  -- teto por rodada (cron de 20 min distribui o resto)

    v_n := cardinality(r.bugs_detectados);
    v_hash := md5(array_to_string(r.bugs_detectados, E'\n'));

    -- não repete: mesmo conjunto já roteado, ou tarefa aberta que cite esta rota
    IF EXISTS (SELECT 1 FROM public.gap_roteado_geral g WHERE g.rota = r.rota_base AND g.hash_gaps = v_hash)
       OR EXISTS (SELECT 1 FROM public.erp_agente_mensagem m
                   WHERE m.tipo = 'tarefa' AND m.status IN ('nova', 'em_andamento', 'recebida')
                     AND coalesce(m.arquivada, false) = false
                     AND strpos(m.assunto, r.rota_base) > 0) THEN
      v_pulou := v_pulou + 1;
      CONTINUE;
    END IF;

    -- dono: núcleo → code-desenvolvedor-3; demais → dev ATIVO (exec 2 h ou entrega 3 h) com teto de carteira,
    -- ranqueado pela fila de GAPS (a carteira de CHAMADO# não conta contra quem recebe gap)
    IF r.nucleo THEN
      v_code := 'code-desenvolvedor-3';
    ELSE
      SELECT q.agente INTO v_code
        FROM (
          SELECT p.agente FROM public.erp_agente_papel p
           WHERE p.papel IN ('dev_hub', 'dev_ui') AND p.agente NOT IN ('code-desenvolvedor-3', 'gilberto-desenv')
          UNION
          SELECT x.agente FROM (VALUES ('jordana-code'), ('rodrigo-code')) AS x(agente)
        ) q
       WHERE (EXISTS (SELECT 1 FROM public.erp_code_execucao_log l
                       WHERE l.agente = q.agente AND l.iniciada_em > now() - interval '2 hours')
              OR EXISTS (SELECT 1 FROM public.erp_dev_entrega e
                          WHERE e.code = q.agente AND e.ocorrido_em > now() - interval '3 hours'))
         AND (SELECT count(*) FROM public.erp_agente_mensagem m
               WHERE m.para = q.agente AND m.assunto LIKE 'CHAMADO #%'
                 AND m.status IN ('nova', 'recebida', 'em_andamento')
                 AND coalesce(m.arquivada, false) = false) < 10
       ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
                  WHERE m.para = q.agente AND m.assunto LIKE 'GAPS%'
                    AND m.status IN ('nova', 'recebida', 'em_andamento')
                    AND coalesce(m.arquivada, false) = false) ASC,
                q.agente ASC
       LIMIT 1;
      IF v_code IS NULL THEN
        v_sem_dev := v_sem_dev + 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT coalesce(string_agg('- ' || g, E'\n'), '') INTO v_lista
      FROM unnest(r.bugs_detectados[1:15]) AS g;

    v_assunto := 'GAPS · ' || r.rota_base || ' · ' || v_n || ' pendentes (auditor)';

    PERFORM public.fn_agente_mensagem_enviar(
      v_code, 'eng_chefe', 'tarefa', v_assunto,
      'O auditor deixou ' || v_n || ' gap(s) nesta tela sem estar atendidos.' || E'\n'
      || 'Tela: ' || r.rota_base || E'\n'
      || coalesce(nullif(v_lista, ''), '(ver a matriz do auditor)') || E'\n\n'
      || 'Corrija um por PR pequena. A tela só é liberada a 100%. O auditor reaudita sozinho e esta tarefa volta se sobrar gap. '
      || 'Responda ENTREGUE / EM TESTE / PRÓXIMO.',
      false, 'eng_chefe');

    INSERT INTO public.gap_roteado_geral (rota, code, hash_gaps, n_gaps, enviado_em)
    VALUES (r.rota_base, v_code, v_hash, v_n, now())
    ON CONFLICT (rota) DO UPDATE SET code = EXCLUDED.code, hash_gaps = EXCLUDED.hash_gaps,
                                     n_gaps = EXCLUDED.n_gaps, enviado_em = EXCLUDED.enviado_em;

    v_roteadas := v_roteadas + 1;
    v_detalhe := v_detalhe || jsonb_build_object('rota', r.rota_base, 'code', v_code, 'gaps', v_n);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteadas', v_roteadas, 'sem_mudanca', v_pulou,
                            'sem_dev_disponivel', v_sem_dev, 'detalhe', v_detalhe, 'em', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_rotear_gaps_geral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rotear_gaps_geral() TO service_role;
