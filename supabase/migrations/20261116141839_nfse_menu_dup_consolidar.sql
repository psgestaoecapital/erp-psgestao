-- PDCA GE · /dashboard/fiscal/nfse · GAP 2 (menu limpo, princípio 3) — auditor_pdca_2 14/11
-- Code: code-desenvolvedor-3
--
-- PROBLEMA (provado no dado, RD-38): duas linhas ATIVAS em module_catalog apontam para a
-- MESMA rota /dashboard/fiscal/nfse, em grupos diferentes e com nomes divergentes:
--   id=fiscal_nfse_emitidas · grupo gestao_empresarial · is_shared=true · nome "NFSes Emitidas"
--   id=pm_fin_nfse          · grupo pm                 · is_shared=false · nome "NFS-e Emitidas"
-- Resultado: a mesma tela aparece 2x no menu (GE e PM), com nomes diferentes -> menu poluído.
--
-- FIX (aditivo + idempotente, sem tocar dado de cliente):
--  1. Mantém a entrada CANÔNICA compartilhada (fiscal_nfse_emitidas).
--  2. Surfaca no P&M via surface_in_groups (inclui 'pm'); a RPC fn_modulos_sidebar_por_area
--     surfaca módulo compartilhado em outra área quando is_shared=true
--     AND surface_in_groups @> ARRAY[area] AND grupo != area -> aparece no menu do P&M.
--  3. Padroniza o nome para "NFS-e Emitidas".
--  4. DESATIVA a duplicata pm_fin_nfse (ativo=false). A RPC do menu só lê ativo=true, então
--     some do menu; a linha fica preservada/reversível (não há DELETE de config).
--
-- Nenhum código referencia pm_fin_nfse por id (só a migration que a criou). module_catalog é
-- configuração global (não é dado de cliente, sem company_id). Idempotente: reexecução grava
-- os mesmos valores.
--
-- PROVA RD-38 (BEGIN/ROLLBACK, antes do PR): após aplicar, a rota tem exatamente 1 linha ativa;
-- fn_modulos_sidebar_por_area('pm',...) surfaca a nfse 1x com nome "NFS-e Emitidas";
-- fn_modulos_sidebar_por_area('gestao_empresarial',...) continua com 1x (sem regressão/duplo);
-- pm_fin_nfse fica com 0 linhas ativas.

-- 1-3) entrada canônica: surfaca no PM, mantém no GE, padroniza o nome
UPDATE public.module_catalog
   SET surface_in_groups = ARRAY['gestao_empresarial','pm']::text[],
       nome = 'NFS-e Emitidas'
 WHERE id = 'fiscal_nfse_emitidas';

-- 4) desativa a duplicata do PM (reversível; some do menu)
UPDATE public.module_catalog
   SET ativo = false
 WHERE id = 'pm_fin_nfse'
   AND ativo = true;
