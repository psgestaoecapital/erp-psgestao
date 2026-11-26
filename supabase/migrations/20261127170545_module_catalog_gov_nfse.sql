-- GAP (auditor · bloqueio p/ selo >=95) · /dashboard/fiscal/gov-nfse
-- A tela "NFSe Nacional gov.br" existe (page.tsx + menu sidebar + system_screens), mas estava AUSENTE do
-- module_catalog (nenhuma linha) -> fora do menu do catálogo = BLOQUEADA para o selo. Registra o módulo junto das
-- irmãs de Notas Fiscais (grupo 'gestao_empresarial', subgrupo 'notas_fiscais'), como fiscal_nfse_emitidas.
-- Nome igual ao da tela/menu/system_screens (RD-96). NÃO toca a emissão de NFS-e (outra tela, task rodrigo-code).
--
-- Aditiva e idempotente (INSERT ... ON CONFLICT (id) DO UPDATE dos campos de exibição). Não toca dado de cliente,
-- RLS, estrutura nem semântica fiscal. RD-38 (prova no PR): antes 0 linha com rota '/dashboard/fiscal/gov-nfse' no
-- module_catalog (e sem o id 'fiscal_gov_nfse'); depois 1 linha.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, descricao, surface_in_groups)
VALUES (
  'fiscal_gov_nfse',
  'NFSe Nacional gov.br',
  'gestao_empresarial',
  'notas_fiscais',
  'Landmark',
  '/dashboard/fiscal/gov-nfse',
  6,
  true,
  true,
  'Painel do NFS-e Nacional (gov.br): status do ambiente, adesão do município e diagnóstico. A emissão sai da tela "Emissão de NFS-e".',
  ARRAY['gestao_empresarial','pm','custeio_a','bpo','services','commerce']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  grupo = EXCLUDED.grupo,
  subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone,
  rota = EXCLUDED.rota,
  ativo = EXCLUDED.ativo,
  is_shared = EXCLUDED.is_shared,
  descricao = EXCLUDED.descricao,
  surface_in_groups = EXCLUDED.surface_in_groups;
