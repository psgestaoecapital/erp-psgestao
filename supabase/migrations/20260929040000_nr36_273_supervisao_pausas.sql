-- Frioeste #273 (SST · 28/09) · Supervisão: "pausa de undefined minutos às undefined".
-- Causa (provada 29/09): a apuração termica_253_v2 grava o desvio como { tipo: 'pausa_insuficiente', quantidade: N } e as
-- pausas do dia em detalhe.pausas; a Supervisão lia o formato antigo ({ duracao_min, inicio, minimo }) e não recebia as
-- pausas. Agora fn_nr36_supervisao_casos devolve também as pausas do dia (de, ate, min, classe) — a tela escreve cada
-- pausa curta com horário e minutos, e as pausas acima do tempo previsto do mesmo dia como gestão.
-- Só leitura: não reapura nada.
CREATE OR REPLACE FUNCTION public.fn_nr36_supervisao_casos(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'data', ap.data, 'cpf', ap.cpf, 'nome', c.nome, 'funcao', c.funcao, 'setor', c.departamento,
     'shift', ap.detalhe->'jornada'->>'shift',
     'gatilho_min', (ap.detalhe->'regra'->>'gatilho_min'),
     'pausa_min', (ap.detalhe->'regra'->>'pausa_min'),
     'jornada', (SELECT jsonb_build_object(
                   'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                   'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'))
                 FROM public.ind_ponto_marcacao mm WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data),
     'desvios', COALESCE(ap.detalhe->'desvios','[]'::jsonb),
     'pausas', COALESCE(ap.detalhe->'pausas','[]'::jsonb)   -- #273
   ) ORDER BY ap.data, c.nome), '[]'::jsonb) INTO v
  FROM public.nr36_pausa_apurada ap
  JOIN public.ind_ponto_colaborador c ON c.id=ap.colaborador_id
  WHERE ap.company_id=p_company_id AND ap.status='desvio' AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok',true,'casos',v);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_supervisao_casos(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_supervisao_casos(uuid, date, date) TO authenticated, service_role;

-- ── #273 · SINAL DE GESTÃO do limite de 1h40 (decisão do CEO, 29/09) ────────────────────────────────────────────
-- Art. 253 da CLT: 20 min de repouso a cada 1h40 de trabalho em ambiente frio. Mostra, com horário, cada trecho
-- contínuo sem pausa acima do limite (gatilho_min da régua), medido pelas batidas do ponto (pares entrada/saída) menos
-- as pausas com fim. NÃO entra no veredito (RD-38: a exposição é estimada pelo ponto). Só dias já apurados como
-- conforme/desvio (dia pendente ainda tem pausa sem fim — o trecho sairia falso). Mesma regra de
-- src/lib/ponto/supervisaoFrases.ts (trechosSemPausa). Só leitura.
CREATE OR REPLACE FUNCTION public.fn_nr36_supervisao_sinais(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb; d record; v_pontos int[]; v_pausas int[][]; v_lim int;
  i int; j int; v_ini int; v_fim int; v_atual int; v_de int; v_ate int; v_trechos jsonb;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  FOR d IN
    SELECT ap.cpf, ap.data, ap.status, c.nome, c.funcao, c.departamento AS setor,
           COALESCE((ap.detalhe->'regra'->>'gatilho_min')::int, 100) AS gatilho
      FROM public.nr36_pausa_apurada ap
      JOIN public.ind_ponto_colaborador c ON c.id = ap.colaborador_id
     WHERE ap.company_id = p_company_id AND ap.tipo = 'termica_253' AND ap.status IN ('conforme','desvio')
       AND ap.data BETWEEN p_dt_ini AND p_dt_fim
     ORDER BY ap.data, c.nome
  LOOP
    v_lim := d.gatilho;
    SELECT array_agg(extract(hour FROM t)::int * 60 + extract(minute FROM t)::int ORDER BY t) INTO v_pontos
      FROM (SELECT (pt->>'datetime')::timestamp AS t FROM public.ind_ponto_dia dd, jsonb_array_elements(dd.raw->'points') pt
             WHERE dd.company_id = p_company_id AND dd.cpf = d.cpf AND dd.data = d.data) x;
    IF v_pontos IS NULL OR array_length(v_pontos, 1) < 2 THEN CONTINUE; END IF;
    SELECT array_agg(ARRAY[m_de, m_ate] ORDER BY m_de) INTO v_pausas FROM (
      SELECT extract(hour FROM (p.inicio AT TIME ZONE 'America/Sao_Paulo'))::int * 60 + extract(minute FROM (p.inicio AT TIME ZONE 'America/Sao_Paulo'))::int AS m_de,
             extract(hour FROM (COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo'))::int * 60 + extract(minute FROM (COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo'))::int AS m_ate
        FROM public.ind_ponto_pausa p
       WHERE p.company_id = p_company_id AND p.cpf = d.cpf AND p.data = d.data AND COALESCE(p.fim_confirmado, p.fim) IS NOT NULL
         AND COALESCE(p.inicio_origem, '') <> 'sem_saida') y;
    v_trechos := '[]'::jsonb;
    i := 1;
    WHILE i + 1 <= array_length(v_pontos, 1) LOOP
      v_ini := v_pontos[i]; v_fim := v_pontos[i + 1]; v_atual := v_ini;
      IF v_pausas IS NOT NULL THEN
        FOR j IN 1 .. array_length(v_pausas, 1) LOOP
          v_de := v_pausas[j][1]; v_ate := v_pausas[j][2];
          IF v_ate <= v_atual OR v_de >= v_fim THEN CONTINUE; END IF;
          IF v_de > v_atual AND v_de - v_atual > v_lim THEN
            v_trechos := v_trechos || jsonb_build_object('de', to_char(make_time(v_atual / 60, v_atual % 60, 0), 'HH24:MI'),
              'ate', to_char(make_time(v_de / 60, v_de % 60, 0), 'HH24:MI'), 'min', v_de - v_atual);
          END IF;
          v_atual := GREATEST(v_atual, v_ate);
        END LOOP;
      END IF;
      IF v_fim - v_atual > v_lim THEN
        v_trechos := v_trechos || jsonb_build_object('de', to_char(make_time(v_atual / 60, v_atual % 60, 0), 'HH24:MI'),
          'ate', to_char(make_time(v_fim / 60, v_fim % 60, 0), 'HH24:MI'), 'min', v_fim - v_atual);
      END IF;
      i := i + 2;
    END LOOP;
    IF jsonb_array_length(v_trechos) > 0 THEN
      v_out := v_out || jsonb_build_object('data', d.data, 'cpf', d.cpf, 'nome', d.nome, 'funcao', d.funcao, 'setor', d.setor,
        'status_dia', d.status, 'limite_min', v_lim, 'trechos', v_trechos);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'sinais', v_out);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_supervisao_sinais(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_supervisao_sinais(uuid, date, date) TO authenticated, service_role;
