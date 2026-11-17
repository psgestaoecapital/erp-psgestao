-- RBAC — Willian (FC Pisos, compras@fcpisos.com) faz Compras E Financeiro. O papel hub_compras não tem o
-- subgrupo 'financeiro'; com o gate RBAC por papel ativo (menu = papel ∩ módulo pago), ele perdeu a visão do
-- Financeiro ("de manhã aparecia, de tarde sumiu"). Cria um papel dedicado (Compras + Financeiro) e repõe
-- SOMENTE o Willian nele. A Débora (deborad@) segue em hub_compras, sem Financeiro (menor privilégio / LGPD).
--
-- Provado no dado (RD-38, BEGIN..ROLLBACK): aplicando esta migration, a seção FINANCEIRO no menu da GE do
-- Willian vai de 0 → 15 módulos; a Débora continua em 0; o Willian já enxerga a área gestao_empresarial; a FC
-- Pisos já paga todos os 13 módulos de financeiro da GE (a camada de assinatura não é o gap). Aditivo/idempotente.
--
-- Segurança do banco de testes: rbac_papel e rbac_papel_acesso são referência GLOBAL (sem FK de empresa) — entram
-- em qualquer banco. O UPDATE em user_scope é por (user, company) real: onde o Willian não existe (vagas de teste)
-- casa 0 linhas (no-op, sem FK). Por isso não precisa da guarda "FROM companies WHERE id=…" (não há uuid de empresa
-- gravado como coluna). RD-25 (acesso de cliente) → revisão + MERGE AUTORIZADO.

-- 1) Papel novo (espelha o hub_compras — vertical=hub, camada=especialista, area=compras — com Financeiro incluso).
INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, exige_registro, ativo)
VALUES ('hub_compras_financeiro', 'hub', 'especialista', 'compras',
        'Compras + Financeiro',
        'Compras/suprimentos da obra + acesso ao Financeiro da empresa (perfil admin de compras).', false, true)
ON CONFLICT (slug) DO NOTHING;

-- 2) Acessos = CÓPIA dos do hub_compras (preserva os níveis atuais, incl. Hub/Compliance/compras-cadastros-estoque) + 'financeiro'.
INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel)
SELECT 'hub_compras_financeiro', a.subgrupo, a.nivel
  FROM public.rbac_papel_acesso a
 WHERE a.papel_slug = 'hub_compras'
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel)
VALUES ('hub_compras_financeiro', 'financeiro', 'aprovar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- 3) Repõe SOMENTE o Willian (compras@fcpisos.com) no papel novo. A Débora fica intocada. Idempotente
--    (re-rodar não casa, pois o papel_slug já mudou).
UPDATE public.user_scope
   SET papel_slug = 'hub_compras_financeiro'
 WHERE user_id    = '3edf6251-2810-4405-b8df-163a57e094c3'
   AND company_id = 'b202b50f-37cb-462e-accf-126869de49f0'
   AND papel_slug = 'hub_compras';
