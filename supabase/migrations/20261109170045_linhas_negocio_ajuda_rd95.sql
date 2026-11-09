-- RD-95 ("?" em todo campo/indicador/ação) · Linhas de negócio (GE) — gap do auditor (tela sem nenhum AjudaCampo):
-- o filtro de período, os 4 cards (Receita total, CM3 consolidado, Margem CM3, Melhor linha) e a ação Configurar
-- ficavam sem explicação, e termos técnicos (CM3, contribuição marginal) sem definição para o usuário.
-- Semeia as 6 chaves de ajuda da tela /dashboard/linhas-negocio. Catálogo de ajuda é metadata de SISTEMA
-- (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING. Não toca cálculo nem dado —
-- só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.linhas.periodo','Linhas de negócio','Período',
 'Escolha o mês que quer analisar. A tela recalcula todos os indicadores e gráficos para o período selecionado.',
 'Define a janela de tempo da análise: receita, margem e health score passam a mostrar os números daquele mês.',
 'Novembro/2026 → a tela mostra a performance das linhas nesse mês.',
 'Comparar meses diferentes olhando a tela duas vezes de memória: troque o período e confira o número ao lado, sem se basear no que lembrava.',
 1,'/dashboard/linhas-negocio','ge','publicado'),
('ge.linhas.receita_total','Linhas de negócio','Receita total',
 'Indicador de leitura (não se preenche). É a soma da receita de todas as linhas de negócio no período.',
 'Mostra o faturamento consolidado do período — o ponto de partida para entender quanto cada linha contribui.',
 'R$ 820.000 somando todas as linhas no mês.',
 'Confundir receita com resultado: receita é o quanto entrou; o que sobra depois dos custos é a contribuição marginal (CM3).',
 2,'/dashboard/linhas-negocio','ge','publicado'),
('ge.linhas.cm3_consolidado','Linhas de negócio','CM3 consolidado',
 'Indicador de leitura. CM3 (margem de contribuição nível 3) é o que sobra da receita depois de tirar os custos e despesas variáveis diretos de cada linha, somado de todas as linhas.',
 'Mostra quanto o conjunto das linhas realmente contribui para cobrir as despesas fixas e gerar lucro — mais fiel que olhar só a receita.',
 'R$ 310.000 de CM3 sobre R$ 820.000 de receita.',
 'Tratar CM3 como lucro final: ele ainda não desconta as despesas fixas/estruturais da empresa.',
 3,'/dashboard/linhas-negocio','ge','publicado'),
('ge.linhas.margem_cm3','Linhas de negócio','Margem CM3',
 'Indicador de leitura. É o CM3 consolidado dividido pela receita total, em porcentagem.',
 'Mede a eficiência do conjunto: de cada R$ 100 de receita, quanto sobra como contribuição marginal. Permite comparar meses mesmo com receitas diferentes.',
 '37,8% = de cada R$ 100 faturados, R$ 37,80 viram contribuição.',
 'Olhar só a margem e esquecer o volume: uma margem alta sobre receita pequena pode gerar menos resultado que uma margem menor sobre receita grande.',
 4,'/dashboard/linhas-negocio','ge','publicado'),
('ge.linhas.melhor_linha','Linhas de negócio','Melhor linha',
 'Indicador de leitura. É a linha de negócio com a maior margem de contribuição (CM3) no período.',
 'Aponta de imediato onde está o melhor retorno — útil para decidir onde investir mais esforço e onde revisar preço ou custo.',
 '"Serviços" como a linha de maior CM3 no mês.',
 'Achar que a melhor linha é sempre a de maior receita: aqui vale a contribuição (CM3), não o faturamento bruto.',
 5,'/dashboard/linhas-negocio','ge','publicado'),
('ge.linhas.configurar','Linhas de negócio','Configurar',
 'Ação (botão). Abre a tela para criar e ajustar suas linhas de negócio e as regras que separam receita e custo em cada uma.',
 'É onde você define quais são as linhas e como os lançamentos são classificados — sem isso a tela não tem o que medir.',
 'Criar as linhas "Serviços", "Produtos" e "Locação" e dizer o que entra em cada uma.',
 'Esperar números na tela sem ter configurado nenhuma linha: primeiro crie as linhas aqui, depois a análise aparece.',
 6,'/dashboard/linhas-negocio','ge','publicado')
ON CONFLICT (chave) DO NOTHING;
