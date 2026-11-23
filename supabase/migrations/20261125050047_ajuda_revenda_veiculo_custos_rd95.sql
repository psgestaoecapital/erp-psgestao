-- RD-95: ajuda "?" dos campos do formulário de custos do veículo (/dashboard/revenda/veiculo/[id]/custos).
-- Aditiva e idempotente: insere só as 6 chaves novas (categoria, descrição, fornecedor, data, gerar título,
-- vencimento) se ainda não existirem. O campo "valor" já tinha o "?" (revenda.veiculo.custos.valor).
-- A rota segue a convenção já usada nesta tela pelo campo valor: '/dashboard/revenda/veiculo/custos'.
-- Não altera estrutura, RLS nem dado de cliente — erp_ajuda_campo é catálogo global de texto de ajuda.
-- Prova RD-38: SELECT ... WHERE rota='/dashboard/revenda/veiculo/custos' = 1 linha antes (valor); 7 depois.
-- Code: rodrigo-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'revenda.veiculo.custos.categoria', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Categoria do custo',
    'Escolha o tipo do gasto deste veículo (ex.: mecânica, funilaria, documentação, aquisição).',
    'Agrupa os custos por tipo para somar o investimento no veículo e calcular a margem na revenda.',
    'Mecânica',
    'Jogar tudo em uma só categoria — assim fica difícil ver onde o dinheiro foi gasto.',
    'revenda', 1
  ),
  (
    'revenda.veiculo.custos.descricao', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Descrição',
    'Descreva em poucas palavras o que foi esse custo.',
    'Identifica o gasto na lista de custos do veículo e no título gerado em contas a pagar.',
    'Troca de pastilhas de freio',
    'Deixar só "serviço" — descreva para reconhecer o custo depois.',
    'revenda', 3
  ),
  (
    'revenda.veiculo.custos.fornecedor', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Fornecedor',
    'Nome de quem prestou o serviço ou vendeu a peça (opcional).',
    'Mostra de quem foi o gasto e, quando gera título, identifica o favorecido em contas a pagar.',
    'Auto Peças Central',
    'Preencher com o nome do cliente em vez do fornecedor do custo.',
    'revenda', 4
  ),
  (
    'revenda.veiculo.custos.data', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Data do custo',
    'Informe o dia em que o custo aconteceu.',
    'Posiciona o gasto na linha do tempo do veículo e é a competência do título quando ele é gerado.',
    '15/11/2026',
    'Usar a data de hoje para um gasto antigo — a competência fica errada.',
    'revenda', 5
  ),
  (
    'revenda.veiculo.custos.gerar_titulo', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Gerar título em contas a pagar',
    'Marque se este custo também deve virar uma conta a pagar no financeiro.',
    'Quando marcado, o sistema cria o título a pagar junto com o custo, evitando lançar duas vezes.',
    'Marcar ao registrar a nota do mecânico que ainda será paga.',
    'Marcar para um custo já pago e lançado no financeiro — gera título duplicado.',
    'revenda', 6
  ),
  (
    'revenda.veiculo.custos.vencimento', '/dashboard/revenda/veiculo/custos', 'Custos do veículo', 'Vencimento',
    'Data em que o título a pagar gerado por este custo vence.',
    'Define quando a conta aparece como a vencer no fluxo de caixa e nas contas a pagar.',
    '30/11/2026',
    'Deixar o vencimento para trás — o título já nasce em atraso.',
    'revenda', 7
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.rota = v.rota AND a.chave = v.chave
);
