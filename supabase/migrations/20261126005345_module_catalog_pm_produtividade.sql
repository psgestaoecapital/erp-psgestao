-- P&M · tela 121 · RD-98 passo D (bloqueio p/ selo): registra /dashboard/pm/produtividade no module_catalog.
-- A tela "Utilização da equipe" (page.tsx + fn_pm_utilizacao_heatmap) estava AUSENTE do module_catalog
-- (0 linha) -> fora do catálogo = bloqueada para o selo. Registra junto das irmãs de produção do P&M
-- (grupo 'pm', subgrupo 'pm_producao'), ao lado do Painel do gestor/Painel de Jobs. Nome igual ao da tela (RD-96).
-- Code: desenvolvedor_4_g
--
-- Aditiva e idempotente (INSERT ... ON CONFLICT (id) DO UPDATE dos campos de exibição). Não toca RLS, estrutura,
-- dado de cliente nem semântica. RD-38 (provado no PR): antes 0 linha com rota '/dashboard/pm/produtividade'
-- (e sem id 'pm_produtividade'); ordem 59 livre em pm/pm_producao; depois 1 linha.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, descricao, surface_in_groups)
VALUES (
  'pm_produtividade',
  'Utilização da equipe',
  'pm',
  'pm_producao',
  'Activity',
  '/dashboard/pm/produtividade',
  59,
  true,
  true,
  'Heatmap de utilização por pessoa e semana: quanto da capacidade virou hora apontada, separando horas faturáveis (em job de cliente) das não faturáveis (trabalho interno).',
  ARRAY[]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  grupo = EXCLUDED.grupo,
  subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone,
  rota = EXCLUDED.rota,
  ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo,
  is_shared = EXCLUDED.is_shared,
  descricao = EXCLUDED.descricao,
  surface_in_groups = EXCLUDED.surface_in_groups;
