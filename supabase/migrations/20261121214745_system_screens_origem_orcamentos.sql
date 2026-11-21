-- RD-98 p3 (origem do dado) — preenche system_screens de /dashboard/orcamentos (antes NULL).
-- Code: desenvolvedor_4_g.
--
-- MÉTODO (RD-38): grep de .from/.rpc na página (1484 l), confirmado em pg_class/pg_proc.
-- A referência .from("crm") é MORTA (não existe tabela 'crm' em pg_class) — excluída do registro;
-- registro só as 11 relações e 11 funções que existem de verdade.
--
-- Aditiva/idempotente: só preenche se estiver NULL. Só metadados de catálogo global (system_screens),
-- não dado de cliente, não RLS/permissão.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_orcamentos','erp_orcamentos_itens','erp_orcamento_historico','erp_clientes','erp_produtos',
         'erp_centros_custo','erp_crm_oportunidade','erp_crm_visita','orcamento_config_empresa',
         'projetos_modulo_config','v_projetos_bdi_impacto'
       ]::text[],
       rpcs_chamadas = ARRAY[
         'next_orcamento_numero','fn_orcamento_salvar_itens','fn_orcamento_custos_revisar','fn_orcamento_pode_editar',
         'fn_orcamento_liberar_edicao','fn_orcamento_excluir','fn_orcamento_anexar_pdf','converter_orcamento_pedido',
         'fn_crm_mover_etapa','fn_acessos_pode_gerir','fn_usuarios_da_empresa'
       ]::text[]
 WHERE rota = '/dashboard/orcamentos'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;
