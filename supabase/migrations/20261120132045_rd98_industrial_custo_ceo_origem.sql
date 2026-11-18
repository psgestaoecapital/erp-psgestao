-- RD-98 p3 · origem do dado (auditor): duas telas industriais estavam com views_consumidas = NULL e
--   rpcs_chamadas = NULL em system_screens. Registra a origem do dado (provada no código + banco).
--
-- Fontes reais das telas (prova no código, RD-38):
--   /dashboard/custo -> src/app/dashboard/custo/page.tsx + src/app/api/industrial/custos/route.ts
--     * LEITURA: tabela custos_industriais (.from('custos_industriais') na API) — custos industriais da empresa.
--     * OBS: a page tenta supabase.from('empresas') (L64) para o seletor de empresa, mas a relação
--       'empresas' NÃO existe em nenhum schema (conferido em pg_class) — chamada morta cujo erro é
--       ignorado no destructuring { data }. NÃO entra em views_consumidas (RD-38: só o que existe).
--       Fica registrado aqui para o dev da vertical corrigir o seletor (fora do escopo deste metadado).
--   /dashboard/industrial/ceo -> src/app/dashboard/industrial/ceo/page.tsx
--       consome /api/industrial/bovinos/kpis e /api/industrial/unidades, que leem:
--     * LEITURA: tabelas ind_alertas_ceo, ind_kpis_diarios, ind_unidades.
--
-- As 4 tabelas registradas foram conferidas existentes em produção (pg_class). Nenhuma das telas chama RPC.
--
-- Correção corretiva e idempotente: só metadado de registro da tela (origem do dado). NÃO toca RLS,
-- grants, dado de cliente, nem comportamento. UPDATE determinístico (guardado por origem vazia),
-- 2x = mesmo resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['custos_industriais']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/custo'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
   SET views_consumidas = ARRAY['ind_alertas_ceo','ind_kpis_diarios','ind_unidades']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/industrial/ceo'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
