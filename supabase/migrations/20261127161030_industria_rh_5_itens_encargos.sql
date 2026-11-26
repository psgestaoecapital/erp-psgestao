-- =====================================================================
-- feat(indústria/rh): RH em 5 itens (Painel, Pessoas, Postos e vagas, Ponto, Folha) + encargos padrão 36,5% editável
-- DECISÃO DO CEO (25/11). module_catalog/system_screens/erp_encargos_empresa NÃO são tabela de domínio (RD-97 ok).
--
-- (1) MENU — subgrupo recursos_humanos fica com EXATAMENTE 5 itens, nesta ordem. Nada é apagado (RD-30): os
--     outros 5 itens saem do menu (ativo=false) e as rotas antigas redirecionam para a aba nova (no front).
--       1 Painel de RH   → /dashboard/industrial/rh/bi      (reusa industrial_rh_bi)
--       2 Pessoas        → /dashboard/industrial/rh/pessoas (reusa industrial_rh_pessoas)
--       3 Postos e vagas → /dashboard/produtividade         (reusa produtividade)
--       4 Ponto          → /dashboard/industrial/ponto      (reusa industrial_ponto_eletronico)
--       5 Folha          → /dashboard/industrial/folha      (reusa industrial_folha_pagamento)
--     Saem do menu: industrial_rh_quadro, industrial_rh_importar_quadro, industrial_rh_vagas, industrial_mao_obra,
--     industrial_rh_painel. 5W2H: mantém só plano_acao_5w2h (compartilhado); industrial_plano_acao sai.
-- =====================================================================

-- 5 itens que FICAM (renomeia + reordena 1..5)
UPDATE public.module_catalog SET nome = 'Painel de RH',   ordem = 1, ativo = true WHERE id = 'industrial_rh_bi';
UPDATE public.module_catalog SET nome = 'Pessoas',        ordem = 2, ativo = true WHERE id = 'industrial_rh_pessoas';
UPDATE public.module_catalog SET nome = 'Postos e vagas', ordem = 3, ativo = true WHERE id = 'produtividade';
UPDATE public.module_catalog SET nome = 'Ponto',          ordem = 4, ativo = true WHERE id = 'industrial_ponto_eletronico';
UPDATE public.module_catalog SET nome = 'Folha',          ordem = 5, ativo = true WHERE id = 'industrial_folha_pagamento';

-- itens que SAEM do menu (viram aba; rota antiga redireciona no front). NÃO apaga (RD-30).
UPDATE public.module_catalog SET ativo = false
 WHERE id IN ('industrial_rh_quadro','industrial_rh_importar_quadro','industrial_rh_vagas','industrial_mao_obra','industrial_rh_painel','industrial_plano_acao');

-- system_screens: alinha o título das 5 telas que ficam (as que saem permanecem, RD-30).
UPDATE public.system_screens SET titulo = 'Painel de RH',   atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/bi';
UPDATE public.system_screens SET titulo = 'Pessoas',        atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/pessoas';
UPDATE public.system_screens SET titulo = 'Postos e vagas', atualizado_em = now() WHERE rota = '/dashboard/produtividade';
UPDATE public.system_screens SET titulo = 'Ponto',          atualizado_em = now() WHERE rota = '/dashboard/industrial/ponto';
UPDATE public.system_screens SET titulo = 'Folha',          atualizado_em = now() WHERE rota = '/dashboard/industrial/folha';

-- =====================================================================
-- (3) ENCARGOS sobre a folha — padrão 36,5% editável por empresa (DECISÃO DO CEO).
--   (i)  ANTES de baixar a reserva, grava 36,8% (breakdown presumido: 20 + 3 + 5,8 + 8) em erp_encargos_empresa
--        para as 2 empresas que têm ficha de mão de obra e NÃO têm encargo salvo (Tryo Gesso; DEMO Comércio),
--        para o custo delas NÃO mudar. [Única alteração de dado de cliente autorizada pelo CEO.] Prova RD-38 na PR.
--   (ii) fn_mao_obra_custo_calcular: reserva de encargos_folha_pct de 36.8 → 36.5 (única mudança no corpo).
-- =====================================================================

-- (i) seed 36,8% só para empresa com ficha e sem encargo salvo (idempotente: só insere se não existir)
INSERT INTO public.erp_encargos_empresa
  (company_id, vigencia_inicio, regime, inss_patronal_pct, rat_pct, fap, terceiros_pct, fgts_pct,
   desoneracao, desoneracao_fator_folha, prov_13_pct, prov_ferias_pct, prov_rescisao_pct, observacao)
SELECT DISTINCT m.company_id, DATE '2020-01-01',
   CASE WHEN lower(coalesce(c.regime_tributario,'')) LIKE '%simples%' THEN 'simples'
        WHEN lower(coalesce(c.regime_tributario,'')) LIKE '%real%' THEN 'real' ELSE 'presumido' END,
   20, 3, 1, 5.8, 8, false, 1, 8.33, 11.11, 4,
   'Encargo preservado em 36,8% ao baixar a reserva padrão para 36,5% (CEO 25/11). Edite em Folha › Encargos.'
FROM public.erp_mao_obra_custo m
JOIN public.companies c ON c.id = m.company_id
WHERE NOT EXISTS (SELECT 1 FROM public.erp_encargos_empresa e WHERE e.company_id = m.company_id);

-- (ii) fn_mao_obra_custo_calcular — reserva de encargos_folha_pct 36.8 → 36.5. Troca CIRÚRGICA no fonte VIVO
--      (', 36.8)' é único na função, conferido) para não reescrever o cálculo inteiro e não errar nenhuma linha.
--      Falha alto se a reserva deixar de ser única (a função mudou): aí a migration precisa ser revista.
DO $do$
DECLARE v_src text; v_n int;
BEGIN
  v_src := pg_get_functiondef('public.fn_mao_obra_custo_calcular(jsonb,jsonb)'::regprocedure);
  v_n := (length(v_src) - length(replace(v_src, ', 36.8)', ''))) / length(', 36.8)');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fn_mao_obra_custo_calcular: reserva 36.8 nao e unica (% ocorrencias) — revise a migration', v_n;
  END IF;
  EXECUTE replace(v_src, ', 36.8)', ', 36.5)');
END $do$;
