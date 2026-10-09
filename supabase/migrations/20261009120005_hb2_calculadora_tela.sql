-- HB2 · Calculadora de Obra (tela): "?" dos campos, menu e system_screens. Aditiva e idempotente (sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.calculadora.comprimento', 'Comprimento (m)', 'Comprimento total da parede ou do lado maior do forro, em metros.', 'Base de toda a conta: chapas, perfis e parafusos crescem com ele.', 'Parede de 12,5 m: digite 12,5.', 'Somar duas paredes de pés-direitos diferentes: calcule uma de cada vez.', 10),
 ('projetos.calculadora.largura', 'Largura (m)', 'Lado menor do forro, em metros.', 'Com o comprimento dá a área do forro e o perímetro da tabica.', 'Forro de 3 × 4 m: largura 3.', 'Trocar metros por centímetros.', 11),
 ('projetos.calculadora.pe_direito', 'Pé-direito (m)', 'Altura do piso ao teto da parede, em metros.', 'Define a bitola e o espaçamento dos montantes e se a estrutura é dupla.', '2,8 m usa montante M70 a cada 60 cm.', 'Informar altura fora das faixas cadastradas: a tela avisa.', 12),
 ('projetos.calculadora.vaos', 'Vãos a descontar (m²)', 'Área total de portas e janelas da parede, em m².', 'É descontada da área para não comprar chapa a mais.', 'Porta 0,8 × 2,1 m: digite 1,68.', 'Descontar o vão também no comprimento.', 13),
 ('projetos.calculadora.perda', 'Fator de perda', 'Multiplicador de perda, por padrão 1,05 (5%).', 'Cobre cortes e quebras em todos os itens.', '1,10 para obra com muitos recortes.', 'Digitar 5 em vez de 1,05.', 14)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, 'calculator', '/dashboard/projetos/calculadora', 134, true,
       'Quantidade de material por sistema (parede, forro) com a conta aberta.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra', 'Quantitativo de parede simples e forro F530 com a conta aberta', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
