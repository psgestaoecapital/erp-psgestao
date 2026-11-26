-- GAP (auditor · PASSO D p/ selo) · /dashboard/compras/documentos-recebidos
-- A tela "Documentos Recebidos (NFe)" existe (page.tsx + menu sidebar), mas estava AUSENTE do module_catalog
-- (só no sidebar-config.ts), o que mantinha o status "parcial" e bloqueava o selo. Registra o módulo no catálogo,
-- junto das irmãs de Compras (grupo 'commerce', subgrupo 'compras'), aparecendo também na Gestão Empresarial.
--
-- Aditiva e idempotente (INSERT ... ON CONFLICT (id) DO UPDATE dos campos de exibição). Não toca dado de cliente,
-- RLS, estrutura nem semântica fiscal. Nome igual ao da tela/menu/system_screens (RD-96).
-- RD-38 (prova no PR): antes não há linha com id='commerce_documentos_recebidos' nem rota desta tela; depois 1 linha.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, descricao, surface_in_groups)
VALUES (
  'commerce_documentos_recebidos',
  'Documentos Recebidos (NFe)',
  'commerce',
  'compras',
  'Inbox',
  '/dashboard/compras/documentos-recebidos',
  182,
  true,
  true,
  'NF-e de compra recebidas da SEFAZ: manifestação (MDe), download do XML e lançamento no estoque e no financeiro.',
  ARRAY['gestao_empresarial','commerce']::text[]
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
