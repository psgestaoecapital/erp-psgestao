-- RD-98 p3 (origem do dado): classifica as telas do CRM que estavam com
-- views_consumidas/rpcs_chamadas vazios em system_screens.
-- Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- segredo/vault, cálculo nem estado_real; as tabelas/funções apenas são REFERENCIADAS
-- pelo nome. Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código e no banco (RD-38):
--  /dashboard/crm (page.tsx): supabase.rpc('fn_crm_hoje') + useCrm→rpcCrm('fn_crm_config').
--    fn_crm_hoje lê (pg_get_functiondef): erp_crm_oportunidade (negócios), crm_tarefa
--    (tarefas), erp_crm_lead (leads), erp_clientes, funil_etapa, crm_alerta_config.
--  /dashboard/crm/funis (page.tsx): useCrm→fn_crm_config + fn_crm_funil_salvar,
--    fn_crm_funil_etapa_salvar, fn_crm_funil_etapa_desativar, fn_crm_funil_etapas_ordenar,
--    fn_crm_cadastro_salvar. fn_crm_config lê: crm_funil, funil_etapa, crm_origem,
--    erp_motivo_perda, crm_campo_custom, erp_crm_oportunidade.
--  /dashboard/crm/leads (page.tsx): .from('erp_crm_lead') (leitura) + escrita por RPC
--    fn_crm_lead_acao (Pegar/Descartar), fn_crm_lead_qualificar (→ Virar negócio),
--    fn_crm_lead_salvar (Novo/Editar) + useCrm→fn_crm_config. (gap: rpcs_chamadas vazio.)
-- Todos os objetos existem em pg_class/pg_proc (conferido).
-- Code: desenvolvedor_4_g

UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_crm_oportunidade','crm_tarefa','erp_crm_lead','erp_clientes','funil_etapa','crm_alerta_config']::text[],
    rpcs_chamadas = ARRAY['fn_crm_hoje','fn_crm_config']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/crm';

UPDATE public.system_screens
SET views_consumidas = ARRAY['crm_funil','funil_etapa','crm_origem','erp_motivo_perda','crm_campo_custom','erp_crm_oportunidade']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/crm/funis';

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_crm_lead_acao','fn_crm_lead_qualificar','fn_crm_lead_salvar','fn_crm_config']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/crm/leads';
