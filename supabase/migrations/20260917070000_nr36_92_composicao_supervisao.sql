-- #92 (Frioeste · pausas térmicas) — o painel resumia o mês do colaborador num único rótulo
-- ("conforme") escondendo dias em aberto. Ex.: Breno tinha 18 conforme · 1 desvio · 13
-- aguardando confirmação e, numa janela sem o dia de desvio, aparecia como CONFORME.
-- Causa: o roll-up de status usava "WHEN conforme>0 THEN 'conforme'" (qualquer dia conforme
-- pintava o colaborador de verde) e NÃO contava os dias 'pendente_confirmacao'.
--
-- Correção (RD-51/RD-38): (1) contar também os dias 'pendente_confirmacao'; (2) rótulo pelo
-- PIOR status — pendência nunca vira desvio (não sabemos o fim, não supomos), mas também nunca
-- conta como conforme; só é 'conforme' quando TODOS os dias são conformes.
--
-- E a Supervisão só listava desvio provado — os 166 dias 'aguardando confirmação' sumiam de lá,
-- invisíveis ao supervisor de turno (que é quem consegue perguntar ao colaborador). Nova função
-- fn_nr36_supervisao_pendentes expõe esses dias, SEPARADOS dos desvios e rotulados como tais.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (1) Painel: composição + roll-up pelo pior status
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_apuracao_listar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_tem boolean; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT EXISTS (SELECT 1 FROM public.ind_ponto_pausa WHERE company_id=p_company_id) INTO v_tem;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'colaborador_id',a.colaborador_id,'cpf',a.cpf,'nome',c.nome,'funcao',c.funcao,'tipo',a.tipo,
      'dias',a.dias,'devido_min',a.devido_tot,'realizado_min',a.realizado_tot,
      'dias_desvio',a.desvio,'dias_conforme',a.conforme,'dias_aguardando',a.aguardando,
      'dias_pendente',a.pendente,'dias_sem_dado',a.sem_dado,
      -- Roll-up pelo PIOR status (RD-51/RD-38). Severidade: desvio > pendente_confirmacao >
      -- sem_dado > aguardando_realizado > conforme. 'conforme' só quando TODOS os dias são
      -- conformes; qualquer dia em aberto tira o verde. Pendência NUNCA vira desvio.
      'status', CASE WHEN a.desvio>0        THEN 'desvio'
                     WHEN a.pendente>0      THEN 'pendente_confirmacao'
                     WHEN a.sem_dado>0      THEN 'sem_dado'
                     WHEN a.aguardando>0    THEN 'aguardando_realizado'
                     WHEN a.conforme=a.dias THEN 'conforme'
                     ELSE 'sem_dado' END
    ) ORDER BY c.nome, a.tipo), '[]'::jsonb) INTO v FROM (
    SELECT ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo, count(*) AS dias,
           sum(ap.devido_min) AS devido_tot, sum(ap.realizado_min) AS realizado_tot,
           count(*) FILTER (WHERE ap.status='desvio')                AS desvio,
           count(*) FILTER (WHERE ap.status='conforme')              AS conforme,
           count(*) FILTER (WHERE ap.status='aguardando_realizado')  AS aguardando,
           count(*) FILTER (WHERE ap.status='pendente_confirmacao')  AS pendente,
           count(*) FILTER (WHERE ap.status='sem_dado')              AS sem_dado
    FROM public.nr36_pausa_apurada ap
    WHERE ap.company_id=p_company_id AND ap.data BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo
  ) a JOIN public.ind_ponto_colaborador c ON c.id=a.colaborador_id;
  RETURN jsonb_build_object('ok', true, 'tem_realizado', v_tem, 'resumo', v);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (2) Supervisão: dias aguardando confirmação (separados dos desvios provados)
--     Mesmo motor, terceira saída para o supervisor de turno. Descreve o FATO (dia em aberto),
--     não julga — e NÃO transforma pendência em desvio (RD-38: não sabemos o fim, não supomos).
-- ─────────────────────────────────────────────────────────────────────────────────────────
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
     'shift', ap.detalhe->'jornada'->>'shift',
     'jornada', (SELECT jsonb_build_object(
                   'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                   'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'))
                 FROM public.ind_ponto_marcacao mm WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data)
   ) ORDER BY ap.data DESC, c.nome), '[]'::jsonb) INTO v
  FROM public.nr36_pausa_apurada ap
  JOIN public.ind_ponto_colaborador c ON c.id=ap.colaborador_id
  WHERE ap.company_id=p_company_id AND ap.status='pendente_confirmacao' AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok',true,'pendentes',v);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_nr36_supervisao_pendentes(uuid, date, date) TO authenticated;
