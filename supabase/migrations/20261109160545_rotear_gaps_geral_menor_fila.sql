-- Roteador GERAL de gaps (anti-ócio): generaliza o padrão do fn_hub_rotear_gaps para TODAS as verticais.
-- Varre a última nota 'completo' de cada rota da matriz do auditor; rota com nota < 95 E gap concreto
-- (bugs_detectados não vazio) vira UMA tarefa de conserto ao dono:
--   · NÚCLEO (financeiro/fiscal/cadastros/permissões, e financeiro/DRE/conciliação/plano-de-contas/extrato da GE)
--     → sempre 'code-desenvolvedor-3';
--   · demais telas → o dev de UI ATIVO com MENOR fila (tarefas abertas). "Ativo" = executou nas últimas 2 h
--     (erp_code_execucao_log), não a flag pausado (desatualizada). 'gilberto-desenv' fica de fora.
-- Não duplica: pula rota com tarefa aberta que cite a rota, e rota já roteada com o mesmo conjunto de gaps.
-- Rotas do Hub ficam com o fn_hub_rotear_gaps (já roteadas por ele; aqui são excluídas).
-- Aditiva: 1 tabela de controle, 1 função nova, 1 cron novo. Nenhuma função existente é alterada.
-- Cron: a cada 20 min (autorizado pelo CEO). Ao final, roda UMA vez para a distribuição começar já no merge.

-- ── 1. Controle de roteamento (idempotência) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gap_roteado_geral (
  rota        text PRIMARY KEY,
  code        text NOT NULL,
  hash_gaps   text NOT NULL,
  n_gaps      integer NOT NULL,
  enviado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gap_roteado_geral ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gap_roteado_geral FROM PUBLIC, anon, authenticated;

-- ── 2. Roteador geral (só cron/serviço) ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rotear_gaps_geral()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
            OR (s.area = 'gestao_empresarial'
                AND u.rota_base ~* '(financeir|/dre|conciliac|plano-de-contas|plano_de_contas|extrato|fluxo-de-caixa)'), false) AS nucleo
      FROM ult u
      LEFT JOIN public.system_screens s ON s.rota = u.rota_base
     WHERE u.score_pct < 95
       AND cardinality(u.bugs_detectados) > 0
       AND NOT EXISTS (SELECT 1 FROM public.hub_tela_dono h WHERE u.rota_base LIKE h.rota_prefixo || '%')
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
$fn$;

REVOKE ALL ON FUNCTION public.fn_rotear_gaps_geral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rotear_gaps_geral() TO service_role;

-- ── 3. Cron a cada 20 min (idempotente: recria o agendamento se já existir) ──────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rotear-gaps-geral-20min') THEN
    PERFORM cron.unschedule('rotear-gaps-geral-20min');
  END IF;
  PERFORM cron.schedule('rotear-gaps-geral-20min', '*/20 * * * *', 'SELECT public.fn_rotear_gaps_geral();');
END
$cron$;

-- ── 4. Primeira rodada no próprio merge (sem esperar o 1º tick do cron) ─────────────────────────────────
SELECT public.fn_rotear_gaps_geral();
