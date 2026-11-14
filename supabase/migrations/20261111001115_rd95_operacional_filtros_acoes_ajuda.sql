-- RD-95: "?" (AjudaCampo) nos FILTROS e AÇÕES da tela /dashboard/operacional.
-- Gap do auditor (d2791cc0): a tela tinha "?" só nas abas e nos KPIs; os filtros (busca/status) e os
-- botões de ação (+ Nova Conta / Novo cadastro / Nova categoria) estavam sem "?".
-- Aditiva e idempotente: só insere chaves de ajuda (sem tocar dado de cliente, sem RLS, sem financeiro).
-- Chaves novas em erp_ajuda_campo, lidas por fn_ajuda_campo_listar. Faixa dev7claudeps (segundos :15).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('operacional.filtro_busca', '/dashboard/operacional', 'Operacional', 'Buscar lançamento',
   'Digite parte do cliente/fornecedor, descrição, categoria ou número do documento para filtrar a lista.',
   'Encontra rápido um título específico sem rolar a lista inteira; os KPIs e o total passam a somar só o que ficou visível.',
   'Digite "energia" para ver só as contas de energia.',
   'Esperar que a busca procure por valor — ela filtra por texto; para valor use a ordenação da coluna.',
   'gestao_empresarial', 30, 'publicado'),

  ('operacional.filtro_status', '/dashboard/operacional', 'Operacional', 'Filtrar por situação',
   'Escolha a situação dos títulos a exibir: Todos, A Vencer, Recebido/Pago, Vencido ou Cancelado.',
   'Separa o que já foi liquidado do que ainda está em aberto ou atrasado; os KPIs somam só a situação filtrada.',
   'Selecione "Vencido" para ver só o que passou do vencimento.',
   'Deixar um status filtrado e achar que sumiram títulos — volte para "Todos" para ver tudo.',
   'gestao_empresarial', 40, 'publicado'),

  ('operacional.acao_nova_conta', '/dashboard/operacional', 'Operacional', 'Nova conta a receber/pagar',
   'Abre o formulário para cadastrar um novo título na aba atual (a receber ou a pagar).',
   'Registra um lançamento com valor, vencimento, categoria, parcelas e forma de pagamento.',
   'Clique para lançar uma venda a prazo em 3x a receber.',
   'Lançar na aba errada — confira se está em Contas a Receber ou a Pagar antes de salvar.',
   'gestao_empresarial', 50, 'publicado'),

  ('operacional.filtro_busca_pessoas', '/dashboard/operacional', 'Operacional', 'Buscar cadastro',
   'Digite parte do nome para filtrar a lista de clientes ou fornecedores.',
   'Localiza rápido um cadastro específico antes de editar ou lançar um título para ele.',
   'Digite "frigorífico" para ver só os cadastros com esse nome.',
   'Buscar por CNPJ sem pontuação quando o cadastro foi salvo com pontos — digite parte do nome.',
   'gestao_empresarial', 32, 'publicado'),

  ('operacional.acao_novo_cadastro', '/dashboard/operacional', 'Operacional', 'Novo cliente/fornecedor',
   'Abre o formulário para cadastrar um novo cliente (ou fornecedor, conforme a aba).',
   'Cria o cadastro usado para vincular títulos a receber e a pagar a uma pessoa ou empresa.',
   'Clique para cadastrar um novo fornecedor de matéria-prima.',
   'Cadastrar o mesmo CNPJ duas vezes — confira na busca antes de criar.',
   'gestao_empresarial', 52, 'publicado'),

  ('operacional.acao_nova_bancaria', '/dashboard/operacional', 'Operacional', 'Nova conta bancária',
   'Abre o formulário para cadastrar uma conta bancária, aplicação ou caixa da empresa.',
   'Permite vincular os lançamentos à conta usada no pagamento/recebimento e controlar o saldo inicial.',
   'Clique para cadastrar a conta corrente do banco principal.',
   'Esquecer o saldo inicial — informe-o para os relatórios de saldo baterem.',
   'gestao_empresarial', 54, 'publicado'),

  ('operacional.filtro_busca_plano', '/dashboard/operacional', 'Operacional', 'Buscar categoria',
   'Digite o código ou o nome para filtrar o plano de contas.',
   'Encontra rápido a categoria a usar num lançamento sem rolar a árvore inteira.',
   'Digite "3.01" ou "energia" para achar a categoria.',
   'Procurar por um nível de grupo para lançar — lance nas categorias analíticas (níveis mais baixos).',
   'gestao_empresarial', 34, 'publicado'),

  ('operacional.acao_nova_categoria', '/dashboard/operacional', 'Operacional', 'Nova categoria',
   'Abre o formulário para criar uma categoria do plano de contas da empresa (código, descrição e tipo).',
   'Amplia o plano de contas para classificar receitas, custos e despesas nos lançamentos e na DRE.',
   'Clique para criar a categoria "3.01.14 - Manutenção de veículos".',
   'Repetir um código já existente — confira na busca antes de criar.',
   'gestao_empresarial', 56, 'publicado')
ON CONFLICT (chave) DO NOTHING;
