-- Agenda Odonto · Onda 1: RPC de INTERVALO (visão Semana). Espelha
-- fn_odonto_agenda_dia mas devolve agendamentos de [p_data_ini, p_data_fim] com a
-- coluna `data` (p/ agrupar por dia). Reuso das mesmas tabelas/estrutura (RD-26);
-- guard por get_user_company_ids (Pilar 2). Cancelados ficam de fora por padrão
-- (a tela tem o toggle "ocultar canceladas" — aqui já não vêm).
CREATE OR REPLACE FUNCTION public.fn_odonto_agenda_intervalo(
  p_company_id uuid, p_data_ini date, p_data_fim date
) RETURNS json
LANGUAGE plpgsql STABLE AS $function$
DECLARE result json;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  SELECT json_build_object(
    'cadeiras', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'ordem',ordem,'cor',cor) ORDER BY ordem,nome)
                          FROM erp_odonto_cadeira WHERE company_id=p_company_id AND ativo), '[]'::json),
    'profissionais', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'cor',cor,'cro',cro) ORDER BY nome)
                          FROM erp_odonto_profissional WHERE company_id=p_company_id AND ativo), '[]'::json),
    'procedimentos', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'cor',cor,'duracao_min',duracao_min) ORDER BY nome)
                          FROM erp_odonto_procedimento WHERE company_id=p_company_id AND ativo), '[]'::json),
    'agendamentos', COALESCE((SELECT json_agg(json_build_object(
          'id',a.id,'cadeira_id',a.cadeira_id,'data',to_char(a.data,'YYYY-MM-DD'),
          'profissional_id',a.profissional_id,'profissional_nome',pr.nome,
          'procedimento_id',a.procedimento_id,'procedimento_nome',pc.nome,'procedimento_cor',pc.cor,
          'paciente_id',a.paciente_id,'paciente_nome',a.paciente_nome,
          'hora_inicio',to_char(a.hora_inicio,'HH24:MI'),'hora_fim',to_char(a.hora_fim,'HH24:MI'),'status',a.status))
        FROM erp_odonto_agendamento a
        LEFT JOIN erp_odonto_profissional pr ON pr.id=a.profissional_id
        LEFT JOIN erp_odonto_procedimento  pc ON pc.id=a.procedimento_id
        WHERE a.company_id=p_company_id AND a.data BETWEEN p_data_ini AND p_data_fim
          AND a.status <> 'cancelado'), '[]'::json)
  ) INTO result;
  RETURN result;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_agenda_intervalo(uuid, date, date) TO authenticated;
