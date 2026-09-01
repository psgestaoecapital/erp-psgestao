-- Oficina · Bloco C — o carro agendado ONTEM e ainda não chegado some da lista de "a chegar".
-- Achado (RD-44): o PÁTIO em si (kanban de OS ativas na tela) já está certo — mostra todo carro
-- com recepção feita e sem entrega, independente de data (inclui quem dormiu). Auditado na KGF:
-- 10 OS ativas, todas 10 com recepção, 0 fantasma. A fonte do pátio é a OS (que a recepção cria).
--
-- O bug real está na lista de AGENDADOS: fn_agenda_patio_hoje filtra data = CURRENT_DATE, então um
-- agendamento de ontem que ainda não virou recepção/OS (os_id IS NULL) desaparece — e a recepcionista
-- não acha o carro pra "apontar chegada". Correção: mostrar os PENDENTES de hoje E os ATRASADOS
-- (data <= hoje), ainda não chegados. Assim o agendado-ontem aparece; ao dar entrada (recepção→OS)
-- ele sai daqui (os_id deixa de ser NULL) e passa a viver no pátio como OS. Nada de status ou os_id muda.

CREATE OR REPLACE FUNCTION public.fn_agenda_patio_hoje(p_company_ids uuid[])
 RETURNS SETOF erp_agendamento
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT * FROM public.erp_agendamento
   WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
     AND data <= CURRENT_DATE                       -- [Bloco C] hoje E atrasados (não só hoje)
     AND status IN ('agendado','confirmado')
     AND os_id IS NULL                              -- ainda não chegou (virou OS = sai daqui, vai pro pátio)
   ORDER BY data, hora_inicio NULLS LAST;           -- atrasados primeiro (data mais antiga no topo)
$function$;
