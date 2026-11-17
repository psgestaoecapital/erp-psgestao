-- RD-95: "?" nas seções analíticas da tela /dashboard/analises (Gestão Empresarial).
-- O auditor apontou cobertura insuficiente de ajuda num dashboard com vários gráficos, drill-panels
-- e indicadores — só os filtros/abas tinham "?". Esta PR adiciona o "?" nas 7 seções analíticas
-- principais (gráfico Receitas×Despesas×Resultado, Fluxo de Caixa, Balanço, Indicadores
-- Fundamentalistas, Estrutura/Mapa de Custos, Receitas por Categoria), via o componente Tit que passou
-- a aceitar `ajuda`. Aditiva/idempotente: só insere/atualiza chaves de ajuda; nada de RLS/cálculo/dado
-- de cliente. Faixa desenvolvedor_4_g (segundos :45). RD-100: termos genéricos ("sistema de origem").

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('analises.grafico_rec_desp', '/dashboard/analises', 'Análises', 'Receitas × Despesas × Resultado',
   'Leitura, não preenchimento: o gráfico compara, mês a mês, o que entrou (receitas), o que saiu (despesas) e a diferença (resultado) no período filtrado.',
   'Mostra se o negócio gerou ou consumiu caixa em cada mês — barras de receita acima das de despesa indicam resultado positivo; a linha/barra de resultado resume a sobra ou falta.',
   'Ex.: em um mês com receita 100k e despesa 80k, o resultado aparece em +20k.',
   'Ler um mês isolado e concluir tendência: compare a sequência de meses para ver se melhora ou piora.',
   'financeiro', 40, 'publicado'),
  ('analises.fluxo_caixa', '/dashboard/analises', 'Análises', 'Fluxo de Caixa — Projeção Diária',
   'Leitura: projeção diária do saldo de caixa a partir das contas a receber e a pagar já lançadas no período e empresas filtradas.',
   'Antecipa dias de aperto (saldo projetado baixo ou negativo) para você agir antes — adiar uma compra, cobrar um recebível ou negociar prazo.',
   'Ex.: se no dia 20 o saldo projetado fica negativo, antecipe um recebimento ou adie um pagamento até lá.',
   'Confiar na projeção com títulos sem data de vencimento correta: lance os vencimentos certos para a curva refletir a realidade.',
   'financeiro', 41, 'publicado'),
  ('analises.balanco', '/dashboard/analises', 'Análises', 'Balanço Patrimonial',
   'Leitura: retrato do que a empresa tem (ativos), deve (passivos) e do patrimônio líquido na data, a partir dos dados do sistema de origem.',
   'Mostra a solidez patrimonial — se os bens e direitos cobrem as obrigações e quanto sobra de patrimônio próprio.',
   'Ex.: ativo total 500k, passivo 300k → patrimônio líquido de 200k.',
   'Comparar o balanço de períodos com bases de dados diferentes: use a mesma origem e período para a comparação valer.',
   'financeiro', 42, 'publicado'),
  ('analises.indicadores', '/dashboard/analises', 'Análises', 'Indicadores Fundamentalistas',
   'Leitura: índices calculados a partir do balanço e do resultado (liquidez, endividamento, margens, rentabilidade) do período filtrado.',
   'Traduz os números em sinais de saúde financeira — compara a empresa com ela mesma ao longo do tempo e com referências de mercado.',
   'Ex.: liquidez corrente acima de 1 indica que o ativo de curto prazo cobre as dívidas de curto prazo.',
   'Olhar um indicador sozinho: leia o conjunto — uma margem alta com endividamento alto pede atenção.',
   'financeiro', 43, 'publicado'),
  ('analises.estrutura_custos', '/dashboard/analises', 'Análises', 'Estrutura de Custos por Grupo',
   'Leitura: distribuição das despesas do período por grupo de custo, do maior para o menor.',
   'Revela onde o dinheiro está indo e quais grupos pesam mais — ponto de partida para cortar ou renegociar.',
   'Ex.: se "Pessoal" concentra 60% dos custos, é ali que pequenas melhorias têm maior efeito.',
   'Focar num grupo pequeno enquanto os maiores passam sem revisão: ataque primeiro os grupos de maior peso.',
   'financeiro', 44, 'publicado'),
  ('analises.mapa_custos', '/dashboard/analises', 'Análises', 'Mapa de Custos',
   'Leitura: detalhamento dos custos; clique num grupo para expandir e ver as contas que o compõem.',
   'Permite descer do total do grupo até a conta específica, para achar o lançamento que explica uma variação.',
   'Ex.: o grupo "Serviços" subiu — expanda para ver qual fornecedor/conta puxou o aumento.',
   'Concluir sem expandir: o total do grupo esconde a conta responsável; abra o grupo para enxergar a causa.',
   'financeiro', 45, 'publicado'),
  ('analises.receitas_categoria', '/dashboard/analises', 'Análises', 'Análise de Receitas por Categoria',
   'Leitura: receitas do período agrupadas por categoria, ordenadas por valor, com o % que cada uma representa do total.',
   'Mostra de onde vem o faturamento e a dependência de poucas categorias — útil para decidir onde investir ou diversificar.',
   'Ex.: se uma única categoria responde por 70% da receita, a concentração é um risco a monitorar.',
   'Ignorar categorias pequenas em crescimento: acompanhe a evolução, não só o tamanho atual.',
   'financeiro', 46, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
