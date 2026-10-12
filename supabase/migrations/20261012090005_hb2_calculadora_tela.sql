-- Hub HB2 · Calculadora de Obra (fatia 2: tela). Aditiva: textos de ajuda "?" (RD-95) e cadastro da tela em system_screens.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.sistema', 'Sistema', 'Escolha o que vai construir: parede simples de drywall ou forro de gesso F530.', 'Define quais materiais e quais regras entram na conta.', 'Parede simples (drywall)', 'Usar o sistema de forro para calcular uma parede.', 10),
 ('projetos.calculadora.comprimento', 'Comprimento (m)', 'O comprimento da parede, ou do forro, em metros.', 'Entra na área e no tamanho de guias, montantes e perfis.', '12,5', 'Digitar em centímetros (1250) em vez de metros.', 11),
 ('projetos.calculadora.pe_direito', 'Pé-direito (m)', 'A altura do piso ao teto, em metros.', 'Escolhe a bitola e o espaçamento dos montantes e a quantidade de barras.', '2,8', 'Esquecer de descontar o forro: use a altura da parede a levantar.', 12),
 ('projetos.calculadora.vaos', 'Vãos a descontar (m²)', 'A soma da área de portas e janelas da parede, em m².', 'É subtraída da área de chapas, parafusos, massa e fita.', 'Porta 0,8 × 2,1 = 1,68', 'Descontar vão maior que a parede: a calculadora avisa.', 13),
 ('projetos.calculadora.largura', 'Largura (m)', 'A menor medida do ambiente do forro, em metros.', 'Com o comprimento, dá a área e o perímetro da tabica.', '3', 'Trocar metros por centímetros.', 14),
 ('projetos.calculadora.avancado', 'Parâmetros avançados', 'Abra para ver as regras usadas: perda e tamanho da chapa.', 'São valores de referência de mercado, a validar com o fabricante da sua empresa.', 'Perda 1,05', 'Tratar a referência como regra do fabricante sem conferir.', 15),
 ('projetos.calculadora.resultado', 'O que comprar', 'Nada a preencher: é o resultado. Abra "ver a conta" em cada item.', 'Mostra a quantidade real e a unidade de compra, já arredondada para cima.', '33 chapas', 'Comprar a quantidade bruta (com vírgula) sem arredondar para a embalagem.', 16)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.projetos.calculadora', '/dashboard/projetos/calculadora', 'projetos', 'Hub · Calculadora de Obra',
       'Calcula materiais de parede de drywall e forro F530 a partir das medidas, com a conta de cada item.', 'pronto', true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora');
