-- RD-98 p3 (origem do dado): registra a origem do dado (views/tabelas lidas + RPCs) de
-- 2 telas que estavam com views_consumidas e rpcs_chamadas vazios em system_screens.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado de
-- cliente, cálculo nem o comportamento das telas. ADITIVA e IDEMPOTENTE: só preenche a
-- origem quando ainda vazia — re-rodar não altera nada já preenchido por outro processo.
--
-- Fontes PROVADAS no código (RD-38):
--   /dashboard/admin/ajuda-curadoria → src/app/dashboard/admin/ajuda-curadoria/page.tsx
--       chama supabase.rpc: fn_ajuda_curadoria_listar, fn_ajuda_curadoria_fila,
--       fn_ajuda_curar_aplicar, fn_ajuda_artigo_salvar_corpo (sem leitura direta de tabela).
--   /dashboard/anti-fraude → src/app/dashboard/anti-fraude/page.tsx lê, via supabase.from:
--       companies, company_groups, omie_imports, user_companies, users.
-- Existência conferida no banco (pg_proc): as 4 RPCs fn_ajuda_* existem.
-- Code: desenvolvedor_4_g

-- /dashboard/admin/ajuda-curadoria — Curadoria da ajuda (fila + aplicar + salvar corpo)
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_ajuda_curadoria_listar','fn_ajuda_curadoria_fila','fn_ajuda_curar_aplicar','fn_ajuda_artigo_salvar_corpo']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/admin/ajuda-curadoria'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);

-- /dashboard/anti-fraude — Monitor anti-fraude (leitura cruzada de empresas/grupos/importações)
UPDATE public.system_screens
SET views_consumidas = ARRAY['companies','company_groups','omie_imports','user_companies','users']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/anti-fraude'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
