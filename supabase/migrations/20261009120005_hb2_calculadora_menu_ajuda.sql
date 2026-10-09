-- HB2 · Calculadora de Obra (fatia 2): item de menu + system_screens + "?" dos campos. Aditiva e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, '🧮', '/dashboard/projetos/calculadora', 134, true,
  'Quantidade de material por unidade de compra, com a conta aberta (parede simples e forro F530).', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra', 'Materiais por unidade de compra com a conta aberta (parede simples, forro F530)', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.calculadora.comprimento', 'Comprimento da parede', 'O comprimento total da parede em metros.', 'Define guias, montantes e banda acústica.', '12,5 para uma parede de 12,5 m.', 'Somar duas paredes diferentes: calcule uma de cada vez.', 10),
 ('projetos.calculadora.pe_direito', 'Pé-direito', 'A altura do piso ao teto em metros.', 'Escolhe o tipo de perfil e o espaçamento dos montantes.', '2,8 para pé-direito de 2,80 m.', 'Digitar em centímetros (280): use metros.', 11),
 ('projetos.calculadora.vaos', 'Vãos a descontar', 'A área em m² de portas e janelas da parede.', 'Reduz a área de chapa, parafuso e massa.', 'Porta de 0,8 × 2,1 m = 1,68.', 'Descontar o vão duas vezes ou esquecer de descontar.', 12),
 ('projetos.calculadora.largura', 'Largura do ambiente', 'A menor medida do ambiente em metros.', 'Com o comprimento, dá a área do forro.', '3 para um ambiente de 3 m.', 'Medir até a parede revestida e não até o vão do piso.', 13),
 ('projetos.calculadora.comprimento_forro', 'Comprimento do ambiente', 'A maior medida do ambiente em metros.', 'Define a área e o perímetro da tabica.', '4 para um ambiente de 4 m.', 'Trocar com a largura: o resultado é o mesmo, mas confira a planta.', 14)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
