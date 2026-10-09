-- HB2 · Calculadora de Obra (fatia 2): "?" da tela e cadastro em system_screens. Aditiva (texto/cadastro novos; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('hub.calculadora.tela', 'Calculadora de obra', 'Escolha parede ou forro e digite as medidas.', 'Calcula chapas, perfis, parafusos e massa a comprar, já com perda e embalagem.', 'Parede de 12,5 m com pé-direito 2,8 m e uma porta.', 'Esquecer de descontar portas e janelas.', 1),
 ('hub.calculadora.comprimento', 'Comprimento', 'Medida da parede (ou do ambiente, no forro), em metros.', 'Define a quantidade de guias, montantes e a área.', '12,5', 'Digitar em centímetros: use metros.', 2),
 ('hub.calculadora.pe_direito', 'Pé-direito', 'Altura da parede, do piso ao teto, em metros.', 'Escolhe a bitola e o espaçamento dos montantes.', '2,8', 'Medir só até o forro rebaixado.', 3),
 ('hub.calculadora.vaos', 'Vãos a descontar', 'Soma da área de portas e janelas, em m².', 'Reduz a área de chapa, parafuso e massa.', 'Porta 0,8 × 2,1 = 1,68', 'Descontar vão que também será fechado com chapa.', 4),
 ('hub.calculadora.largura', 'Largura do ambiente', 'Outra medida do forro, em metros.', 'Com o comprimento dá a área e o perímetro (tabica).', '4', 'Trocar largura por área.', 5),
 ('hub.calculadora.resultado', 'O que comprar', 'Nada a preencher.', 'Mostra cada material na unidade de compra, sempre arredondado para cima; “Ver a conta” abre a conta.', 'Chapa: 12 chapas', 'Tratar como orçamento fechado: confira com o fabricante.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.projetos.calculadora', '/dashboard/projetos/calculadora', 'projetos', 'Hub · Calculadora de obra',
       'Calcula o material de parede simples e forro F530 a partir das medidas, com a conta aberta em cada item.', 'pronto', true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora');
