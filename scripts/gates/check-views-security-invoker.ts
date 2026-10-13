// Gate (CEO 05/10 · RD-79): view em public legível por authenticated sem security_invoker=true ignora a RLS e vaza dado
// entre empresas. Roda no build, sem rede: toda migration que cria/recria view precisa reaplicar security_invoker, e a
// Onda 1 (financeiro, compliance/EPI/folha, odonto, veículos) tem de estar coberta.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261005143000_views_security_invoker_onda1.sql', 'utf8')
const onda1 = ['v_compliance_calendar_dashboard', 'v_compliance_matriz_prestadores', 'v_compliance_status_consultas',
  'v_contas_pagar_aging', 'v_contas_receber_aging', 'v_custo_folha_setor', 'v_psgc_dre_divisional', 'v_dre_divisional_completo',
  'v_dre_receita_3_fontes', 'v_epi_dashboard', 'v_epi_ficha_funcionario', 'v_epi_funcionarios_consolidado',
  'v_lancamentos_consolidado', 'v_odonto_debitos_paciente', 'v_psgc_dre_nivel2', 'v_psgc_dre_nivel3', 'v_psgc_fluxo_projecao',
  'v_psgc_pagar_distribuido', 'v_receber_efetivo', 'v_titulos_consolidados', 'v_veic_patio', 'v_veic_venda']
for (const v of onda1) ok(new RegExp(`ALTER VIEW public\\.${v}\\s+SET \\(security_invoker = true\\)`).test(mig), `Onda 1: ${v} com security_invoker`)
ok(/REVOKE ALL ON FUNCTION public\.fn_seguranca_views_sem_invoker\(\) FROM PUBLIC, anon, authenticated/.test(mig), 'auditoria fechada a anon/authenticated')

// Onda 2 (CEO 05/10): restante das views. (a) invoker, (c) REVOKE; (b) adiadas = exceções justificadas abaixo.
const mig2 = readFileSync('supabase/migrations/20261005160000_views_security_invoker_onda2.sql', 'utf8')
const onda2Invoker = ["companies_producao", "dashboard_grupos", "v_admin_modulo_features", "v_admin_plano_modulos", "v_admin_planos_completo", "v_admin_roadmap_completo", "v_admin_truth_dashboard", "v_alertas_ativos", "v_auditor_matriz_ultimo_por_area", "v_auditores_dashboard", "v_bpo_admin_painel", "v_bpo_alertas_ativos", "v_bpo_clientes_ativos", "v_bpo_kpis_globais", "v_bpo_meu_dia_resumo", "v_bpo_painel_empresa", "v_bpo_performance_operador", "v_catalogo_executivo", "v_categorias_padrao_por_sistema", "v_categorias_sem_depara", "v_companies_plano_compat", "v_conciliacao_saude", "v_contratos_dashboard", "v_contratos_mrr_por_tipo", "v_contratos_top_clientes", "v_daily_dashboard", "v_depara_sugestoes_pendentes", "v_erp_produtos_estoque", "v_estado_real_sistema", "v_estoque_movimentacoes", "v_features_pendentes_caminho_critico", "v_fila_roadmap_ia", "v_ge_dashboard_progresso", "v_ge_roadmap_resumo", "v_gold_rotas_404", "v_gov_nfse_dps_pendentes", "v_hub_fiscal_cards", "v_ia_saude_endpoints", "v_ind_abate_diario", "v_ind_alerts", "v_ind_embalagem", "v_ind_estoque", "v_ind_indicador_realizado", "v_ind_monthly_maintenance", "v_ind_monthly_production", "v_ind_pessoa_divergencia", "v_ind_plant_dashboard", "v_ind_producao_abate", "v_kpis_monthly", "v_menu_rota_ausente", "v_modulo_status_consolidado", "v_monthly_from_daily", "v_plano_features_completas", "v_projetos_bdi_impacto", "v_projetos_bom_completo", "v_projetos_insumos_ui", "v_projetos_kpis_empresa", "v_projetos_mao_obra_ui", "v_projetos_resumo_empresa", "v_projetos_servicos_catalogo", "v_prontuario_conexao", "v_psgc_depara_auditoria", "v_psgc_depara_revisao", "v_psgc_painel_onboarding", "v_psgc_saude_empresa", "v_psgc_top_clientes", "v_psgc_top_fornecedores", "v_quarterly", "v_rateio_ln", "v_receita_projetada_12m", "v_receita_projetada_resumo_mensal", "v_roadmap_proximos_marcos", "v_roadmap_snapshot", "v_saneamento_estado", "v_screen_watcher_resumo", "v_sessao_chat_ultima", "v_sync_monitor", "v_tenant_subscriptions_summary", "v_uso_mensal_por_empresa", "v_visual_truth_dashboard", "v_weekly", "v_weekly_alerts", "v_yearly", "vw_memoria_ativa"]
const onda2Revoke = ["v_botoes_quebrados", "v_fiscal_storage_status", "v_ia_saude", "v_lgpd_status_compliance", "v_manual_operacional_indice", "v_manual_vivo_completo", "v_mapa_desenvolvimento", "v_pem_roadmap_resumido", "v_product_cost", "v_rd38_status_validacao_prs", "v_roadmap_contaazul"]
for (const v of onda2Invoker) ok(new RegExp(`ALTER VIEW public\\.${v}\\s+SET \\(security_invoker = true\\)`).test(mig2), `Onda 2: ${v} com security_invoker`)
for (const v of onda2Revoke) ok(new RegExp(`REVOKE ALL ON public\\.${v} FROM anon, authenticated`).test(mig2), `Onda 2: ${v} sem acesso de authenticated`)
// Exceções (b): identidade/permissão/menu e admin, aguardam decisão do Eng. Chefe + prova de tela (tarefa 1f7540ed).
const excecoesViews = ["v_sync_health", "v_compliance_matriz_funcionarios", "v_user_permissions_resolved", "v_user_companies_active", "v_users_with_roles", "v_tenant_modules_resolved", "v_erp_outbox_resumo", "v_audit_log_resumo"]
ok(excecoesViews.length > 0, `Exceções (b) documentadas: ${excecoesViews.join(", ")}`)

// Migrations posteriores à Onda 1 que criam view: precisam declarar security_invoker (ou REVOKE do authenticated).
const novas = readdirSync('supabase/migrations').filter(f => f > '20261005160000' && f.endsWith('.sql'))
for (const f of novas) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/--.*$/gm, '')
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)\s*(\([^)]*\))?\s*(WITH\s*\([^)]*\))?/gi)) {
    ok(/security_invoker\s*=\s*(true|on)/i.test(m[3] || ''), `${f}: view ${m[1]} criada com security_invoker=true`)
  }
}
if (falhas) { console.error(`\n${falhas} falha(s) em views sem security_invoker`); process.exit(1) }
console.log('\nViews com security_invoker (Onda 1): ok')
