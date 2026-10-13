-- 🚨 SEGURANÇA · PR A2 (CEO 28/09) — funções que QUALQUER cliente logado podia chamar pela API.
--
-- Depois da PR A (anon: 1.032 → 22), o furo restante: o papel authenticated (todo cliente logado) executava ~1.490
-- funções, inclusive SECURITY DEFINER sem guarda que rodam como dono: fn_backup_executar, fn_demo_reset (apaga via SQL
-- dinâmico), fn_vault_ler_secret (lê QUALQUER segredo do Vault), fn_pluggy_get_credentials, fn_mudanca_deployar,
-- fn_rateio_calcular_mes, fn_sync_empresa, fn_provisionar_user_scope, fn_import_cadastro_v1...
--
-- Levantamento (read-only, agente + conferência): cada função cruzada com o código (literal em src/, supabase/functions,
-- e2e, scripts — superset que cobre chamadas dinâmicas), com a chave usada (serviço × JWT do usuário), com policies,
-- views, defaults/CHECKs/índices, gatilhos INVOKER e o fecho transitivo das INVOKER chamadas pelo app.
--  (1) 533 funções NUNCA chamadas pelo app como usuário (só cron/pg_cron, gatilho, outras DEFINER, rotas e edge
--      functions com service_role, MCP/dono) → sai o EXECUTE de authenticated (e de PUBLIC/anon, por garantia).
--      service_role e o dono seguem executando. Conferido: as edge functions que repassam o JWT chamam essas funções
--      pelo cliente de serviço (sbAdmin).
--  (2) funções das telas internas PS que o app chama: guarda "equipe PS" (is_admin() ou users.system_role preenchido —
--      PS_ADMIN/PS_ADMIN_CVM/PS_SUPPORT); sem usuário (serviço/cron) passa, como em fn_rd_registrar.
--  (3) fn_lgpd_registrar_consentimento: só grava consentimento do PRÓPRIO usuário; fn_budget_registrar_gasto: valor
--      tem de ser um custo plausível (0–10 USD por chamada) — antes qualquer logado zerava/estourava o orçamento de IA.
-- As ~55 funções de tela que escrevem sem checar a empresa ganham guarda por empresa na PR A2b (uma a uma, com a tela).
-- Sem LOCK TABLE (db push roda fora de bloco de transação).

-- (1) REVOKE de authenticated nas funções que o app não chama
DO $$
DECLARE f record; n int := 0;
  nomes text[] := ARRAY[
    '_fn_odonto_alertas_gerar_impl', '_fn_odonto_cliente_do_paciente_impl', '_fn_parse_numero_inteligente', 'aplicar_reajuste_contrato', 'buscar_matches_extrato', 'fn__remessa_pode',
    'fn_admin_executar_truth_auditor', 'fn_admin_get_plano_detalhe', 'fn_admin_housekeeping_diario', 'fn_admin_insight_get', 'fn_admin_insights_criticos', 'fn_admin_insights_dashboard',
    'fn_admin_listar_usuarios', 'fn_admin_reenviar_acesso', 'fn_agency_assert', 'fn_agency_cliente_resolver', 'fn_agency_config_defaults', 'fn_agency_contrato_criar',
    'fn_agency_item_janela', 'fn_agency_lead_proposta', 'fn_agente_heartbeat', 'fn_agro_custo_resultado', 'fn_agro_pasto', 'fn_agro_rebanho',
    'fn_ajuda_tsquery_ampliado', 'fn_ajustar_budget_anthropic', 'fn_app_base_url', 'fn_arquivar_memoria_antiga', 'fn_atak_agente_config', 'fn_atak_alerta_silencio',
    'fn_atak_heartbeat', 'fn_atak_mapa_coletor', 'fn_atak_secret_set', 'fn_atak_status', 'fn_atak_teste_responder', 'fn_atak_watermark',
    'fn_auditar_menu_intrusos', 'fn_auditar_rota_vs_concorrente', 'fn_auditar_todas_rotas_vs_concorrente', 'fn_auditor_consultar', 'fn_auditor_disparar', 'fn_auditor_matriz_briefing',
    'fn_auditor_matriz_consultar', 'fn_auditor_matriz_disparar', 'fn_auditor_telas_orfas_menu', 'fn_auditoria_grupo_stel', 'fn_backup_executar', 'fn_backup_snapshot_limpar_antigos',
    'fn_backup_snapshot_semanal', 'fn_balanco_salvar_manual', 'fn_banco_homologado', 'fn_banco_saldo_registrar', 'fn_banco_teste_conexao_registrar', 'fn_bem_criar_do_pagar',
    'fn_bi_comercial_scope', 'fn_boleto_liquidar', 'fn_bpo_alerta_upsert', 'fn_bpo_arquivar_backlog_orfao', 'fn_bpo_atribuir_empresa', 'fn_bpo_criar_tarefa_manual',
    'fn_bpo_desarquivar_backlog', 'fn_bpo_escalar_item', 'fn_bpo_fechamento_gerar_dados', 'fn_bpo_fechamento_validar', 'fn_bpo_gerar_pauta_dia', 'fn_bpo_inbox_operadora',
    'fn_bpo_mensagem_cliente_responder', 'fn_bpo_meu_dia', 'fn_bpo_supervisao_painel', 'fn_bpo_supervisor_ativar_backup', 'fn_bpo_supervisor_executar_rebalanceamento', 'fn_bpo_supervisor_itens_operador',
    'fn_bpo_supervisor_reatribuir_item', 'fn_bpo_supervisor_sugerir_rebalanceamento', 'fn_budget_modo_economico', 'fn_budget_modo_equilibrado', 'fn_budget_modo_intenso', 'fn_budget_pausa_total',
    'fn_buscar_provider_config_ativa', 'fn_cadastro_doc_valido', 'fn_cadastro_importar_gravar_um', 'fn_cadastro_norm_nome', 'fn_camada1_consultar_enumeracao', 'fn_camada3_capturar_falhas_cron',
    'fn_camada3_capturar_falhas_playwright', 'fn_camada3_capturar_rejeicoes_insight', 'fn_cancelar_nfe', 'fn_certificado_senha_migrar_vault', 'fn_cfop_entrada', 'fn_cfop_natureza',
    'fn_chamados_envelhecidos_sem_pr', 'fn_classificar_categoria_siga', 'fn_classificar_categoria_siga_tipo', 'fn_compliance_acidente_registrar', 'fn_compliance_assert', 'fn_compliance_calcular_prioridade',
    'fn_compliance_enfileirar_consulta', 'fn_compliance_recalcular_diario', 'fn_conciliacao_orfaos', 'fn_consolidar_alertas_auditores', 'fn_consultor_insights', 'fn_consultor_insights_grupo',
    'fn_conta_contabil_importar', 'fn_conta_contabil_inativar_vinculo', 'fn_conta_contabil_listar', 'fn_conta_contabil_vinculo_ativo', 'fn_conta_contabil_vinculos_listar', 'fn_contador_fechar_periodo',
    'fn_contador_resumo_competencia', 'fn_contexto_resumo', 'fn_contrato_gerar_pagar', 'fn_contrato_gerar_parcelas', 'fn_credencial_ler', 'fn_credencial_nome',
    'fn_criar_snapshot', 'fn_crm_converter_lead', 'fn_crm_oportunidade_editar', 'fn_crm_semaforo', 'fn_dashboard_home', 'fn_dashboard_home_periodo',
    'fn_debug_count_bom', 'fn_demo_cnpj_valido', 'fn_demo_cpf_valido', 'fn_demo_da_area', 'fn_demo_reset', 'fn_demo_seed_conciliacao',
    'fn_demo_seed_ge_bancos', 'fn_demo_seed_ge_comercial', 'fn_demo_seed_ge_dre', 'fn_demo_seed_ge_financeiro', 'fn_demo_seed_ge_fiscal', 'fn_demo_seed_revenda_garantia',
    'fn_demo_seed_revenda_leads', 'fn_demo_seed_revenda_r05', 'fn_derivar_municipio_ibge', 'fn_detectar_divergencias_gente', 'fn_detectar_drift', 'fn_detectar_espelho_nf_e_hooked',
    'fn_dfe_baixar_xml_pendentes_dispatch', 'fn_dfe_distribuicao_auto_dispatch', 'fn_disparar_insight_auditor', 'fn_disparar_insight_auditor_prioridade', 'fn_disparar_playwright_batch', 'fn_disparar_sugestao_analise',
    'fn_divergencia_aplicar', 'fn_divergencia_registrar', 'fn_documentos_vigentes_md5', 'fn_email_reconciliar', 'fn_email_render', 'fn_emitir_carta_correcao',
    'fn_empresa_fora_regra_ps', 'fn_empresa_tem_hub_obras', 'fn_enviar_email', 'fn_epi_calcular_proxima_troca', 'fn_epi_gerar_alertas', 'fn_epi_slug_por_nome',
    'fn_estoque_cfop_entra', 'fn_estoque_local_principal', 'fn_estrela_polar_gravar', 'fn_estrela_polar_vigente', 'fn_etl_omie_empresa', 'fn_extrato_importar_sistema',
    'fn_faturar_efetivar', 'fn_financiamento_gerar_cronograma_empresa', 'fn_financiamento_recalcular_empresa', 'fn_fiscal_diag_token', 'fn_fiscal_exige_obra', 'fn_fiscal_iss_resolver',
    'fn_fiscal_marcar_xml_armazenado', 'fn_fiscal_percentual_sn_definir', 'fn_fiscal_percentual_sn_listar', 'fn_fiscal_percentual_sn_status', 'fn_fiscal_percentual_sn_vigente', 'fn_fiscal_storage_briefing',
    'fn_fiscal_storage_marcar_processado', 'fn_fiscal_tentativas', 'fn_fluxo_caixa_mensal', 'fn_fluxo_caixa_projecao', 'fn_fluxo_trabalho_oficial', 'fn_frota_criar',
    'fn_garantir_ln_default', 'fn_ge_briefing_roadmap', 'fn_ge_calendario_fiscal', 'fn_ge_conciliacao_sugerir_matches', 'fn_ge_contas_resumo', 'fn_ge_dre_plana',
    'fn_ge_fechar_pr', 'fn_ge_inadimplentes_agrupado', 'fn_ge_listagem', 'fn_ge_nfse_listar', 'fn_ge_painel_contador', 'fn_ge_reforma_simulador',
    'fn_ge_status_atual', 'fn_gerar_manual_vivo_diario', 'fn_get_conectores_disponiveis', 'fn_get_tenant_modules_active', 'fn_get_tenant_plan_summary', 'fn_get_user_companies',
    'fn_gold_auto_pos_merge', 'fn_gold_consolidar_404', 'fn_gold_consolidar_veredito_triplo', 'fn_gold_cron_varredura_piloto', 'fn_gold_disparar_jornada_completa', 'fn_gold_g1_veredito_agregado_rota',
    'fn_gold_ge_seed_reparar', 'fn_gold_oficina_seed_reparar', 'fn_gold_relatorio_diario', 'fn_gold_revenda_seed_fiscal', 'fn_gold_revenda_seed_negociacoes', 'fn_gold_revenda_seed_precificacao',
    'fn_gov_nfse_atualizar_dps', 'fn_gov_nfse_proximo_numero', 'fn_gov_nfse_registrar_dps', 'fn_hhmm_decimal', 'fn_ia_falha_registrar', 'fn_ia_falha_resolver',
    'fn_ia_saude_scan', 'fn_ibpt_aliquota', 'fn_ibpt_aliquota_vigente', 'fn_ibpt_importar', 'fn_ibpt_vigencia_status', 'fn_import_cadastro_v1',
    'fn_import_lancamentos_planilha', 'fn_import_lancamentos_v2', 'fn_import_planilha_batch', 'fn_import_sugerir_psgc', 'fn_importar_planilha_lote', 'fn_ind_ambito_indicadores',
    'fn_ind_atak_resumo_refresh', 'fn_ind_comercial_metas', 'fn_ind_comercial_painel', 'fn_ind_pessoa_rebuild', 'fn_ind_valor_de_base', 'fn_ind_ve_ambito',
    'fn_insp_regiao_da_empresa', 'fn_investigacao_previa', 'fn_juiz_orcamento', 'fn_juiz_registrar_execucao', 'fn_lancamento_editar_inline', 'fn_lancamento_restaurar',
    'fn_lancamentos_buscar', 'fn_ldn_aplicar_template', 'fn_ldn_listar_templates_disponiveis', 'fn_lgpd_anonimizar_dados', 'fn_lgpd_export_dados', 'fn_lgpd_listar_solicitacoes_pendentes',
    'fn_lgpd_revogar_consentimento', 'fn_listar_nfes_emitidas', 'fn_listar_nfses_emitidas', 'fn_map_invite_role_to_client_role', 'fn_mapa_desenvolvimento', 'fn_mapa_dev_upsert_etapa',
    'fn_marcar_item_pronto', 'fn_meta_comparar', 'fn_monitor_shadow_promocao_diario', 'fn_motivo_perda_listar', 'fn_movimentacao_excluir', 'fn_movimentar_estoque',
    'fn_mudanca_deployar', 'fn_municipio_por_ibge', 'fn_nfe_auto_consultar_pendentes', 'fn_nfe_chave_dv_ok', 'fn_nfe_devolucao_estornar_estoque', 'fn_nfe_extrair_transp',
    'fn_nfe_extrair_tributos', 'fn_nfe_extrair_tributos_core', 'fn_nfe_item_custo_real_core', 'fn_nfe_item_fator', 'fn_nfe_lote_exato_matches', 'fn_nfe_recebida_aplicar_xml',
    'fn_nfe_sugerir_pedido', 'fn_nfse_auto_consultar_pendentes', 'fn_nfse_cancelar', 'fn_nfse_efetivar_se_autorizada', 'fn_nfse_estornar_financeiro', 'fn_nfse_gerar_financeiro',
    'fn_nfse_medicao_validar', 'fn_nfse_medicao_vincular', 'fn_nfse_obra_exigencia', 'fn_nfse_obra_pendente', 'fn_nfse_retencoes_totalizar', 'fn_normalizar_ramo',
    'fn_normalizar_status_omie', 'fn_nr36_assert', 'fn_nr36_classificar_eventos', 'fn_nr36_devido_min', 'fn_nr36_fim_origem_efetiva', 'fn_nr36_origem_label',
    'fn_nr36_sugerir_fim_pausa', 'fn_nr36_upload_substituir', 'fn_nr_assert_acesso', 'fn_nr_certificado_anexar', 'fn_nr_gerar_alertas', 'fn_nr_recalcular_validade',
    'fn_nr_sincronizar_documento', 'fn_nr_vencimentos', 'fn_obra_criar_de_orcamento', 'fn_odonto_agenda_dia', 'fn_odonto_alertas_gerar_todas', 'fn_odonto_backfill_cliente',
    'fn_odonto_cliente_do_paciente', 'fn_odonto_demo_limpar', 'fn_odonto_item_status', 'fn_odonto_plano_aprovar', 'fn_odonto_plano_cancelar', 'fn_odonto_procedimentos_custo',
    'fn_odonto_proximo_numero_paciente', 'fn_oficina_aprovacao_obter', 'fn_oficina_aprovacao_registrar', 'fn_oficina_markup_aplicar', 'fn_oficina_preco_mao_obra', 'fn_omie_sync_empresa',
    'fn_omie_sync_etapa', 'fn_omie_test_consulta', 'fn_omie_validar_credenciais_e_lancamento', 'fn_operator_has_access', 'fn_orcamento_editar', 'fn_orcamento_exige_obra',
    'fn_os_comissao_preview', 'fn_os_cotacao_aplicar_precos', 'fn_os_destino_financeiro', 'fn_os_publico_obter', 'fn_os_recalcular_total', 'fn_os_recalcular_total_interno',
    'fn_os_remover_assinatura', 'fn_os_snapshot_custo_lucro', 'fn_outbox_marcar_erro', 'fn_outbox_marcar_sucesso', 'fn_outbox_omie_collect', 'fn_outbox_omie_dispatch',
    'fn_outbox_omie_processar', 'fn_outbox_pegar_lote', 'fn_outbox_processar_lote', 'fn_owner_atribuir_usuario', 'fn_owner_pode_gerir_escopo', 'fn_pagar_editar',
    'fn_pagar_herdar_pix', 'fn_pagar_por_card', 'fn_pagar_recalcular_status', 'fn_parsear_siga_path', 'fn_pec_mov_reverter_animais', 'fn_pec_pesagem_historico',
    'fn_pec_transferir_fase', 'fn_pec_ua_lote', 'fn_pedido_cancelar', 'fn_pedido_gerar_previsao', 'fn_pedido_pode_editar', 'fn_pem_briefing_roadmap',
    'fn_periodos_disponiveis', 'fn_planilha_universal_processar', 'fn_plano_contas_aplicar_template_global', 'fn_plano_contas_aprovar_global', 'fn_planos_v15_para_admin', 'fn_pluggy_get_credentials',
    'fn_pluggy_promover_financeiro_recentes', 'fn_pm_hub_kpis', 'fn_pm_kanban', 'fn_ponto_escala_segundos', 'fn_ponto_infracoes', 'fn_ponto_sync_dispatch',
    'fn_popular_dre_divisional_from_psgc', 'fn_post_merge_orchestrator', 'fn_precificar_montagem', 'fn_precificar_montagem_mao_obra', 'fn_precificar_montagem_material', 'fn_processar_respostas_sync',
    'fn_prod_fonte_chaves', 'fn_prod_horarios_frequentes_ponto', 'fn_prod_norm', 'fn_prod_posto_turno_salvar', 'fn_prod_sugerir_fator_cabeca_kg', 'fn_prod_unidades_semear_padrao',
    'fn_produto_margem_real', 'fn_produto_monofasico', 'fn_produto_preco_por_margem', 'fn_projetos_atualizar_catalogo_publico_empresa', 'fn_projetos_empresa_pode_acessar', 'fn_projetos_fork_servico',
    'fn_projetos_sincronizar_catalogo_publico', 'fn_prontuario_alertas', 'fn_protocolo_abertura_v2', 'fn_protocolo_abertura_v3', 'fn_protocolo_abertura_v4', 'fn_provisionar_acesso_por_invite',
    'fn_provisionar_user_scope', 'fn_proximo_numero_nfse', 'fn_psgc_abc_consolidado', 'fn_psgc_analise_vertical_horizontal', 'fn_psgc_aplicar_aprendizado_global', 'fn_psgc_apuracao_tributaria',
    'fn_psgc_balanco_gerencial', 'fn_psgc_cadastrar_ln', 'fn_psgc_classificar_ln', 'fn_psgc_corrigir_mapeamento', 'fn_psgc_dfc_indireto', 'fn_psgc_dre_consolidada',
    'fn_psgc_indicadores_avancados', 'fn_psgc_narrativa_cfo', 'fn_psgc_onboarding', 'fn_psgc_pai_info', 'fn_psgc_painel_executivo', 'fn_psgc_processar_fila',
    'fn_psgc_raiox_1', 'fn_psgc_recalcular_abc', 'fn_psgc_recalcular_dre_mes', 'fn_psgc_recalcular_fluxo', 'fn_psgc_saude_consolidada', 'fn_psgc_saude_empresa',
    'fn_psgc_termometro_saude', 'fn_rateio_aplicar', 'fn_rateio_calcular_mes', 'fn_rateio_calcular_todos_mes', 'fn_rd38_prs_pendentes_validacao', 'fn_rd38_registrar_validacao_pr',
    'fn_rd_briefing', 'fn_rd_registrar', 'fn_rd_substituir', 'fn_recalcular_budget_anthropic', 'fn_receber_editar', 'fn_receber_nfse_dados',
    'fn_receita_perdida', 'fn_recompute_baixa_titulo', 'fn_registrar_avanco_ge', 'fn_registrar_handoff', 'fn_registrar_nfe_emitida', 'fn_registrar_nfse_emitida',
    'fn_registrar_resultado_evento_nfe', 'fn_remessa_ocorrencia_efeito', 'fn_remessa_retorno_processar', 'fn_renderizar_progresso_roadmap', 'fn_replicar_depara_omie', 'fn_resolver_area_da_rota',
    'fn_resumo_contador_financeiro', 'fn_retomar_sessao', 'fn_rh_backfill_funcionarios', 'fn_rh_importar_postos', 'fn_rh_rv_participante_salvar', 'fn_roadmap_ia_dashboard',
    'fn_role_to_nivel', 'fn_rollback_rls_day1', 'fn_rollback_rls_endurecimento', 'fn_rota_conhecida', 'fn_saldo_gerencial_contas', 'fn_servico_produtividade_salvar',
    'fn_set_is_demo', 'fn_sugerir_mapeamento_texto_livre', 'fn_sugestao_email_fila', 'fn_sugestao_ia_gasto_hoje', 'fn_sugestao_ia_registrar', 'fn_sugestao_lembrete_confirmacao',
    'fn_sugestao_msg_ia_registrar', 'fn_sugestao_status_permitidos', 'fn_sync_empresa', 'fn_sync_orquestrador', 'fn_sync_produtos_empresa', 'fn_takeoff_ambientes_salvar',
    'fn_truth_audit_compras', 'fn_truth_audit_dre', 'fn_truth_audit_dre_despesa', 'fn_truth_audit_executar_todas', 'fn_truth_audit_links_404', 'fn_truth_audit_saldo_unificado',
    'fn_unidade_criar', 'fn_user_can', 'fn_user_email_atual', 'fn_user_pode_ver', 'fn_user_scope_arvore', 'fn_validar_certificado_a1',
    'fn_validar_dominios', 'fn_vault_ler_secret', 'fn_veic__receber', 'fn_veic_acesso', 'fn_veic_bool', 'fn_veic_checklist_padrao',
    'fn_veic_coaf_limite', 'fn_veic_coaf_pendentes', 'fn_veic_comissao_calcular', 'fn_veic_comissao_precificacao', 'fn_veic_completude_resumo', 'fn_veic_custo_fixo_rateavel',
    'fn_veic_int', 'fn_veic_num', 'fn_veic_perfil_fiscal_exigir', 'fn_veic_perfil_fiscal_vigente', 'fn_veic_perfil_operacao', 'fn_veic_perfil_rascunho_id',
    'fn_veic_precificacao_simular', 'fn_veic_previsao_vistoria_ajustada', 'fn_veic_proposta_criar', 'fn_veic_proposta_situacao', 'fn_veic_tributos_diferenca', 'fn_veiculo_publico_obter',
    'fn_visual_truth_alertas_pendentes', 'fn_visual_truth_executar', 'fn_visual_truth_popular_regras_compliance', 'fn_visual_truth_resolver_alerta', 'fn_visual_truth_resumo', 'fn_wealth_atualizar_cotacao',
    'fn_wealth_atualizar_cotacoes_brapi', 'fn_wealth_brapi_consume', 'fn_wealth_brapi_consume_recentes', 'fn_wealth_brapi_dispatch', 'fn_wealth_calcular_dy', 'fn_wealth_calcular_metricas',
    'fn_wealth_calcular_posicao', 'fn_wealth_consolidar_familia', 'fn_wealth_importar_planilha', 'fn_wealth_ips_coerencia', 'fn_wealth_snapshot_mensal', 'fn_wealth_suitability_seed_default',
    'fn_wealth_user_eh_aprovador_cvm19', 'fn_wealth_validar_ips', 'fn_webhook_atualizar_nfe', 'fn_webhook_atualizar_nfse', 'fn_webhook_marcar_processado', 'fn_webhook_registrar_log',
    'fn_xml_has', 'fn_xml_num', 'fn_xml_txt', 'gerar_titulo_contrato', 'gerar_titulos_compra', 'gerar_titulos_contratos_mes',
    'limpar_descricao_ofx', 'next_os_numero', 'ramos_da_empresa', 'receber_compra', 'sp_pluggy_consent_financeiro_aceitar', 'sp_pluggy_consume_sync',
    'sp_pluggy_promover_para_conciliacao', 'sp_pluggy_register_item_financeiro', 'sp_pluggy_sync_diario', 'sp_wealth_brapi_atualizar', 'user_company_ids'];
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (nomes) AND p.prokind IN ('f','p')
  LOOP
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', f.sig);
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon, authenticated', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'PR A2: EXECUTE de authenticated retirado de % assinaturas', n;
END $$;

-- (2) guarda "equipe PS" nas funções das telas internas (inserida logo após o BEGIN do corpo plpgsql)
DO $do$
DECLARE f record; v_def text; v_new text; v_pos int; v_marker text;
  guarda text := E'\n  -- PR A2 (CEO 28/09): só a equipe PS (ou chamada de serviço/cron, sem usuário)\n'
    || E'  IF auth.uid() IS NOT NULL AND NOT (public.is_admin() OR EXISTS (SELECT 1 FROM public.users u\n'
    || E'       WHERE u.id = auth.uid() AND u.system_role IS NOT NULL)) THEN\n'
    || E'    RAISE EXCEPTION ''Acesso restrito à equipe PS'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n';
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_mudanca_aprovar', 'fn_mudanca_rejeitar', 'fn_contexto_concluir', 'fn_provider_pausar_emergencia', 'fn_provider_promover_para_write_back', 'fn_sync_health_check', 'fn_sync_controle', 'fn_disparar_screen_watcher', 'fn_bpo_admin_onboarding_cliente', 'fn_bpo_admin_reatribuir_papel', 'fn_bpo_admin_set_skill')
  LOOP
    v_def := pg_get_functiondef(f.oid);
    IF v_def ~ 'PR A2 \(CEO 28/09\): só a equipe PS' THEN CONTINUE; END IF;
    v_marker := substring(v_def from '\nAS (\$[a-z_]*\$)');
    v_pos := strpos(v_def, E'\nAS ' || v_marker);
    IF v_pos = 0 THEN RAISE EXCEPTION 'PR A2: corpo não encontrado em %', f.proname; END IF;
    -- primeiro BEGIN (palavra inteira) depois do marcador do corpo
    v_new := substr(v_def, 1, v_pos) ||
             regexp_replace(substr(v_def, v_pos + 1), '(\mBEGIN\M)', E'\\1' || guarda, 'i');
    IF v_new = v_def THEN RAISE EXCEPTION 'PR A2: BEGIN não encontrado em %', f.proname; END IF;
    EXECUTE v_new;
  END LOOP;
END $do$;

-- (3a) consentimento LGPD: só do próprio usuário
DO $do$
DECLARE v_def text; v_new text; v_pos int; v_marker text;
  guarda text := E'\n  -- PR A2 (CEO 28/09): logado só registra o PRÓPRIO consentimento\n'
    || E'  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN\n'
    || E'    RAISE EXCEPTION ''Consentimento só do próprio usuário'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_lgpd_registrar_consentimento';
  IF v_def !~ 'logado só registra o PRÓPRIO consentimento' THEN
    v_marker := substring(v_def from '\nAS (\$[a-z_]*\$)');
    v_pos := strpos(v_def, E'\nAS ' || v_marker);
    v_new := substr(v_def, 1, v_pos) || regexp_replace(substr(v_def, v_pos + 1), '(\mBEGIN\M)', E'\\1' || guarda, 'i');
    IF v_new = v_def THEN RAISE EXCEPTION 'PR A2: BEGIN não encontrado em fn_lgpd_registrar_consentimento'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- (3b) orçamento de IA: custo plausível
DO $do$
DECLARE v_def text; v_new text; v_pos int; v_marker text;
  guarda text := E'\n  -- PR A2 (CEO 28/09): custo plausível por chamada (antes qualquer logado zerava/estourava o orçamento)\n'
    || E'  IF p_custo_usd IS NULL OR p_custo_usd < 0 OR p_custo_usd > 10 THEN\n'
    || E'    RAISE EXCEPTION ''Custo de IA fora da faixa (0–10 USD)'' USING ERRCODE = ''22023'';\n'
    || E'  END IF;\n';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_budget_registrar_gasto';
  IF v_def !~ 'custo plausível por chamada' THEN
    v_marker := substring(v_def from '\nAS (\$[a-z_]*\$)');
    v_pos := strpos(v_def, E'\nAS ' || v_marker);
    v_new := substr(v_def, 1, v_pos) || regexp_replace(substr(v_def, v_pos + 1), '(\mBEGIN\M)', E'\\1' || guarda, 'i');
    IF v_new = v_def THEN RAISE EXCEPTION 'PR A2: BEGIN não encontrado em fn_budget_registrar_gasto'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- trava: nenhuma das funções-alvo segue executável por authenticated; guardas presentes
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_backup_executar','fn_demo_reset','fn_vault_ler_secret',
         'fn_pluggy_get_credentials','fn_mudanca_deployar','fn_rateio_calcular_mes','fn_sync_empresa','fn_provisionar_user_scope',
         'fn_import_cadastro_v1','fn_set_is_demo','fn_registrar_handoff','fn_rd_registrar')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'PR A2: authenticated ainda executa %', v; END IF;
  SELECT string_agg(p.proname, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_mudanca_aprovar', 'fn_mudanca_rejeitar', 'fn_contexto_concluir', 'fn_provider_pausar_emergencia', 'fn_provider_promover_para_write_back', 'fn_sync_health_check', 'fn_sync_controle', 'fn_disparar_screen_watcher', 'fn_bpo_admin_onboarding_cliente', 'fn_bpo_admin_reatribuir_papel', 'fn_bpo_admin_set_skill')
     AND pg_get_functiondef(p.oid) !~ 'só a equipe PS';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'PR A2: sem guarda PS: %', v; END IF;
END $$;
