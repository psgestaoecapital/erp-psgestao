-- PDCA GE SISTÊMICO · module_catalog · 9 rotas de NÚCLEO com linha pm_* DUPLICADA para a MESMA rota
-- Code: code-desenvolvedor-3 · auditor_pdca_2 16/11 (guarda-chuva CEO 8f38b9be) · Princ.1 (núcleo universal) + Princ.3 (menu limpo)
--
-- PROBLEMA (provado no dado, RD-38): 9 rotas de NÚCLEO têm 2 linhas ATIVAS em module_catalog cada — a
-- canônica (grupo gestao_empresarial / erp_core) e uma DUPLICATA no grupo 'pm', mesma rota, mesmo item:
--   rota                                   | canônica (núcleo)                | duplicata pm (desativar)
--   ---------------------------------------+----------------------------------+--------------------------
--   /dashboard/cadastros/clientes          | ge_cadastros_clientes            | pm_cadastro_clientes
--   /dashboard/cadastros/contas-bancarias  | ge_cadastros_contas_bancarias    | pm_fin_contas_banco
--   /dashboard/cadastros/fornecedores      | ge_cadastros_fornecedores        | pm_fin_fornecedores
--   /dashboard/financeiro/dre-consolidado  | dre_consolidado [erp_core]       | pm_fin_dre
--   /dashboard/financeiro/fluxo-caixa      | financeiro_fluxo_caixa_ge        | pm_fin_fluxo_caixa
--   /dashboard/financeiro/inadimplentes    | financeiro_inadimplentes_ge      | pm_fin_inadimplentes
--   /dashboard/financeiro/pagar            | financeiro_listagem_pagar        | pm_fin_pagar
--   /dashboard/financeiro/receber          | financeiro_listagem_receber      | pm_fin_receber
--   /dashboard/fiscal/nfe-recebidas        | fiscal_nfe_recebidas             | pm_fin_nfe_receb
-- Empresa com GE e P&M vê o item 2x (uma linha específica da vertical para uma rota de núcleo) — fere
-- Princ.1 (núcleo não pode ter entrada específica de vertical) e Princ.3 (menu limpo). Continua o esforço
-- já aplicado para conciliacao (20261117120140), nfse (20261117120240) e produtos/linhas-negocio.
--
-- DECISÃO: Opção (A) consolidar — MESMO PADRÃO JÁ ACEITO (aud8 95/95) das migrations acima:
--   1) a canônica surfaça no P&M via surface_in_groups (is_shared=true AND surface_in_groups @> ARRAY['pm']
--      AND grupo != 'pm' → a RPC fn_modulos_sidebar_por_area emite 1 item no menu do P&M), acrescentando 'pm'
--      e preservando as áreas atuais de cada canônica;
--   2) DESATIVA (ativo=false) as 9 duplicatas pm_*. A RPC do menu só lê ativo=true → somem do menu. Linhas
--      preservadas e reversíveis (sem DELETE de config). Nenhum código em src/ referencia esses ids por id
--      (só as migrations que os criaram).
-- As canônicas já têm is_shared=true e ramos_aplicaveis=NULL (sem restrição de ramo) → o P&M enxerga o item
-- exatamente como enxergava pela linha nativa pm_*, sem regressão. Alinhado a Princ.1: 1 entrada de núcleo.
--
-- module_catalog é configuração GLOBAL (sem company_id, não é dado de cliente). Aditivo/idempotente:
-- reexecução grava os mesmos valores. Nada de UPDATE/DELETE em dado de cliente.
--
-- PROVA RD-38 (BEGIN/ROLLBACK, statement_timeout curto, contra o schema de produção, antes do PR):
--   • raw module_catalog ativos por rota (as 9): ANTES 2 → DEPOIS 1 (dedup, sobra só a canônica).
--   • fn_modulos_sidebar_por_area('pm', NULL, NULL)  por rota: ANTES 1 → DEPOIS 1 (P&M continua vendo, 1x).
--   • fn_modulos_sidebar_por_area('gestao_empresarial', NULL, NULL) por rota: ANTES 1 → DEPOIS 1 (GE intacto).
--   Nenhuma área fica com 0 (sem regressão) e nenhuma rota fica com 2 linhas ativas (dedup). Tudo desfeito (ROLLBACK).

-- 1) garante is_shared nas canônicas (pré-requisito do surface; todas já são true — idempotente)
UPDATE public.module_catalog
   SET is_shared = true
 WHERE id IN (
   'ge_cadastros_clientes','ge_cadastros_contas_bancarias','ge_cadastros_fornecedores','dre_consolidado',
   'financeiro_fluxo_caixa_ge','financeiro_inadimplentes_ge','financeiro_listagem_pagar',
   'financeiro_listagem_receber','fiscal_nfe_recebidas')
   AND is_shared = false;

-- 2) acrescenta 'pm' à cobertura de cada canônica (preserva as áreas atuais; valores finais explícitos = idempotente)
UPDATE public.module_catalog SET surface_in_groups = ARRAY['pm']::text[]                                                  WHERE id = 'ge_cadastros_clientes';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['pm']::text[]                                                  WHERE id = 'ge_cadastros_contas_bancarias';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['pm']::text[]                                                  WHERE id = 'ge_cadastros_fornecedores';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['custeio_a','bpo','gestao_empresarial','commerce','pm']::text[] WHERE id = 'dre_consolidado';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['gestao_empresarial','pm']::text[]                             WHERE id = 'financeiro_fluxo_caixa_ge';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['gestao_empresarial','pm']::text[]                             WHERE id = 'financeiro_inadimplentes_ge';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['pm']::text[]                                                  WHERE id = 'financeiro_listagem_pagar';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['pm']::text[]                                                  WHERE id = 'financeiro_listagem_receber';
UPDATE public.module_catalog SET surface_in_groups = ARRAY['gestao_empresarial','pm']::text[]                             WHERE id = 'fiscal_nfe_recebidas';

-- 3) DESATIVA as 9 duplicatas pm_* (reversível; somem do menu, nenhuma rota perde o item pela canônica surfaçada)
UPDATE public.module_catalog
   SET ativo = false
 WHERE id IN (
   'pm_cadastro_clientes','pm_fin_contas_banco','pm_fin_fornecedores','pm_fin_dre','pm_fin_fluxo_caixa',
   'pm_fin_inadimplentes','pm_fin_pagar','pm_fin_receber','pm_fin_nfe_receb')
   AND ativo = true;
