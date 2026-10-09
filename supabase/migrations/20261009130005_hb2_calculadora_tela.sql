-- HB2 · Calculadora de Obra PS: tela no menu do Hub + system_screens + "?" dos campos. Aditiva e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, 'Calculator', '/dashboard/projetos/calculadora', 134, true,
  'Material a comprar de parede de drywall e forro F530, com a conta de cada item.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra'
FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra', 'Material de parede de drywall e forro F530 com a conta de cada item', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.calculadora.sistema', 'O que vai construir', 'Escolha parede de drywall ou forro F530.', 'Define quais materiais e quais regras entram na conta.', 'Parede de drywall para dividir uma sala.', 'Usar parede para calcular um forro: as quantidades ficam erradas.', 10),
 ('projetos.calculadora.comprimento', 'Comprimento', 'Informe o comprimento em metros, com vírgula se precisar.', 'Com o pé-direito (parede) ou a largura (forro), forma a área e o tamanho dos perfis.', '12,5 para uma parede de 12,5 m.', 'Digitar em centímetros: 1250 em vez de 12,5.', 11),
 ('projetos.calculadora.pe_direito', 'Pé-direito', 'Informe a altura do piso ao teto, em metros.', 'Define a bitola e o espaçamento dos montantes pela tabela de faixas.', '2,8 para uma parede de 2,80 m.', 'Medir só até o forro rebaixado em vez do teto onde a parede termina.', 12),
 ('projetos.calculadora.vaos', 'Vãos a descontar', 'Some a área das portas e janelas, em m².', 'Tira da área as aberturas, para não comprar chapa a mais.', 'Porta 0,8 × 2,1 m = 1,68 m².', 'Informar a largura da porta em vez da área.', 13),
 ('projetos.calculadora.largura', 'Largura do ambiente', 'Informe a largura do ambiente em metros.', 'Largura × comprimento dá a área do forro; o perímetro define a tabica.', '4 para um ambiente de 4 m de largura.', 'Trocar largura e comprimento muda só o perímetro, não a área: confira o desenho.', 14),
 ('projetos.calculadora.resultado', 'Material a comprar', 'Nada a preencher: toque em um item para ver a conta.', 'Mostra a quantidade já arredondada para a embalagem de compra.', '27 centos de parafuso, e a conta mostra de onde veio.', 'Comprar pela quantidade bruta: a tela já arredonda para cima.', 15)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
