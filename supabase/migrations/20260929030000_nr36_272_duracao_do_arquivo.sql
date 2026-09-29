-- Frioeste #272 (SST · 28/09) · "existem pausas com tempo menor de 20 min que não aparecem como desvio no Painel nem na
-- Supervisão — ex.: Anderson, 16/09, pausa de 19:25".
--
-- Causa (provada no dado, 29/09): o relatório traz a duração com SEGUNDOS (duracao_seg = 1165 = 19:25), mas guarda os
-- horários só com minutos (07:42 → 08:02). A classificação (fn_nr36_classificar_eventos) usa a duração do arquivo e marca
-- a pausa como insuficiente; a apuração (fn_nr36_apurar) recalculava a duração pelos horários — 07:42→08:02 = 20 min
-- exatos — e o dia saía "conforme". Na Frioeste são 42 pausas em 40 dias-colaborador (03/08–25/09); 22 desses dias
-- (8 pessoas) estão hoje como "conforme".
--
-- Correção: a apuração usa a mesma duração da classificação — fn_nr36_duracao_seg:
--   fim confirmado na Conferência → fim_confirmado − início (a hora digitada/confirmada manda);
--   fim do relatório              → duracao_seg do arquivo (com segundos); sem ela, fim − início.
-- NÃO reapura nada: os dias já apurados só mudam quando alguém reapurar (decisão do CEO — mostra antes/depois).

CREATE OR REPLACE FUNCTION public.fn_nr36_duracao_seg(p_inicio timestamptz, p_fim timestamptz, p_fim_confirmado timestamptz, p_duracao_seg integer)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_fim_confirmado IS NOT NULL THEN EXTRACT(EPOCH FROM (p_fim_confirmado - p_inicio))
    WHEN p_fim IS NOT NULL THEN COALESCE(p_duracao_seg::numeric, EXTRACT(EPOCH FROM (p_fim - p_inicio)))
  END
$function$;
COMMENT ON FUNCTION public.fn_nr36_duracao_seg(timestamptz, timestamptz, timestamptz, integer) IS
  '#272: duração da pausa em segundos — a mesma da classificação (arquivo com segundos; fim confirmado manda)';

DO $$
DECLARE v_def text; v_n int;
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure);
  IF v_def !~ 'fn_nr36_duracao_seg' THEN
    v_n := (length(v_def) - length(replace(v_def, 'EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))', '')))
           / length('EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))');
    IF v_n <> 6 THEN RAISE EXCEPTION '#272: esperava 6 cálculos de duração em fn_nr36_apurar, achei %', v_n; END IF;
    v_def := replace(v_def, 'EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))',
                            'public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 */');
    EXECUTE v_def;
  END IF;
END $$;

-- guarda final
DO $$
BEGIN
  IF pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure) ~ 'EXTRACT\(EPOCH FROM \(COALESCE\(fim_confirmado,fim\) - inicio\)\)'
     OR pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure) !~ 'fn_nr36_duracao_seg' THEN
    RAISE EXCEPTION '#272: fn_nr36_apurar ainda calcula a duração pelos horários';
  END IF;
END $$;
