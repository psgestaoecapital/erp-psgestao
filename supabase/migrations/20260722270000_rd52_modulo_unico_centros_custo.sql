-- Módulo ÚNICO de Centros de Custo, sob GE, shared em GE+agro. Aposenta os 2 duplicados.
-- (centro de custo é conceito de Gestão Empresarial, não exclusivo do agro).
UPDATE public.module_catalog SET ativo=false WHERE id IN ('ge_prev_centros_custo','agro_centros_custo');

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, surface_in_groups, diferencial)
VALUES ('ge_centros_custo', 'Centros de Custo', 'gestao_empresarial', 'cadastros',
        '/dashboard/gestao-empresarial/centros-custo', 'Target', 60, true, false, true, ARRAY['agro']::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, legacy=false, is_shared=true, surface_in_groups=EXCLUDED.surface_in_groups;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT pl, 'ge_centros_custo', true
FROM (VALUES ('v15_gestao_empresarial_pro'),('v15_agro')) AS x(pl)
WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id=x.pl AND pm.module_id='ge_centros_custo');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES ('feat_ge_centros_custo', 'ge_centros_custo', 'operacional', 'Centros de Custo',
        'Mapeamento de centro de custo → tipo de apropriação + linha de negócio + lote. Cadastro manual prévio.', 'pronto', 100)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;

DELETE FROM public.feature_catalog WHERE module_id='agro_centros_custo';
