-- HB0: ajuda de campo ("?") dos indicadores do Cockpit da obra. Só texto novo; nada é alterado (RD-97).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.cockpit.receita', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Receita realizada',
   'Nada a preencher: soma o serviço medido e o material vendido à obra.',
   'É a base da margem: receita de serviço (medições) + receita de material (vendas ligadas à obra).',
   'Serviço R$ 80.000 + material R$ 20.000 = R$ 100.000', 'Estranhar receita zero: venda ou medição ainda não foi ligada à obra.', 910),
  ('projetos.cockpit.custo', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Custo realizado',
   'Nada a preencher: soma material, viagens, mão de obra e rateio de custos fixos da obra.',
   'Entra na margem alocada e é comparado ao custo previsto do orçamento.',
   'Material 30.000 + viagens 2.000 + mão de obra 15.000 + rateio 3.000 = R$ 50.000', 'Achar que falta custo: apontamento de horas e rateio só entram depois de lançados.', 911),
  ('projetos.cockpit.margem', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Margem',
   'Nada a preencher: receita realizada menos o custo realizado completo.',
   'Mostra quanto a obra realmente deixa de resultado, já com mão de obra e rateio.',
   'R$ 100.000 − R$ 50.000 = R$ 50.000 (50%)', 'Comparar com a margem do orçamento: aqui só conta o que já foi realizado.', 912),
  ('projetos.cockpit.avanco', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Avanço financeiro',
   'Nada a preencher: serviço medido dividido pela receita prevista dos itens contratados.',
   'Indica quanto da obra já foi medido e pode ser faturado.',
   'Medido R$ 40.000 de R$ 100.000 = 40%', 'Obra sem itens contratados fica sem avanço: cadastre o orçamento.', 913),
  ('projetos.cockpit.pendencias', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Pendências do dia',
   'Nada a preencher: o sistema lista o que precisa de atenção hoje.',
   'Aponta obra sem itens contratados, custo acima do previsto e margem negativa.',
   'Custo realizado acima do previsto', 'Ignorar o aviso de custo acima do previsto até a margem fechar negativa.', 914)
ON CONFLICT (chave) DO NOTHING;
