-- Registra a tela "Documentos Recebidos (NFe)" no module_catalog — PDCA GE (tarefa 7bd93a53).
--
-- GAP (auditor, RD-38): /dashboard/compras/documentos-recebidos existe e está em system_screens, mas
-- NÃO estava no module_catalog. O menu vivo é montado por fn_modulos_sidebar_por_area(area,company,user),
-- que lê module_catalog (o SIDEBAR_GESTAO_EMPRESARIAL hardcoded é só fallback de rpc-error — ver
-- src/lib/menu/useSidebarModulos.ts). Sem a linha no catálogo a tela não aparecia no menu do banco, e o
-- PASSO D do selo exige presença no module_catalog. Tela >=95 tem de estar no menu do banco.
--
-- CORREÇÃO: INSERT ADITIVO, idempotente (ON CONFLICT DO NOTHING). Espelha os irmãos de compras
-- (commerce_mutirao/commerce_livro_entradas: grupo=commerce, subgrupo=compras, is_shared=true,
-- surface_in_groups=['gestao_empresarial','commerce']). Ordem 181 (slot livre entre reforma 180 e
-- livro-entradas 182), agrupando com as telas de notas de entrada. ativo=true (tela pronta, em produção).
-- Não altera nenhuma linha existente; não toca RLS/permissões.

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, is_shared, surface_in_groups, so_demo, so_ps)
VALUES
  ('commerce_documentos_recebidos', 'Documentos Recebidos (NFe)', 'commerce', 'compras', 'Inbox',
   '/dashboard/compras/documentos-recebidos', 181, true,
   'NFes (modelo 55) emitidas contra o CNPJ da empresa, puxadas da Distribuição DF-e; manifesta, baixa XML e lança em Contas a Pagar.',
   true, ARRAY['gestao_empresarial','commerce']::text[], false, false)
ON CONFLICT (id) DO NOTHING;
