-- RD-98 p3 · origem do dado (auditor): as duas telas REAIS do processo clínico da Odontologia
--   estavam com views_consumidas = NULL e rpcs_chamadas = NULL em system_screens, enquanto as
--   demais telas da família já têm a origem do dado registrada. Isto completa o registro das
--   rotas /dashboard/odonto/agenda e /dashboard/odonto/tratamento.
--
-- (As rotas /dashboard/odonto, /odonto/convenios, /odonto/materiais são telas estáticas de
--  apresentação/empty-state e /odonto/prontuario é redirect — sem origem de dado própria; por isso
--  NÃO entram aqui.)
--
-- Fontes reais das telas (prova no código, RD-38):
--   /dashboard/odonto/agenda -> src/app/dashboard/odonto/agenda/page.tsx
--     * LEITURA: tabela companies                 (.from("companies"))        — empresa/clínica atual.
--     * AÇÃO:    RPC fn_odonto_agenda_intervalo    — carrega a agenda do intervalo (cadeiras/horários).
--     * AÇÃO:    RPC fn_odonto_agendar             — cria/remarca agendamento.
--     * AÇÃO:    RPC fn_odonto_agendamento_status  — muda o status do agendamento (confirmar/faltou...).
--   /dashboard/odonto/tratamento -> src/app/dashboard/odonto/tratamento/page.tsx
--       (+ componentes src/components/odonto/PainelPlanos.tsx e src/components/odonto/ui.tsx)
--     * LEITURA: tabelas erp_odonto_paciente, erp_odonto_procedimento, erp_odonto_proposta_link, erp_servicos.
--     * AÇÃO:    RPCs fn_odonto_plano_obter, fn_odonto_plano_salvar, fn_odonto_planos_paciente,
--                fn_odonto_planos_clinica, fn_odonto_plano_financeiro, fn_odonto_plano_aprovar_financeiro,
--                fn_odonto_item_concluir, fn_odonto_proposta_criar, fn_odonto_debitos_paciente (SaldoBadge).
--     * AJUDA "?" (AjudaCampo, 4 campos) -> fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--
-- Todas as 14 RPCs e as 5 tabelas acima foram conferidas existentes em produção (pg_proc / pg_tables).
-- Correção corretiva e idempotente: só metadado de registro da tela (origem do dado). NÃO toca RLS,
-- grants, dado de cliente, nem comportamento. Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE
-- determinístico das mesmas linhas existentes).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['companies']::text[],
       rpcs_chamadas    = ARRAY[
                            'fn_odonto_agenda_intervalo',
                            'fn_odonto_agendar',
                            'fn_odonto_agendamento_status'
                          ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/odonto/agenda';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
                            'erp_odonto_paciente',
                            'erp_odonto_procedimento',
                            'erp_odonto_proposta_link',
                            'erp_servicos'
                          ]::text[],
       rpcs_chamadas    = ARRAY[
                            'fn_odonto_plano_obter',
                            'fn_odonto_plano_salvar',
                            'fn_odonto_planos_paciente',
                            'fn_odonto_planos_clinica',
                            'fn_odonto_plano_financeiro',
                            'fn_odonto_plano_aprovar_financeiro',
                            'fn_odonto_item_concluir',
                            'fn_odonto_proposta_criar',
                            'fn_odonto_debitos_paciente',
                            'fn_ajuda_campo_listar',
                            'fn_ajuda_campo_uso'
                          ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/odonto/tratamento';
