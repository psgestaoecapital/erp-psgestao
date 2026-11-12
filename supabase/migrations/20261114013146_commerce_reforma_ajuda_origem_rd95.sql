-- RD-95 ("?" em indicador/ação) + RD-98 p3 (origem do dado) · /dashboard/commerce/reforma
-- GAP (auditor, score 90): a tela do painel "Reforma Tributária" não tinha NENHUM AjudaCampo "?"
-- nos 3 indicadores (IBS+CBS recebidos; Notas com os campos novos; Fornecedores já emitindo), no
-- gráfico "IBS + CBS por mês" e nas 2 ações do estado vazio (Ver compras; NF-e recebidas). E a
-- origem do dado (system_screens.views_consumidas/rpcs_chamadas) estava NULA.
--
-- Migration aditiva (RD-94.1): só INSERT de ajuda (ON CONFLICT DO NOTHING) + UPDATE de catálogo de
-- tela (system_screens). Não cria/altera função, view, RLS, grants nem dado de cliente.
-- Texto em linguagem do usuário, honesto (RD-51: a tela é informativa, não simula carga futura).

-- (1) RD-95: "?" dos indicadores e ações do painel da reforma
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('commerce.reforma.ibs_cbs_recebidos', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'IBS + CBS recebidos',
   'Nada a preencher — é um indicador. Soma o IBS e a CBS que já vieram destacados nas suas notas de compra.',
   'Mostra, em reais, quanto de IBS e de CBS já chegou nas compras no período, sem você digitar nada.',
   'Se três notas trouxeram R$ 120 de IBS e R$ 80 de CBS, o indicador mostra R$ 200,00.',
   'Confundir com imposto a pagar: aqui é o que VEIO destacado nas compras, não uma previsão de carga.', 10),
  ('commerce.reforma.notas_campos_novos', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'Notas com os campos novos',
   'Nada a preencher — é um indicador. Conta quantas das suas notas de compra já trazem o grupo IBS/CBS.',
   'Mede o avanço da reforma nas suas compras: quantas notas, do total, já têm os campos novos preenchidos.',
   '8 / 30 significa que 8 das 30 notas do período já vieram com IBS/CBS.',
   'Achar que o número baixo é erro do sistema: depende de o fornecedor já destacar IBS/CBS na NF-e.', 20),
  ('commerce.reforma.fornecedores_emitindo', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'Fornecedores já emitindo',
   'Nada a preencher — é um indicador. Conta quantos dos seus fornecedores já emitem nota com IBS/CBS.',
   'Mostra quais fornecedores já se adaptaram, para você acompanhar quem ainda não destaca os campos novos.',
   '2 / 15 significa que 2 dos 15 fornecedores do período já mandam IBS/CBS na nota.',
   'Esperar 100%: a adoção é gradual e depende de cada fornecedor.', 30),
  ('commerce.reforma.por_mes', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'IBS + CBS por mês',
   'Nada a preencher — é um gráfico. Mostra o IBS + CBS recebido mês a mês.',
   'Ajuda a ver a evolução dos valores ao longo do tempo. A variação é mix das suas compras, não "adoção da reforma".',
   'Um mês com mais compras tende a mostrar barra maior, mesmo sem mudança de alíquota.',
   'Ler a variação como aumento de imposto: ela acompanha o volume de compras do mês.', 40),
  ('commerce.reforma.acao_ver_compras', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'Ver compras',
   'É um botão. Abre a lista de compras para você conferir as notas de onde vêm os valores.',
   'Leva direto às compras, para checar as notas que alimentam este painel.',
   'Clique para revisar quais notas já têm IBS/CBS destacado.',
   'Esperar lançar algo aqui: o painel é só leitura; o registro é feito em Compras.', 50),
  ('commerce.reforma.acao_nfe_recebidas', '/dashboard/commerce/reforma', 'Reforma Tributária', 'commerce',
   'NF-e recebidas',
   'É um botão. Abre as NF-e recebidas, onde o IBS/CBS chega destacado pelo fornecedor.',
   'Leva às notas fiscais recebidas, origem dos campos novos que aparecem neste painel.',
   'Clique para ver as NF-e e conferir o grupo IBS/CBS de cada uma.',
   'Procurar aqui emitir nota: esta tela só recebe e lê as notas dos fornecedores.', 60)
ON CONFLICT (chave) DO NOTHING;

-- (2) RD-98 p3: origem do dado no catálogo de telas (provado no corpo de fn_fiscal_reforma_painel,
-- que lê public.erp_nfe_recebidas; a tela só chama essa RPC, sem .from direto).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_nfe_recebidas']::text[],
       rpcs_chamadas    = ARRAY['fn_fiscal_reforma_painel','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/commerce/reforma';
