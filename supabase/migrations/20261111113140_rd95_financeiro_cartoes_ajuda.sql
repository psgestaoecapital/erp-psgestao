-- RD-95 (CEO 08/10) + gap do auditor aud8claudeps na tela /dashboard/financeiro/cartoes
-- (Cartões / Adquirentes). A tela tinha 0 "?" (AjudaCampo) nos campos do cadastro de
-- adquirentes, da tabela de taxas e do simulador. Esta migration cadastra o texto do "?"
-- (erp_ajuda_campo) para todos esses campos/indicadores/ações e, de passagem, corrige a
-- RD-98 p3 (origem do dado) em system_screens: estado_real estava "desconhecida" e as
-- listas views_consumidas/rpcs_chamadas não batiam com o que a tela realmente consome.
--
-- ADITIVA e idempotente: só insere texto de ajuda (ON CONFLICT DO NOTHING) e ajusta os
-- metadados da própria rota em system_screens. NÃO toca tabela, função, RLS nem dado de
-- cliente — a tela segue lendo erp_banco_contas e as RPCs fn_cartao_* pela RLS da empresa.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/cartoes', 'financeiro', 'publicado'
FROM (VALUES
  -- ── Adquirentes ─────────────────────────────────────────────────────────────
  ('financeiro.cartoes.adquirentes', 'Adquirentes', 'Adquirentes cadastradas',
   'Nada a preencher aqui: é a lista das operadoras de cartão (adquirentes) da sua empresa. Clique em "+ Nova" para cadastrar e no nome para ver/editar as taxas dela.',
   'A adquirente é quem processa o cartão e repassa o dinheiro. Cada venda no cartão usa a taxa cadastrada na adquirente para calcular quanto cai líquido e em que data.',
   'Cielo, Rede, Stone, Getnet, PagSeguro, Mercado Pago.',
   'Ficar sem nenhuma adquirente: sem ela o simulador e os recebíveis de cartão não calculam. Cadastre ao menos a que você usa.', 10),
  ('financeiro.cartoes.adq_nome', 'Adquirentes', 'Nome da adquirente',
   'O nome da operadora de cartão como você a reconhece. É obrigatório.',
   'Identifica a adquirente em toda a tela (taxas, simulador e repasses a conciliar) e nos recebíveis gerados pela venda no cartão.',
   'Cielo, Rede, Stone.',
   'Cadastrar a mesma adquirente duas vezes com nomes diferentes: as taxas e repasses ficam divididos entre as duas. Use um nome só por operadora.', 20),
  ('financeiro.cartoes.adq_conta', 'Adquirentes', 'Conta de repasse',
   'A conta bancária em que a adquirente deposita o líquido das vendas. Opcional, mas recomendável.',
   'É a conta sugerida na hora de conciliar o repasse de cartão com o extrato — o crédito da adquirente cai nela.',
   'Conta Corrente Itaú 1234-5 (onde a Cielo deposita).',
   'Deixar em branco e depois não lembrar em que conta a adquirente deposita: informe a conta para a conciliação já vir certa.', 30),
  ('financeiro.cartoes.adq_cnpj', 'Adquirentes', 'CNPJ da adquirente (opcional)',
   'O CNPJ da operadora de cartão, se você quiser registrar. É opcional.',
   'Serve só para identificação/cadastro; não entra no cálculo da taxa nem do líquido.',
   '01.027.058/0001-91 (Cielo).',
   'Confundir com o CNPJ da sua empresa: aqui é o da adquirente, não o seu.', 40),
  -- ── Taxas ───────────────────────────────────────────────────────────────────
  ('financeiro.cartoes.taxas', 'Taxas', 'Taxas da adquirente',
   'Nada a preencher aqui: é a tabela de taxas da adquirente selecionada, por bandeira × modalidade × faixa de parcelas. Use "+ Nova taxa" para adicionar.',
   'A taxa é o percentual que a adquirente retém de cada venda. É daqui que o sistema tira quanto cai líquido e quando — tudo vem do cadastro (nada é chutado).',
   'Visa crédito 1x = 1,01%; Visa crédito 2–6x = 2,49%.',
   'Esquecer de cadastrar a faixa de parcelas usada na venda: sem a taxa daquela combinação o cálculo não acontece e o líquido não aparece.', 50),
  ('financeiro.cartoes.taxa_bandeira', 'Taxas', 'Bandeira',
   'A bandeira do cartão a que esta taxa se aplica. Escolha na lista ou digite.',
   'Junto com modalidade e parcelas, define qual taxa vale para a venda. Bandeiras diferentes costumam ter taxas diferentes.',
   'Visa, Master, Elo, Amex, Hipercard.',
   'Cadastrar a taxa numa bandeira e lançar a venda em outra: cada bandeira precisa da sua própria taxa.', 60),
  ('financeiro.cartoes.taxa_modalidade', 'Taxas', 'Modalidade',
   'Se a taxa é de débito ou de crédito.',
   'Débito e crédito têm taxas e prazos de repasse diferentes; a modalidade escolhe qual taxa usar no cálculo.',
   'Débito (repasse em D+1) ou Crédito (repasse em D+30).',
   'Cadastrar só crédito e lançar venda no débito (ou o contrário): cadastre a taxa de cada modalidade que você aceita.', 70),
  ('financeiro.cartoes.taxa_parcelas_de', 'Taxas', 'Parcelas — de',
   'O número MÍNIMO de parcelas em que esta taxa começa a valer.',
   'Define o início da faixa de parcelas. Assim você cadastra uma taxa por faixa (1x, 2 a 6x, 7 a 12x) em vez de uma por parcela.',
   'Para a faixa "2 a 6x", "de" = 2.',
   'Deixar buracos ou sobreposição entre as faixas: a venda cujo nº de parcelas não cai em nenhuma faixa fica sem taxa.', 80),
  ('financeiro.cartoes.taxa_parcelas_ate', 'Taxas', 'Parcelas — até',
   'O número MÁXIMO de parcelas em que esta taxa vale. Para taxa de uma parcela só, deixe "de" e "até" iguais.',
   'Fecha a faixa de parcelas. A taxa vale para vendas cujo número de parcelas esteja entre "de" e "até".',
   'Para a faixa "2 a 6x", "até" = 6; para débito/1x, "de" e "até" = 1.',
   'Faixas que se sobrepõem (ex.: 1–6 e 6–12 as duas incluindo o 6): deixe cada parcela em uma faixa só.', 90),
  ('financeiro.cartoes.taxa_percentual', 'Taxas', 'Taxa %',
   'O percentual que a adquirente retém da venda nesta combinação. Use vírgula para os decimais.',
   'É o coração do cálculo: líquido = valor da venda − (valor × taxa %). Também alimenta os recebíveis de cartão e o DRE.',
   '1,01 para 1,01%; 2,49 para 2,49%.',
   'Digitar a taxa como fração (0,0101) em vez de percentual (1,01): informe o número do percentual, como vem no extrato da adquirente.', 100),
  ('financeiro.cartoes.taxa_repasse_dias', 'Taxas', 'Repasse (dias)',
   'Em quantos dias corridos a adquirente deposita o líquido depois da venda (o "D+").',
   'Define a data em que o dinheiro cai, usada na previsão de caixa e para agrupar os repasses a conciliar.',
   'Débito = 1 (D+1); crédito à vista costuma ser 30 (D+30).',
   'Confundir dias corridos com dias úteis: use o prazo em dias corridos informado pela adquirente.', 110),
  -- ── Simulador ───────────────────────────────────────────────────────────────
  ('financeiro.cartoes.simulador', 'Simulador', 'Simulador de recebimento',
   'Nada a preencher aqui: informe os dados da venda nos campos abaixo e clique em Calcular para ver o líquido e a data de repasse.',
   'Valida o cadastro: mostra, com a taxa cadastrada, quanto a empresa recebe líquido numa venda no cartão e quando o dinheiro cai.',
   'Venda de R$ 2.110,00 no Visa crédito 1x → líquido e data de repasse.',
   'Simular sem ter cadastrado a taxa da combinação (bandeira/modalidade/parcelas): aparece "taxa não cadastrada". Cadastre a taxa acima primeiro.', 120),
  ('financeiro.cartoes.sim_bandeira', 'Simulador', 'Bandeira (simulação)',
   'A bandeira do cartão da venda que você quer simular.',
   'Escolhe qual taxa cadastrada será usada no cálculo do líquido.',
   'Visa, Master, Elo.',
   'Escolher uma bandeira sem taxa cadastrada: o simulador avisa que falta a taxa.', 130),
  ('financeiro.cartoes.sim_modalidade', 'Simulador', 'Modalidade (simulação)',
   'Se a venda simulada é no débito ou no crédito.',
   'Define, junto com bandeira e parcelas, qual taxa entra no cálculo.',
   'Crédito para uma venda parcelada; Débito para a vista no cartão de débito.',
   'Simular crédito parcelado tendo cadastrado só débito: cadastre a taxa da modalidade certa.', 140),
  ('financeiro.cartoes.sim_parcelas', 'Simulador', 'Parcelas (simulação)',
   'Em quantas parcelas a venda simulada foi feita.',
   'Seleciona a faixa de parcelas da taxa — o número precisa cair numa faixa cadastrada (de…até).',
   '1 para à vista; 6 para uma venda em 6x.',
   'Informar um nº de parcelas fora das faixas cadastradas: o cálculo não encontra taxa.', 150),
  ('financeiro.cartoes.sim_valor', 'Simulador', 'Valor da venda (simulação)',
   'O valor bruto da venda no cartão, antes da taxa. Use vírgula para os centavos.',
   'É a base do cálculo: sobre ele a taxa é aplicada para chegar ao líquido que a empresa recebe.',
   '2110,00 para uma venda de R$ 2.110,00.',
   'Digitar o valor já descontado da taxa: informe o valor cheio da venda, não o líquido.', 160),
  -- ── Repasses a conciliar ────────────────────────────────────────────────────
  ('financeiro.cartoes.repasses', 'Repasses', 'Repasses de cartão a conciliar',
   'Nada a preencher: é o que as adquirentes ainda devem depositar, já no líquido, agrupado por adquirente e data de repasse.',
   'Quando o crédito da adquirente cair no extrato, você concilia o grupo cuja soma bate — e os recebíveis de cartão são baixados com a taxa quitada.',
   'Repasse Cielo de 10/11: 8 vendas, R$ 3.420,00 líquido.',
   'Conciliar um grupo com valor diferente do que caiu no extrato: concilie o grupo cuja soma líquida bate com o crédito recebido.', 170)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3 (origem do dado): a rota estava "desconhecida" e as listas não refletiam o que a
-- tela consome. A tela é funcional e completa (cadastro de adquirentes, tabela de taxas,
-- simulador e conciliação de repasse) — marcar como "parcial" (funcional; selo visual do aud8
-- reaudita à parte) e registrar a origem real do dado.
UPDATE public.system_screens
   SET estado_real = CASE WHEN estado_real = 'desconhecida' OR estado_real IS NULL THEN 'parcial' ELSE estado_real END,
       views_consumidas = ARRAY['erp_banco_contas']::text[],
       rpcs_chamadas = ARRAY[
         'fn_cartao_adquirente_listar','fn_cartao_adquirente_salvar',
         'fn_cartao_taxa_listar','fn_cartao_taxa_salvar',
         'fn_cartao_calcular','fn_cartao_recebiveis_abertos','fn_cartao_conciliar_repasse'
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/financeiro/cartoes';
