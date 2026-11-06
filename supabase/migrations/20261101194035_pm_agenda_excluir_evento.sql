-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/agenda · chamado/PDCA: RD-98 pilar 4 (exclusão rastreável)
-- exposta na tela + RD-95 "?" na ação + RD-98 pilar 3 (origem do dado) completada.
--
-- Contexto (RD-38, provado no dado): o soft-delete JÁ existe no banco — a função
-- fn_agendamento_excluir(uuid,text) marca excluido_em/excluido_por/excluido_motivo (idempotente, com guarda
-- de empresa e bloqueio quando o evento já virou OS), e a listagem da agenda já filtra excluido_em IS NULL.
-- O que faltava era (a) o "?" (AjudaCampo) da AÇÃO de excluir na tela e (b) registrar fn_agendamento_excluir
-- na origem do dado (system_screens). Esta migration é 100% ADITIVA: só acrescenta um texto de ajuda e
-- completa o array de RPCs da origem. Nenhuma tabela/coluna nova, nenhum dado de cliente alterado, sem RLS.

-- (a) RD-95 · texto de ajuda da ação "Excluir evento" (idempotente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'pm.agenda.evento_excluir', 'Agenda · Evento', 'Excluir evento',
       'Botão para excluir este evento da agenda.',
       'Tira o evento da agenda sem apagar o registro: é uma exclusão rastreável (guarda quem excluiu e quando) e reversível pela auditoria. A listagem deixa de mostrar o evento excluído.',
       'Excluir um evento marcado por engano.',
       'Evento que já virou Ordem de Serviço não pode ser excluído pela agenda — trate pela OS.',
       90, '/dashboard/pm/agenda', 'pm', 'publicado'
ON CONFLICT (chave) DO NOTHING;

-- (b) RD-98 pilar 3 · a tela consome fn_agendamento_excluir (origem do dado). Acrescenta sem duplicar.
UPDATE public.system_screens
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT e ORDER BY e)
         FROM unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_agendamento_excluir']) AS e
       )
 WHERE rota = '/dashboard/pm/agenda'
   AND NOT ('fn_agendamento_excluir' = ANY(coalesce(rpcs_chamadas, ARRAY[]::text[])));
