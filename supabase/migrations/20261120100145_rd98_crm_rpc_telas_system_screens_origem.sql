-- RD-98 p3 · origem do dado NULA em tres telas de MENU do CRM movidas por RPC (menu ativo),
-- enquanto a tela irma /dashboard/crm/pipeline ja tem o registro. So metadado de registro da tela.
--
-- Fontes reais das telas (prova no codigo, RD-38):
--   /dashboard/crm ("CRM · O que fazer hoje") -> src/app/dashboard/crm/page.tsx
--     * RPC fn_crm_hoje (L29) — monta o painel "hoje" (tarefas/alertas do dia).
--     * Tela 100% por RPC -> views_consumidas = {} (sem leitura direta de tabela).
--   /dashboard/crm/relatorios ("CRM · Relatorios") -> src/app/dashboard/crm/relatorios/page.tsx
--     * RPC fn_crm_relatorio (L31) — gera o relatorio por funil/periodo.
--     * Tela 100% por RPC -> views_consumidas = {}.
--   /dashboard/crm/funis ("CRM · Funis e cadastros") -> src/app/dashboard/crm/funis/page.tsx
--     (acesso a dados via helper src/components/crm/crmUi.tsx: useCrm -> fn_crm_config; rpcCrm -> acoes)
--     * RPC fn_crm_config            (crmUi.tsx L126) — carrega funis+etapas, origens, motivos, campos.
--     * RPC fn_crm_funil_salvar          (funis L68/L76) — cria/edita funil.
--     * RPC fn_crm_funil_etapa_salvar    (funis L35/L86) — cria/edita etapa.
--     * RPC fn_crm_funil_etapas_ordenar  (funis L41)     — reordena etapas.
--     * RPC fn_crm_funil_etapa_desativar (funis L80)     — retira etapa do funil.
--     * RPC fn_crm_cadastro_salvar       (funis L96/L97) — cria/edita origens/motivos.
--     * Tela 100% por RPC -> views_consumidas = {}.
--
-- Estado antes (producao): as tres com views_consumidas = NULL e rpcs_chamadas = NULL.
-- Todas as 8 RPCs existem no banco (conferido em pg_proc).
--
-- Correcao corretiva e idempotente: NAO toca RLS, grants, dado de cliente, nem comportamento.
-- Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE deterministico das linhas existentes por rota).

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY['fn_crm_hoje']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY['fn_crm_relatorio']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm/relatorios';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY['fn_crm_config','fn_crm_funil_salvar','fn_crm_funil_etapa_salvar','fn_crm_funil_etapas_ordenar','fn_crm_funil_etapa_desativar','fn_crm_cadastro_salvar']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm/funis';
