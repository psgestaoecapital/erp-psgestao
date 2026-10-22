-- HB2 · Calculadora de Obra: textos de ajuda "?" (RD-95) do editor das faixas de pé-direito. Aditiva (só linhas novas de ajuda). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.regra.parede.faixas', 'Faixas de pé-direito (parede)', 'Cadastre as faixas de pé-direito da parede: de quanto a quanto, perfil, espaçamento do montante e se é duplo.', 'Define o perfil e o espaçamento usados na conta de guias, montantes e parafusos conforme a altura da parede.', '2,50 até 2,70 m: M48 a cada 0,40 m.', 'Deixar buraco ou sobrepor faixas: o sistema recusa e avisa qual faixa corrigir.', 60),
 ('projetos.calculadora.regra.parede.faixa.de', 'Faixa — de (m)', 'Informe o pé-direito inicial da faixa, em metros.', 'A faixa vale do pé-direito inicial até o final.', '2,55', 'Usar um valor menor que o fim da faixa anterior.', 61),
 ('projetos.calculadora.regra.parede.faixa.ate', 'Faixa — até (m)', 'Informe o pé-direito final da faixa, em metros.', 'Fecha a faixa; paredes acima dele caem na faixa seguinte.', '2,70', 'Informar valor menor que o "de".', 62),
 ('projetos.calculadora.regra.parede.faixa.bitola', 'Faixa — perfil', 'Escolha a bitola do perfil (M48, M70 ou M90).', 'Define o nome e o item de guia e montante na lista de materiais.', 'M70 para pé-direito de 3,00 m.', 'Escolher perfil sem conferir o limite de altura do fabricante.', 63),
 ('projetos.calculadora.regra.parede.faixa.espacamento', 'Faixa — montante a cada', 'Escolha o espaçamento entre montantes: 0,40 ou 0,60 m.', 'Define quantos montantes e parafusos entram na conta.', '0,40 m para paredes mais altas.', 'Esquecer que 0,40 m usa mais montantes que 0,60 m.', 64),
 ('projetos.calculadora.regra.parede.faixa.duplo', 'Faixa — montante duplo', 'Marque se o montante é duplo nesta faixa.', 'Dobra a quantidade de montantes e usa o parafuso do montante duplo.', 'Marcado para pé-direito acima de 3,30 m.', 'Marcar duplo sem ajustar o espaçamento.', 65),
 ('projetos.calculadora.regra.parede.faixa.adicionar', 'Adicionar faixa', 'Inclui uma linha nova de faixa para você preencher.', 'Permite cobrir mais alturas de pé-direito.', 'Adicionar 4,65 até 5,00 m.', 'Esquecer de salvar depois de adicionar.', 66),
 ('projetos.calculadora.regra.parede.faixa.remover', 'Remover faixa', 'Tira esta faixa da lista (só vale ao salvar).', 'Remove uma altura que a sua empresa não usa.', 'Remover a faixa de 4,10 a 4,15 m.', 'Remover e deixar um buraco: a calculadora avisa pé-direito fora das faixas.', 67)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
