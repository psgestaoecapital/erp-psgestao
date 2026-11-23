-- RD-98 p3 (origem do dado): registra as fontes de /dashboard/orcamentos, que estava
-- system_screens.estado_real='desconhecida' com views_consumidas/rpcs_chamadas NULOS.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Tela AUTOCONTIDA (todo acesso a dados no proprio page.tsx, via supabaseBrowser; sem fetch a
-- /api e sem hooks de dados) — provado no codigo (RD-38). Objetos conferidos em pg_class/pg_proc.
--   views (11): erp_orcamentos, erp_orcamentos_itens, erp_orcamento_historico, erp_clientes,
--               erp_produtos, erp_centros_custo, erp_crm_oportunidade, erp_crm_visita,
--               orcamento_config_empresa, projetos_modulo_config, v_projetos_bdi_impacto
--   rpcs (13):  converter_orcamento_pedido, next_orcamento_numero, fn_orcamento_salvar_itens,
--               fn_orcamento_excluir, fn_orcamento_pode_editar, fn_orcamento_liberar_edicao,
--               fn_orcamento_anexar_pdf, fn_orcamento_custos_revisar, fn_crm_mover_etapa,
--               fn_acessos_pode_gerir, fn_usuarios_da_empresa,
--               fn_ajuda_campo_listar, fn_ajuda_campo_uso (componente AjudaCampo, 16 usos)
-- (O "crm" do codigo e o BUCKET de storage "crm-anexos" — nao e tabela, por isso NAO entra.)
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): preenche sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao
-- altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY[
           'erp_orcamentos','erp_orcamentos_itens','erp_orcamento_historico','erp_clientes',
           'erp_produtos','erp_centros_custo','erp_crm_oportunidade','erp_crm_visita',
           'orcamento_config_empresa','projetos_modulo_config','v_projetos_bdi_impacto']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY[
           'converter_orcamento_pedido','next_orcamento_numero','fn_orcamento_salvar_itens',
           'fn_orcamento_excluir','fn_orcamento_pode_editar','fn_orcamento_liberar_edicao',
           'fn_orcamento_anexar_pdf','fn_orcamento_custos_revisar','fn_crm_mover_etapa',
           'fn_acessos_pode_gerir','fn_usuarios_da_empresa',
           'fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/orcamentos'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY[
           'erp_orcamentos','erp_orcamentos_itens','erp_orcamento_historico','erp_clientes',
           'erp_produtos','erp_centros_custo','erp_crm_oportunidade','erp_crm_visita',
           'orcamento_config_empresa','projetos_modulo_config','v_projetos_bdi_impacto']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY[
           'converter_orcamento_pedido','next_orcamento_numero','fn_orcamento_salvar_itens',
           'fn_orcamento_excluir','fn_orcamento_pode_editar','fn_orcamento_liberar_edicao',
           'fn_orcamento_anexar_pdf','fn_orcamento_custos_revisar','fn_crm_mover_etapa',
           'fn_acessos_pode_gerir','fn_usuarios_da_empresa',
           'fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/orcamentos'
   AND estado_real = 'desconhecida';
