// Funções do schema public que quem NÃO está logado (anon) pode executar — lista APROVADA pelo CEO.
// Fonte: migrations 20260928180000 (PR A: páginas públicas com token + guardas das policies), 20260928213000 (hotfix
// agente ATAK) e 20260928223000 (telemetria com limite). Em 30/09 o CEO tirou fn_acessos_pode_gerir (só as policies da
// remessa usam; nenhum fluxo sem login precisa dela) → 26.
// Qualquer função fora desta lista aberta ao anon REPROVA o PR (scripts/check-fn-guards.ts). Para incluir uma função
// aqui é preciso aprovação escrita do CEO — ela passa a ser chamável por qualquer pessoa com a URL do Supabase.
// Funções de extensão (pg_trgm, unaccent) não entram: são do Postgres, não do sistema.
export const ANON_APROVADAS: readonly string[] = [
  // páginas públicas — exigem e conferem token no corpo
  'fn_os_publico_aprovar',
  'fn_odonto_proposta_por_token', 'fn_odonto_proposta_aceitar', 'fn_odonto_proposta_recusar',
  'fn_compliance_epi_marcar_visualizado', 'fn_compliance_epi_confirmar_assinatura',
  'fn_nr36_ciencia_marcar_visualizado', 'fn_nr36_ciencia_confirmar_assinatura',
  'fn_convite_ler',
  'fn_portal_cliente_obter',
  // telemetria sem sessão — limite de 20/min por IP ou usuário
  'fn_registrar_evento_auth', 'fn_registrar_travamento',
  // agente ATAK (token do agente conferido no corpo)
  'fn_agente_heartbeat', 'fn_atak_agente_config', 'fn_atak_heartbeat', 'fn_atak_teste_responder',
  // guardas das policies — só leitura; sem login devolvem vazio/falso
  'get_user_company_ids', 'is_admin', 'is_client_owner', 'user_can_access_plant', 'fn_eh_ps_admin',
  'fn_cofre_pode_acessar', 'fn_pode_ver_fila_suporte', 'fn_ind_tem_permissao',
  'fn_wealth_user_eh_operador', 'fn_wealth_user_pode_ver_tudo',
]
