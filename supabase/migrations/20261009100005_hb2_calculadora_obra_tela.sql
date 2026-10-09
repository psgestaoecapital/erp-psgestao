-- HB2 · Calculadora de Obra (tela): menu (module_catalog), planos, system_screens e "?" dos campos. Aditivo e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, '🧮', '/dashboard/projetos/calculadora', 134, true,
       'Lista de materiais por sistema (parede, forro) com a conta de cada item.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra'
FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra', 'Lista de materiais por sistema construtivo, com a conta de cada item', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.sistema', 'Sistema', 'Escolha o sistema construtivo: parede simples ou forro F530.', 'Define quais materiais entram e com quais coeficientes.', 'Parede simples (1 chapa por face).', 'Calcular um forro com o sistema de parede: os materiais não batem.', 1),
 ('projetos.calculadora.comprimento', 'Comprimento', 'Comprimento total, em metros, do trecho a executar.', 'Base para chapas, guias e montantes.', '12,5 para uma parede de 12,5 m.', 'Digitar em centímetros (1250) em vez de metros.', 2),
 ('projetos.calculadora.altura', 'Pé-direito / largura', 'Na parede, o pé-direito; no forro, a largura, ambos em metros.', 'Escolhe a faixa de montantes e dá a área junto com o comprimento.', '2,8 m de pé-direito.', 'Pé-direito fora das faixas cadastradas: a conta avisa em vez de chutar.', 3),
 ('projetos.calculadora.vaos', 'Vãos a descontar', 'Soma da área de portas e janelas, em m².', 'Tira os vãos da área de chapas, lã, massa e fita.', 'Porta 0,8 × 2,1 m = 1,68 m².', 'Esquecer de descontar a porta e comprar chapa a mais.', 4),
 ('projetos.calculadora.chapa', 'Área da chapa', 'Área de uma chapa, em m² (padrão 1,2 × 1,8 m = 2,16).', 'Converte m² de chapa em unidades de compra.', '2,16 para chapa 1,2 × 1,8 m.', 'Usar a medida em metros lineares em vez de m².', 5),
 ('projetos.calculadora.perda', 'Fator de perda', 'Multiplicador de perda: 1,05 = 5% a mais.', 'Cobre cortes e quebras nos itens que sofrem perda.', '1,05 (referência de mercado a validar).', 'Digitar 5 em vez de 1,05.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
