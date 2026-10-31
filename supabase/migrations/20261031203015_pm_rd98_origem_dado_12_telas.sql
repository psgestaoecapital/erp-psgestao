-- RD-98 pilar 3 (ORIGEM DO DADO) — preenche views_consumidas / rpcs_chamadas em system_screens
-- para 10 telas P&M que estavam com a origem VAZIA (gap apontado pelo auditor_pdca_2 em 30/10).
-- Complementa a PR #3497 (que cobriu apontamento-horas, pauta, margem-job, painel-gestor, planejamento,
-- configuracoes, contratos, cobranca e /dashboard/producao) — aqui só rotas NÃO cobertas por ela.
--
-- Listas extraídas do grep real `.from(...)` / `.rpc(...)` de cada page.tsx (os dados que a tela consome).
-- Prova (RD-38, produção, leitura): as 10 rotas existem em system_screens e as 10 estavam com
--   array_length(views_consumidas,1)=0 e array_length(rpcs_chamadas,1)=0.
--
-- ADITIVA e metadado-only: só UPDATE de system_screens (views_consumidas/rpcs_chamadas). Nenhuma tabela,
-- RLS, policy, função ou dado de cliente. Idempotente: o WHERE só atinge a rota com a origem ainda vazia,
-- então re-rodar não sobrescreve preenchimentos posteriores.

-- /dashboard/pm/aprovacao
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_jobs']::text[],
    rpcs_chamadas    = ARRAY['fn_pm_job_mover_status']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/aprovacao'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/briefings
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_briefings','agency_clientes','agency_contratos','agency_jobs']::text[],
    rpcs_chamadas    = ARRAY['fn_pm_planejamento_do_fee']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/briefings'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/calendario
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_planejamentos','agency_posts','agency_servico','erp_clientes']::text[],
    rpcs_chamadas    = ARRAY['fn_agency_config_listar']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/calendario'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/comercial
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_comissao','agency_leads','agency_propostas','erp_contratos']::text[],
    rpcs_chamadas    = ARRAY['fn_funil_etapas_listar']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/comercial'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/equipe
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_equipe','rbac_papel']::text[],
    rpcs_chamadas    = ARRAY['fn_pm_papel_agencia_aplicar','fn_pm_papel_agencia_previa']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/equipe'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/meu-dia
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_anotacoes','agency_aprovacoes','agency_job_comentarios','agency_pauta_lote','agency_timesheet']::text[],
    rpcs_chamadas    = ARRAY['fn_pauta_listar','fn_usuarios_da_empresa']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/meu-dia'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/painel-jobs
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_campanhas','agency_clientes','agency_grupos_clientes','agency_job_rodadas','agency_jobs','agency_painel_opcao','agency_servico','agency_timesheet']::text[],
    rpcs_chamadas    = ARRAY['fn_usuarios_da_empresa']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/painel-jobs'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/portfolio
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_jobs']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/portfolio'
  AND coalesce(array_length(views_consumidas,1),0) = 0;

-- /dashboard/pm/relatorio-documentos
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_contratos','agency_equipe','agency_propostas']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/relatorio-documentos'
  AND coalesce(array_length(views_consumidas,1),0) = 0;

-- /dashboard/pm/servicos
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_config_opcao','agency_equipe','agency_servico']::text[],
    rpcs_chamadas    = ARRAY['fn_agency_config_excluir','fn_agency_config_listar','fn_agency_config_salvar']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/servicos'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/comissao
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_comissao','agency_jobs']::text[],
    rpcs_chamadas    = ARRAY['fn_agency_comissao_aprovar']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/comissao'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/pm/importar-siga (só RPC — a tela importa via função, não lê view direto)
UPDATE public.system_screens
SET rpcs_chamadas    = ARRAY['fn_pm_importar_jobs_siga']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/pm/importar-siga'
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;
