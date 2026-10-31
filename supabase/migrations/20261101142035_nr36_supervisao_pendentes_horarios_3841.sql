-- #3841/#4032 (Frioeste · Karol) — na aba Supervisão, o dia "aguardando confirmação" (ex.: colaborador
-- aparece com pausa faltante / sem registro) NÃO mostrava os horários das pausas que ele realmente fez
-- naquele dia; só dava para ver abrindo "Tratar". Agora o fn_nr36_supervisao_pendentes devolve também a
-- lista das pausas registradas no dia (início/fim/min), no MESMO relógio da jornada já retornada
-- (AT TIME ZONE 'UTC'), para o supervisor comparar lado a lado "o que fez" x "a jornada".
--
-- Aditivo: só acrescenta o campo 'pausas' ao JSON; não muda filtro, status nem o que já era retornado.
-- A lista de pendentes é pequena (dias aguardando confirmação no período, por empresa) — subconsulta por
-- linha segue o mesmo padrão da 'jornada' já existente, sem varredura de tabela grande.
CREATE OR REPLACE FUNCTION public.fn_nr36_supervisao_pendentes(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'data', ap.data, 'cpf', ap.cpf, 'nome', c.nome, 'funcao', c.funcao, 'setor', c.departamento,
     'tipo', ap.tipo,
     'motivo', ap.detalhe->>'sem_dado_motivo',                          -- sem_registro_pausa | pausa_sem_confirmacao | pausas_faltantes
     'sem_registro_pausa', (ap.detalhe->>'sem_dado_motivo' = 'sem_registro_pausa'),
     'pausas_devidas', ap.detalhe->'pausas_devidas', 'pausas_realizadas', ap.detalhe->'pausas_realizadas',
     'almoco_min', ap.detalhe->'almoco_min',
     'shift', ap.detalhe->'jornada'->>'shift',
     'jornada', (SELECT jsonb_build_object(
                   'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                   'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'))
                 FROM public.ind_ponto_marcacao mm WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data),
     -- #3841: horários das pausas que o colaborador REALMENTE fez no dia (mesmo relógio da jornada)
     'pausas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'inicio', to_char(pp.inicio AT TIME ZONE 'UTC','HH24:MI'),
                   'fim', CASE WHEN pp.fim IS NOT NULL THEN to_char(pp.fim AT TIME ZONE 'UTC','HH24:MI') ELSE NULL END,
                   'min', CASE WHEN pp.fim IS NOT NULL THEN round(extract(epoch FROM (pp.fim - pp.inicio))/60.0)::int ELSE NULL END
                 ) ORDER BY pp.inicio), '[]'::jsonb)
                FROM public.ind_ponto_pausa pp
                WHERE pp.company_id=ap.company_id AND pp.cpf=ap.cpf AND pp.data=ap.data)
   ) ORDER BY ap.data DESC, c.nome), '[]'::jsonb) INTO v
  FROM public.nr36_pausa_apurada ap
  JOIN public.ind_ponto_colaborador c ON c.id=ap.colaborador_id
  WHERE ap.company_id=p_company_id AND ap.status='pendente_confirmacao' AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok',true,'pendentes',v);
END $function$;

-- Régua check_fn_guards (Regra 1): REVOKE anon na função SECURITY DEFINER (read-only, STABLE).
-- Espelha a ACL viva em produção ({authenticated, service_role}; anon/PUBLIC sem EXECUTE). Sem mudança de runtime.
REVOKE ALL ON FUNCTION public.fn_nr36_supervisao_pendentes(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_supervisao_pendentes(uuid, date, date) TO authenticated, service_role;
