-- HB2 · Calculadora de Obra: tela no menu do Hub + system_screens + "?" dos campos. Aditiva e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, '🧮', '/dashboard/projetos/calculadora', 134, true,
  'Quantidades de parede e forro de gesso com a conta à vista.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra', 'Parede simples e forro F530 com a conta à vista', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.calculadora.comprimento', 'Comprimento da parede', 'Medida da parede em metros, de ponta a ponta.', 'Define chapas, guias e montantes.', '12,5', 'Somar duas paredes diferentes: calcule uma de cada vez.', 1),
 ('projetos.calculadora.pe_direito', 'Pé-direito', 'Altura do piso ao teto, em metros.', 'Escolhe a bitola e o espaçamento do montante.', '2,8', 'Usar a altura da porta no lugar da altura da parede.', 2),
 ('projetos.calculadora.vao_largura', 'Largura do vão', 'Largura da porta ou janela a descontar, em metros.', 'Reduz a área de chapa e parafuso.', '0,8', 'Deixar o vão de uma porta que existe: sobra material.', 3),
 ('projetos.calculadora.vao_altura', 'Altura do vão', 'Altura da porta ou janela a descontar, em metros.', 'Junto com a largura, tira a área do vão da parede.', '2,1', 'Informar a largura sem a altura: o vão fica zerado.', 4),
 ('projetos.calculadora.largura', 'Largura do forro', 'Menor lado do ambiente, em metros.', 'Com o comprimento, dá a área do forro.', '3', 'Medir até o acabamento, não até a parede de fora.', 5),
 ('projetos.calculadora.comprimento_forro', 'Comprimento do forro', 'Maior lado do ambiente, em metros.', 'Com a largura, dá a área e o perímetro da tabica.', '4', 'Trocar largura por comprimento não muda a conta, mas confunde a conferência.', 6),
 ('projetos.calculadora.area', 'Área considerada', 'Não se preenche: é calculada.', 'Base de todas as quantidades abaixo.', '33,32 m² numa parede 12,5 × 2,8 com porta 0,8 × 2,1.', 'Esquecer que o vão já foi descontado e descontar de novo.', 7)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
