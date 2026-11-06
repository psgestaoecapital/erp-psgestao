-- RD-95: "?" no cabeçalho de cada coluna da tabela de Insumos (gap do auditor). Aditiva.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.insumos.col_code','/dashboard/projetos/insumos','Insumos','hub_projetos',40,'Código',
   'Código do insumo no seu cadastro (ERP).','Identifica o insumo na importação e no estoque.',
   'INS-0042','Repetir o código de outro insumo.'),
  ('projetos.insumos.col_name','/dashboard/projetos/insumos','Insumos','hub_projetos',41,'Nome',
   'Nome do insumo como aparece nos serviços.','É o que você procura ao montar a composição do serviço.',
   'Placa de gesso ST 12,5 mm','Nome genérico demais ("material") — dificulta achar depois.'),
  ('projetos.insumos.col_category','/dashboard/projetos/insumos','Insumos','hub_projetos',42,'Categoria',
   'Grupo do insumo (material, equipamento, EPI…).','Organiza a lista e os filtros.',
   'Material','Misturar equipamento com material.'),
  ('projetos.insumos.col_unit','/dashboard/projetos/insumos','Insumos','hub_projetos',43,'Un',
   'Unidade em que o preço é dado.','O serviço multiplica a quantidade por essa unidade.',
   'm²','Preço por caixa e unidade em m².'),
  ('projetos.insumos.col_current_cost','/dashboard/projetos/insumos','Insumos','hub_projetos',44,'Preço',
   'Custo atual de uma unidade, em reais.','Entra no custo do serviço e no orçamento.',
   'R$ 38,00','Digitar o preço da caixa em vez da unidade.'),
  ('projetos.insumos.col_variacao','/dashboard/projetos/insumos','Insumos','hub_projetos',45,'Variação',
   'Mostra o quanto o preço mudou na última atualização.','Alerta quando um insumo ficou mais caro e o orçamento precisa rever.',
   '↑ 6,5%','Achar que "—" é erro: significa que o preço ainda não mudou.'),
  ('projetos.insumos.col_uso','/dashboard/projetos/insumos','Insumos','hub_projetos',46,'Em uso',
   'Quantos serviços usam este insumo.','Insumo em uso não pode ser apagado; mudar o preço afeta todos esses serviços.',
   '3 serv.','Alterar o preço sem ver quantos serviços serão recalculados.')
ON CONFLICT (chave) DO NOTHING;
