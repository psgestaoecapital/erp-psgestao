-- Chamado #76 (Frioeste · CEO 03/10) · "precisa estar especificado o porquê do desvio indicando a régua estabelecida de
-- mínimo e máximo". Régua dela: pausa de 20 min, normal até 23, excesso a partir de 24 (tolerancia_excesso_min = 24).
--
-- Causa (provada no dado, ago–set/2026): a classificação compara em SEGUNDOS, mas a tela mostra minutos arredondados —
-- 38 pausas insuficientes apareciam como "20 min — o mínimo é 20 min" e 25 normais como "24 min".
--
-- O que muda:
--  1) fn_nr36_pausas_regua(empresa, de, até): só leitura — a régua do tenant e, para cada pausa curta ou longa, a duração
--     em segundos (o número que decide). A Supervisão e o relatório de Auditoria escrevem o motivo com ele
--     ("abaixo do mínimo: 19:57 < 20:00" / "acima do máximo: 24:10 ≥ 24:00").
--  2) Limite inferior como parâmetro próprio (limite_inferior_min). O LIMITE DE BAIXO a empresa ainda não definiu: vazio,
--     vale a própria pausa (abaixo de 20:00 é desvio, sem tolerância) — EXATAMENTE como hoje. Quando a empresa definir,
--     a classificação (fn_nr36_classificar_eventos) e a apuração (fn_nr36_apurar) passam a usá-lo, as duas juntas.
-- Não reapura nada e não altera pausa: com o parâmetro vazio o resultado é idêntico.

-- ── 1) régua + duração em segundos das pausas curtas/longas ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_pausas_regua(p_company_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_par jsonb;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 93 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido', 'mensagem', 'Escolha um período de até 3 meses.');
  END IF;
  SELECT parametros INTO v_par FROM public.nr36_pausa_regra WHERE company_id = p_company_id AND tipo = 'termica_253' AND ativo LIMIT 1;
  RETURN jsonb_build_object('ok', true,
    'regua', jsonb_build_object(
      'pausa_min', COALESCE((v_par->>'pausa_min')::numeric, 20),
      'tolerancia_excesso_min', COALESCE((v_par->>'tolerancia_excesso_min')::numeric, 23),
      'limite_esquecimento_min', COALESCE((v_par->>'limite_esquecimento_min')::numeric, 45),
      'limite_inferior_min', (v_par->>'limite_inferior_min')::numeric),
    'pausas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'cpf', p.cpf, 'data', p.data,
               'de', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
               'ate', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
               'seg', round(public.fn_nr36_duracao_seg(p.inicio, p.fim, p.fim_confirmado, p.duracao_seg)),
               'classe', p.classe_evento) ORDER BY p.data, p.cpf, p.inicio)
        FROM public.ind_ponto_pausa p
       WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim
         AND p.classe_evento IN ('pausa_insuficiente', 'pausa_excesso')), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_pausas_regua(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pausas_regua(uuid, date, date) TO authenticated, service_role;

-- ── 2) limite inferior na classificação (vazio = a própria pausa, como hoje) ────────────────────────────────────────
DO $$
DECLARE v_def text; v_ancora text := 'v_pmin := COALESCE((v_par->>''pausa_min'')::numeric, 20);';
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_classificar_eventos(uuid)'::regprocedure);
  IF v_def !~ '#76 limite inferior' THEN
    IF position(v_ancora IN v_def) = 0 THEN RAISE EXCEPTION '#76: âncora não encontrada em fn_nr36_classificar_eventos'; END IF;
    v_def := replace(v_def, v_ancora, v_ancora || chr(10) ||
      '  v_pmin := COALESCE((v_par->>''limite_inferior_min'')::numeric, v_pmin);  -- #76 limite inferior (vazio = a pausa)');
    EXECUTE v_def;
  END IF;
END $$;

-- ── 2b) o mesmo limite na apuração (contagem de pausa curta), para as duas leituras não divergirem ─────────────────
DO $$
DECLARE v_def text; v_n int;
  a_decl text := 'v_gatilho int; v_pausa_min int;';
  a_set  text := 'v_pausa_min := COALESCE((v_param->>''pausa_min'')::int,20);';
  a_ge   text := '/60 >= v_pausa_min)';
  a_lt   text := '/60 < v_pausa_min)';
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure);
  IF v_def !~ '#76 limite inferior' THEN
    IF position(a_decl IN v_def) = 0 OR position(a_set IN v_def) = 0
       OR (length(v_def) - length(replace(v_def, a_ge, ''))) / length(a_ge) <> 1
       OR (length(v_def) - length(replace(v_def, a_lt, ''))) / length(a_lt) <> 1 THEN
      RAISE EXCEPTION '#76: âncoras da apuração não batem (esperava 1 contagem >= e 1 < sobre v_pausa_min)';
    END IF;
    v_def := replace(v_def, a_decl, 'v_gatilho int; v_pausa_min int; v_lim_inf numeric;');
    v_def := replace(v_def, a_set, a_set || chr(10) ||
      '    v_lim_inf := COALESCE((v_param->>''limite_inferior_min'')::numeric, v_pausa_min);  -- #76 limite inferior (vazio = a pausa)');
    v_def := replace(v_def, a_ge, '/60 >= v_lim_inf)');
    v_def := replace(v_def, a_lt, '/60 < v_lim_inf)');
    EXECUTE v_def;
  END IF;
  IF pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure) !~ '#76 limite inferior'
     OR pg_get_functiondef('public.fn_nr36_classificar_eventos(uuid)'::regprocedure) !~ '#76 limite inferior' THEN
    RAISE EXCEPTION '#76: limite inferior não ficou nas duas leituras';
  END IF;
END $$;
