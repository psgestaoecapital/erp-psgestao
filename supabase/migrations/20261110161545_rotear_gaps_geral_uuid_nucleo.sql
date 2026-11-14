-- Ajuste do roteador geral de gaps (fn_rotear_gaps_geral). CREATE OR REPLACE: corpo igual ao vivo, exceto:
--  1) rota com UUID de registro específico (ex.: /dashboard/projetos/obras/<uuid>/cockpit) NÃO entra nos alvos
--     (não é tela genérica; não deve ser roteada nem contada).
--  2) regex de NÚCLEO ampliado: conciliação, extrato, balanço, patrimônio, plano de contas, demonstração, ativo, passivo
--     (todas as áreas); financeiro/DRE/fluxo de caixa (só GE). Esses vão para code-desenvolvedor-3.

-- Inalterado: teto de 40 por rodada, menor fila por execução recente, dedupe (gap_roteado_geral),
-- exclusão de gilberto-desenv, rotas do Hub no fn_hub_rotear_gaps. Sem execução no merge.

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

    -- dono: núcleo → code-desenvolvedor-3; demais → dev de UI vivo com menor fila
    IF r.nucleo THEN
      v_code := 'code-desenvolvedor-3';
    ELSE
      SELECT p.agente INTO v_code
        FROM public.erp_agente_papel p
       WHERE p.papel IN ('dev_hub', 'dev_ui')
         AND p.agente NOT IN ('code-desenvolvedor-3', 'gilberto-desenv')
         -- "ativo" = executou nas últimas 2 h (erp_code_execucao_log). A flag erp_agente_papel.pausado
         -- está desatualizada (dev7claudeps aparece pausado mas roda de 1 h em 1 h) e NÃO é usada.
         AND EXISTS (SELECT 1 FROM public.erp_code_execucao_log l
                      WHERE l.agente = p.agente AND l.iniciada_em > now() - interval '2 hours')
       ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
                  WHERE m.para = p.agente AND m.tipo = 'tarefa'
                    AND m.status IN ('nova', 'em_andamento', 'recebida')
                    AND coalesce(m.arquivada, false) = false) ASC,
                p.agente ASC
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
