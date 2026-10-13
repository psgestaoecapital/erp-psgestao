-- ============================================================
-- Ramo de obra · desambiguar 2.04.02 vs 2.02 "Mão de Obra Direta" (pedido do CEO)
-- ============================================================
-- O template global tem 2.02 "Mão de Obra Direta" (CMV industrial) e o ramo novo trouxe
-- 2.04.02 "Mão de Obra de Obra" — parecidas o bastante para quem classifica errar. Renomeia
-- 2.04.02 para "Pessoal de Obra" (tira "Mão de Obra" e mata a colisão). Toca a conta GLOBAL
-- (company_id NULL) e a cópia já aplicada na FC. Idempotente (só age no nome antigo).
UPDATE public.erp_plano_contas
   SET descricao = 'Pessoal de Obra'
 WHERE codigo = '2.04.02' AND descricao = 'Mão de Obra de Obra';

-- mantém coerente o rótulo do de-para de obra da FC (não muda o mapeamento 4.3)
UPDATE public.psgc_depara
   SET origem_descricao = 'Pessoal de Obra'
 WHERE origem_codigo = '2.04.02' AND origem_descricao = 'Mão de Obra de Obra';
