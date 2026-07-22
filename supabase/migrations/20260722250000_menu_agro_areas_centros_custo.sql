-- Cadastra as 2 telas do #749 no menu do Agro + VINCULA AO PLANO (senão somem do menu,
-- como aconteceu com ge_cadastros_servicos que estava em zero planos). Rota já em produção (#749).
-- Também: Custo da @ -> "Custo de Produção" + badge PRONTO (motor entregue no #748).

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, diferencial)
VALUES
  ('agro_areas_propriedade', 'Áreas da Propriedade', 'agro', 'pecuaria', '/dashboard/agro/areas', 'Map', 10, true, false, false, false),
  ('agro_centros_custo', 'Centros de Custo', 'agro', 'pecuaria', '/dashboard/agro/centros-custo', 'Target', 11, true, false, false, false)
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, legacy=false;

-- vínculo ao plano v15_agro (o mesmo dos 9 módulos de pecuária) — passo CRÍTICO
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT 'v15_agro', m.module_id, true
FROM (VALUES ('agro_areas_propriedade'),('agro_centros_custo')) AS m(module_id)
WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id='v15_agro' AND pm.module_id=m.module_id);

-- badge PRONTO
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES
  ('feat_agro_areas_propriedade', 'agro_areas_propriedade', 'operacional', 'Áreas da Propriedade', 'Cadastro genérico de áreas da propriedade (pastagem, lavoura, etc.) + rateio calculado por driver.', 'pronto', 100),
  ('feat_agro_centros_custo', 'agro_centros_custo', 'operacional', 'Centros de Custo', 'Mapeamento de centro de custo → tipo de apropriação + linha de negócio.', 'pronto', 100)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;

-- Custo da @ -> "Custo de Produção" + PRONTO (#748)
UPDATE public.module_catalog SET nome='Custo de Produção' WHERE id='agro_pec_financeiro';
UPDATE public.feature_catalog SET status='pronto', percentual_pronto=100 WHERE module_id='agro_pec_financeiro';
