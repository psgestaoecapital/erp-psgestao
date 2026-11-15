-- PDCA GE · /dashboard/fiscal/nfse · GAP único (menu limpo, princípio 3 + RD-98 p1) — auditor_pdca_2 15/11
-- Code: code-desenvolvedor-3
--
-- PROBLEMA (provado no dado, RD-38): DUAS entradas "NFS-e" ATIVAS em module_catalog, uma delas TELA MORTA:
--   id=fiscal_nfse_emitidas · rota /dashboard/fiscal/nfse   · "NFS-e Emitidas" · CANÔNICA/REAL (48 NFS-e reais,
--        lista + emissão via NFSeEmitirGovModal, aud8 95/95, is_shared=true, surface_in_groups {gestao_empresarial,pm})
--   id=services_nfse        · rota /dashboard/services/nfse · "NFS-e"          · PLACEHOLDER <ModuloEmConstrucao>
--        ("em construção · Q3 2026"), SEM registro em system_screens, porém ATIVO no menu e surfaçando em
--        {custeio_a,bpo,services,commerce}. A emissão que ele "promete" JÁ EXISTE na tela canônica → 100% redundante.
-- Resultado hoje: o usuário vê 2 itens "NFS-e" (um que não faz nada) e se confunde.
--
-- FIX (aditivo + idempotente, sem tocar dado de cliente):
--  1. Acrescenta à cobertura da CANÔNICA os grupos onde a placeholder aparecia ({custeio_a,bpo,services,commerce}),
--     preservando os atuais ({gestao_empresarial,pm}). Como fiscal_nfse_emitidas é is_shared=true, a RPC
--     fn_modulos_sidebar_por_area passa a mostrar a tela REAL nesses menus — sem regressão (princípio 5):
--     nenhuma área perde o item de NFS-e, ela só passa a apontar para a emissão que funciona.
--  2. DESATIVA (ativo=false) a entrada morta services_nfse. A ROTA /dashboard/services/nfse permanece no código
--     como stub de redirect 308 → /dashboard/fiscal/nfse (next.config.ts + page.tsx), defesa em profundidade para
--     deep-links/bookmarks (query string preservada). Linha preservada/reversível (não há DELETE de config).
--
-- module_catalog é configuração GLOBAL (não tem company_id, não é dado de cliente). A RPC do menu só lê
-- ativo=true, então a duplicata some do menu. Idempotente: reexecução grava os mesmos valores.
--
-- PROVA RD-38 (BEGIN/ROLLBACK, antes do PR) — fn_modulos_sidebar_por_area(area, NULL, NULL), itens NFS-e
-- (modulo_id ∈ {services_nfse, fiscal_nfse_emitidas}), ANTES -> DEPOIS:
--   gestao_empresarial 1(fiscal) -> 1(fiscal)   pm 1(fiscal) -> 1(fiscal)
--   custeio_a 1(services) -> 1(fiscal)   bpo 1(services) -> 1(fiscal)
--   services 1(services) -> 1(fiscal)   commerce 1(services) -> 1(fiscal)
-- Nenhuma área fica com 0 (sem regressão); a placeholder sai e dá lugar à tela canônica em todo menu.

-- 1) canônica passa a surfaçar também nos grupos onde a placeholder aparecia (preserva os atuais)
UPDATE public.module_catalog
   SET surface_in_groups = ARRAY['gestao_empresarial','pm','custeio_a','bpo','services','commerce']::text[]
 WHERE id = 'fiscal_nfse_emitidas';

-- 2) desativa a entrada morta (reversível; some do menu, rota de redirect 308 segue no código)
UPDATE public.module_catalog
   SET ativo = false
 WHERE id = 'services_nfse' AND ativo = true;
