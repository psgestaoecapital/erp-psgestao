-- Revenda · Negociação (R5b) · #6874 · Code: jordana-code
--
-- RD-95: "?" (AjudaCampo) em todos os campos da COMPOSIÇÃO do negócio da tela
-- /dashboard/revenda/negociacao/[id]. Hoje só o "Banco (financiamento)" tinha
-- a chave (revenda.negociacao.banco_parceiro). Esta migration cadastra as chaves
-- dos demais 12 campos da composição; o front passa <AjudaCampo chave=...> em cada um.
--
-- Aditiva e idempotente: só INSERT em public.erp_ajuda_campo (catálogo global de
-- ajuda, sem coluna de dono) com ON CONFLICT (chave) DO UPDATE. Não toca RLS,
-- permissão, função, nem dado de cliente.
--
-- RD-38 (prova no dado): antes desta migration, só 1 chave existia para esta rota —
--   SELECT count(*) FROM erp_ajuda_campo WHERE chave LIKE 'revenda.negociacao.%'  → 1
-- Depois: 13 (a existente + 12 novas). Nenhuma chave reaproveitada/sobrescreve texto alheio.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('revenda.negociacao.cliente_nome','/dashboard/revenda/negociacao','Composição','Cliente',
   'Nome de quem está comprando o veículo. Pode ser pessoa física ou empresa.',
   'Identifica a negociação e sai na proposta e nos documentos da venda.',
   'João da Silva · Transportes Aurora Ltda',
   'Deixar em branco: a negociação fica sem dono e você não acha depois pela busca.',
   'revenda', 10, 1, 'publicado'),
  ('revenda.negociacao.cliente_doc','/dashboard/revenda/negociacao','Composição','CPF/CNPJ',
   'O CPF (pessoa) ou CNPJ (empresa) do comprador, só números ou com pontuação.',
   'É o documento que vai para o contrato e para a nota fiscal da venda.',
   '123.456.789-00 · 12.345.678/0001-90',
   'Trocar CPF por CNPJ (ou vice-versa) faz a nota sair com o cadastro errado.',
   'revenda', 20, 1, 'publicado'),
  ('revenda.negociacao.vendedor_nome','/dashboard/revenda/negociacao','Composição','Vendedor',
   'Nome do vendedor responsável por esta negociação.',
   'Usado para apurar comissão e medir o desempenho por vendedor.',
   'Carlos Mendes',
   'Deixar em branco atrapalha o relatório de vendas por pessoa.',
   'revenda', 30, 1, 'publicado'),
  ('revenda.negociacao.validade','/dashboard/revenda/negociacao','Composição','Vale até',
   'A data até quando esta proposta de negócio é válida.',
   'Depois dessa data a negociação aparece como vencida e os valores podem ser revistos.',
   '31/12/2026',
   'Data muito curta vence a proposta antes de o cliente responder.',
   'revenda', 40, 1, 'publicado'),
  ('revenda.negociacao.origem_lead','/dashboard/revenda/negociacao','Composição','Origem do lead',
   'De onde veio este cliente/interesse (canal de origem).',
   'Mostra quais canais mais trazem venda e onde vale investir.',
   'OLX · WhatsApp · indicação · passou na loja',
   'Escrever cada vez de um jeito dificulta somar por canal; use termos padronizados.',
   'revenda', 50, 1, 'publicado'),
  ('revenda.negociacao.preco_pedido','/dashboard/revenda/negociacao','Composição','Preço pedido',
   'O valor cheio pedido pelo veículo, antes de desconto, em reais.',
   'É a base do cálculo: preço pedido menos desconto = valor da venda.',
   'R$ 85.000,00',
   'Informar já com o desconto embutido some duas vezes o abatimento.',
   'revenda', 60, 1, 'publicado'),
  ('revenda.negociacao.desconto','/dashboard/revenda/negociacao','Composição','Desconto',
   'O abatimento concedido sobre o preço pedido, em reais.',
   'Entra no cálculo da margem; desconto acima da alçada pede aprovação do gerente.',
   'R$ 2.500,00',
   'Lançar o desconto em porcentagem no campo de R$ distorce o valor da venda.',
   'revenda', 70, 1, 'publicado'),
  ('revenda.negociacao.entrada','/dashboard/revenda/negociacao','Composição','Entrada',
   'Quanto o cliente paga de entrada (sinal), em reais.',
   'Entrada + financiado + espécie precisam fechar o valor da venda.',
   'R$ 20.000,00',
   'Entrada maior que o valor da venda deixa a composição sem bater.',
   'revenda', 80, 1, 'publicado'),
  ('revenda.negociacao.financiado','/dashboard/revenda/negociacao','Composição','Financiado (banco)',
   'O valor que o banco vai financiar para o cliente, em reais.',
   'Serve de base para o retorno do banco (% sobre o financiado) e fecha a composição.',
   'R$ 45.000,00',
   'Esquecer o financiado faz o retorno previsto do banco ficar zerado.',
   'revenda', 90, 1, 'publicado'),
  ('revenda.negociacao.parcelas','/dashboard/revenda/negociacao','Composição','Parcelas',
   'Em quantas vezes o financiamento foi contratado.',
   'Registra a condição combinada com o banco para conferência depois.',
   '48 · 60',
   'Confundir número de parcelas com valor da parcela.',
   'revenda', 100, 1, 'publicado'),
  ('revenda.negociacao.retorno_banco','/dashboard/revenda/negociacao','Composição','Retorno do banco',
   'O valor que o banco devolve à loja pelo financiamento, em reais. Sugerido pelo % do banco parceiro, mas editável.',
   'Entra como receita da negociação no resultado da venda.',
   'R$ 1.350,00',
   'Apagar o valor sugerido sem conferir deixa a receita do financiamento de fora.',
   'revenda', 110, 1, 'publicado'),
  ('revenda.negociacao.especie_valor','/dashboard/revenda/negociacao','Composição','Espécie (dinheiro)',
   'A parte do pagamento feita em dinheiro à vista, em reais.',
   'Compõe o total pago junto com entrada e financiado.',
   'R$ 5.000,00',
   'Lançar em espécie um valor que já entrou como entrada conta duas vezes.',
   'revenda', 120, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
