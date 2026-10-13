-- Ativa o módulo Balanço (shell) + cria o módulo Bens & Imobilizado. VINCULA AOS PLANOS.
UPDATE public.module_catalog SET ativo=true, subgrupo='analises', nome='Balanço Patrimonial' WHERE id='balanco_patrimonial';

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, surface_in_groups, diferencial)
VALUES ('ge_bens', 'Bens & Imobilizado', 'gestao_empresarial', 'cadastros',
        '/dashboard/gestao-empresarial/bens', 'Building2', 61, true, false, true, ARRAY['agro']::text[], false)
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo,
  rota=EXCLUDED.rota, icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, legacy=false,
  is_shared=true, surface_in_groups=EXCLUDED.surface_in_groups;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT pl, 'ge_bens', true FROM (VALUES ('v15_gestao_empresarial_pro'),('v15_agro')) AS x(pl)
WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id=x.pl AND pm.module_id='ge_bens');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto) VALUES
  ('feat_ge_bens','ge_bens','operacional','Bens & Imobilizado','Cadastro de bens, depreciação gerencial e baixa/venda.','pronto',100),
  ('feat_balanco_patrimonial','balanco_patrimonial','operacional','Balanço Patrimonial','Balanço completo com origem por linha.','pronto',100)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;
