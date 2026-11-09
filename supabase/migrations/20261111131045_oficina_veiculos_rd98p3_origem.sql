-- Oficina · RD-98 pilar 3 (ORIGEM do dado) para a tela de Veículos por placa
-- (/dashboard/oficina/veiculos). Code: desenvolvedor_4_g.
--
-- O auditor PDCA apontou (09/11) que esta tela estava com system_screens.views_consumidas VAZIO
-- enquanto rpcs_chamadas já trazia as 6 funções. Esta migration só DOCUMENTA a origem real do dado,
-- lida do código-fonte da própria página e das funções que ela chama — nenhum comportamento muda,
-- nenhuma função é recriada.
--
-- RD-38 (provado no dado — definição VIVA das RPCs lidas por pg_get_functiondef):
--   fn_oficina_veiculos_listar   → erp_os
--   fn_oficina_veiculo_historico → erp_os, erp_os_diagnostico_item, erp_os_aprovacao
--   fn_oficina_veiculo_contatos  → erp_oficina_contato
--   fn_veiculo_link_publico_gerar→ erp_os, erp_veiculo_link_publico
-- O veículo NÃO tem cadastro próprio: cada linha é consolidada por placa a partir da OS. Por isso a
-- tela é de CONSULTA (RD-98 p2) — placa/marca/modelo/cliente/KM nascem e são editados na OS/recepção.
--
-- Aditiva/idempotente: apenas UPDATE de uma linha de metadados (system_screens). Sem DDL, sem dado de
-- cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o auditor, não esta migration.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_os','erp_os_diagnostico_item','erp_os_aprovacao',
                                'erp_oficina_contato','erp_veiculo_link_publico']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/veiculos';
