-- RD-95 ("?" em todo indicador) · Saúde Financeira (GE) — gap do aud8 (score 85): 0 AjudaCampo na tela.
-- Semeia as 6 chaves de ajuda da tela /dashboard/financeiro/saude (Classificação geral, Saldo em caixa,
-- Meses de caixa, Inadimplência, Concentração de receita e os Alertas Proativos IA). Catálogo de ajuda é
-- metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.
-- Não toca cálculo nem dado financeiro de cliente — só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('financeiro.saude.classificacao','Saúde Financeira','Classificação geral',
 'Indicador de leitura (não se preenche). É a nota de 0 a 100 que resume a saúde do caixa da empresa no período.',
 'Dá em um olhar o estado geral: verde (saudável), amarelo (atenção) ou vermelho (risco). A nota combina saldo, meses de caixa, inadimplência e concentração de receita.',
 'Nota 96 · "BOA" em verde.',
 'Achar que a nota é de uma conta só: ela é o consolidado de vários indicadores — veja cada card abaixo para entender o que puxa a nota.',
 1,'/dashboard/financeiro/saude','financeiro','publicado'),
('financeiro.saude.saldo_caixa','Saúde Financeira','Saldo em caixa',
 'Indicador de leitura. É a soma do dinheiro disponível hoje nas contas da empresa.',
 'Mostra quanto há em caixa agora — base para pagar contas e decidir investimentos sem apertar o fluxo.',
 'R$ 128.400,00 somando as contas bancárias cadastradas.',
 'Confundir saldo em caixa com lucro: saldo é o dinheiro disponível, não o resultado do período.',
 2,'/dashboard/financeiro/saude','financeiro','publicado'),
('financeiro.saude.meses_caixa','Saúde Financeira','Meses de caixa',
 'Indicador de leitura. Por quantos meses o caixa atual cobre a despesa média mensal se nada mais entrar.',
 'Mede o fôlego da empresa. A partir de 3 meses fica verde; abaixo disso é sinal de atenção para o fluxo.',
 '3,5 m = o caixa cobre cerca de três meses e meio de despesas.',
 'Ignorar o indicador quando está baixo: menos de 1 mês de caixa é risco imediato de não fechar as contas.',
 3,'/dashboard/financeiro/saude','financeiro','publicado'),
('financeiro.saude.inadimplencia','Saúde Financeira','Inadimplência',
 'Indicador de leitura. Quantidade e valor dos títulos a receber já vencidos e não pagos, e o quanto representam da carteira.',
 'Mostra o quanto de receita está preso em atraso — quanto maior, mais caixa deixa de entrar. Use para priorizar cobrança.',
 '4 títulos · R$ 12.300,00 · 6% da carteira.',
 'Olhar só a quantidade e esquecer o valor: poucos títulos de valor alto pesam mais que muitos pequenos.',
 4,'/dashboard/financeiro/saude','financeiro','publicado'),
('financeiro.saude.concentracao','Saúde Financeira','Concentração de receita',
 'Indicador de leitura. Quanto da sua receita vem do maior cliente (o "%" ao lado mostra o nome dele).',
 'Mede a dependência de um único cliente. Acima de 50% é alerta: perder esse cliente abalaria muito o caixa.',
 '38% · Mercado Central = mais de um terço da receita vem de um cliente só.',
 'Deixar a concentração subir sem perceber: quanto mais a receita depende de um cliente, maior o risco se ele sair.',
 5,'/dashboard/financeiro/saude','financeiro','publicado'),
('financeiro.saude.alertas_ia','Saúde Financeira','Alertas Proativos IA',
 'Bloco de leitura. A IA varre seus números (saldo, meses de caixa, inadimplência, concentração) e aponta o que merece atenção, com a ação sugerida.',
 'Antecipa problemas antes de virarem urgência: em vez de você procurar, o sistema avisa o que olhar e o que fazer.',
 '"Meses de caixa abaixo de 2 → reforce a cobrança dos títulos vencidos."',
 'Ignorar os alertas por serem automáticos: eles saem dos seus dados reais e indicam o ponto mais frágil do caixa agora.',
 6,'/dashboard/financeiro/saude','financeiro','publicado')
ON CONFLICT (chave) DO NOTHING;
