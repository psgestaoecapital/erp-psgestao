-- HB2: ajuda de campo ("?") da consulta Tabela de preço do cliente. Só texto novo; nada é alterado.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.tabela_preco.tabela', '/dashboard/projetos/tabela-preco', 'Tabela de preço', 'Tabela',
   'Escolha a tabela de preço do cliente que vai receber o orçamento.', 'Define faixas, adicionais e códigos usados no cálculo.', 'BRF 2026', 'Escolher a tabela de outro cliente.', 910),
  ('projetos.tabela_preco.servico', '/dashboard/projetos/tabela-preco', 'Tabela de preço', 'Serviço',
   'O serviço que será orçado.', 'O sistema escolhe a faixa de preço desse serviço pela quantidade.', 'Pintura Epóxi', 'Procurar pelo código do cliente; aqui vale o nome do serviço.', 911),
  ('projetos.tabela_preco.quantidade', '/dashboard/projetos/tabela-preco', 'Tabela de preço', 'Quantidade',
   'Quantidade total do serviço, na unidade do serviço (m², ml, km).', 'Define a faixa: quanto maior a quantidade, menor o preço unitário em tabelas com faixas.', '350', 'Digitar a quantidade de um dia só, em vez do total da obra.', 912),
  ('projetos.tabela_preco.condicao', '/dashboard/projetos/tabela-preco', 'Tabela de preço', 'Condição',
   'Quando o serviço será feito: normal, noturno, sábado, domingo/feriado.', 'Aplica o adicional da tabela e troca o código do item no cliente.', 'Sábado (+50%)', 'Deixar "Normal" para serviço de fim de semana e perder o adicional.', 913)
ON CONFLICT (chave) DO NOTHING;
