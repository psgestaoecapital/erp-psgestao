-- Oficina · RD-98 pilar 3 (ORIGEM do dado): completa system_screens.views_consumidas das 3 telas que o
-- auditor PDCA apontou com a origem incompleta — Agenda, Diagnóstico e Recepção. Code: desenvolvedor_4_g.
--
-- rpcs_chamadas dessas telas já estava preenchido; o que faltava (e bloqueia o selo) é a lista de TABELAS
-- que a origem do dado realmente usa. Esta migration só DOCUMENTA metadados — nenhum comportamento muda,
-- nenhuma função é recriada.
--
-- RD-38 (provado na definição VIVA das RPCs, pg_get_functiondef, + leituras diretas do .tsx):
--   Agenda      → fn_agenda_listar/agendamento_* usam erp_agendamento; a página lê erp_clientes, erp_os,
--                 erp_os_mecanico.
--   Diagnóstico → fn_oficina_diagnostico_*/registro_*/os_fila/cotação usam erp_os, erp_os_diagnostico_item,
--                 erp_os_apontamento, erp_os_registro_foto, erp_cotacoes(_itens/_fornecedores),
--                 erp_os_link_publico, v_erp_produtos_estoque; a página lê erp_fornecedores, erp_oficina_servicos.
--   Recepção    → fn_oficina_recepcao_criar/buscar_*/orcamento_*/mecanicos/cliente_* e designar usam
--                 erp_agendamento, erp_os, erp_os_recepcao, erp_os_registro_foto, erp_os_mecanico,
--                 erp_clientes, erp_fornecedores, erp_orcamentos.
--
-- Aditiva/idempotente: apenas UPDATE de 3 linhas de metadados (system_screens). Sem DDL, sem dado de
-- cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o auditor, não esta migration.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_agendamento','erp_clientes','erp_os','erp_os_mecanico']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/agenda';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_os','erp_os_diagnostico_item','erp_os_apontamento','erp_os_registro_foto',
                                'erp_oficina_servicos','erp_fornecedores','erp_cotacoes','erp_cotacoes_itens',
                                'erp_cotacoes_fornecedores','erp_os_link_publico','v_erp_produtos_estoque']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/diagnostico';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_agendamento','erp_os','erp_os_recepcao','erp_os_registro_foto',
                                'erp_os_mecanico','erp_clientes','erp_fornecedores','erp_orcamentos']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/recepcao';
