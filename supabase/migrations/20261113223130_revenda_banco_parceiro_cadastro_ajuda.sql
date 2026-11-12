-- Revenda · Configuração da garagem · /dashboard/revenda/config
-- Chamado #8162 (etapa 2) · Code: rodrigo-code
--
-- RD-95: a nova seção "Bancos parceiros (financiamento)" ganha "?" em cada campo.
-- Textos em linguagem do usuário, lidos por fn_ajuda_campo_listar (uma chamada por tela).
-- Idempotente (ON CONFLICT (chave) DO UPDATE). Metadado de ajuda — NÃO toca dado de cliente,
-- função, RLS nem regra fiscal/financeira. Aditiva. Faixa de segundos do rodrigo-code (:30),
-- acima da última migration da main.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('revenda.config.banco_parceiro.secao','/dashboard/revenda/config','Bancos parceiros','Bancos parceiros (financiamento)',
   'Cadastre aqui os bancos/financeiras que pagam retorno à garagem pela intermediação do financiamento do veículo.',
   'Esses bancos ficam disponíveis para seleção na venda; o % e o prazo cadastrados calculam e provisionam a receita de intermediação. Não confunda com as contas bancárias da própria empresa (usadas no caixa/conciliação).',
   'Banco X Financiamentos · 2% · 30 dias.',
   'Cadastrar aqui uma conta corrente da empresa — isto é só para bancos que PAGAM retorno de financiamento.',
   'revenda', 90, 1, 'publicado'),
  ('revenda.config.banco_parceiro.nome','/dashboard/revenda/config','Bancos parceiros','Nome do banco',
   'Nome do banco ou financeira parceira, como você quer vê-lo na hora de escolher na venda.',
   'Identifica o parceiro na venda e nos relatórios de previsão de receita. Não pode repetir na mesma empresa.',
   'Banco X Financiamentos.',
   'Nome repetido: já existe um parceiro com esse nome — edite o existente ou use outro nome.',
   'revenda', 91, 1, 'publicado'),
  ('revenda.config.banco_parceiro.retorno_pct','/dashboard/revenda/config','Bancos parceiros','% de retorno',
   'Percentual que o banco paga sobre o valor financiado (ex.: 2 para 2%). Deixe em branco se o parceiro não tem um % fixo.',
   'Na venda, ao escolher o banco e informar o valor financiado, o sistema calcula o retorno previsto (% × financiado). O valor fica editável pelo operador.',
   '2 (dois por cento) sobre R$ 50.000 financiados = R$ 1.000 de retorno previsto.',
   'Digitar o valor em reais no lugar do percentual — aqui é só o percentual (ex.: 2 ou 2,5).',
   'revenda', 92, 1, 'publicado'),
  ('revenda.config.banco_parceiro.prazo_dias','/dashboard/revenda/config','Bancos parceiros','Prazo (dias)',
   'Prazo médio, em dias, até o banco pagar o retorno. Deixe em branco se não souber.',
   'Define o vencimento do título a receber da intermediação (data da venda + prazo), para entrar no contas a receber e no fluxo de caixa.',
   '30 (o banco costuma pagar em cerca de 30 dias).',
   'Informar meses no lugar de dias — o campo é em dias (ex.: 30, 45).',
   'revenda', 93, 1, 'publicado'),
  ('revenda.config.banco_parceiro.ativo','/dashboard/revenda/config','Bancos parceiros','Ativo',
   'Marque para o banco aparecer na seleção da venda. Desmarque para aposentar um parceiro sem apagá-lo.',
   'Parceiro inativo não aparece para novas vendas, mas as vendas já registradas com ele continuam intactas.',
   'Marcado = disponível na venda; desmarcado = fica no cadastro, mas some da seleção.',
   'Excluir quando bastava inativar — ao excluir, o cadastro some; para só tirar da lista, desmarque "Ativo".',
   'revenda', 94, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
