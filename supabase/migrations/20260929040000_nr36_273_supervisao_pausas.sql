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
