-- ONDA 2 Hub "da obra ao resultado": a tela Resultado por obra passa a exibir a 4ª fonte de custo real
-- alocada à obra — compras e subempreiteiros já lançados em contas a pagar pelo centro de custo da obra
-- (coluna custo_contas_pagar de v_obra_resultado_alocado). Esta migration só registra a ajuda "?" (RD-95)
-- da nova coluna e corrige o texto da coluna "Custo" para citar todas as fontes. Aditiva e idempotente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.resultado_obra.custo_contas_pagar',
   '/dashboard/projetos/obras/resultado',
   'Colunas',
   'Compras/subempreiteiros (a pagar)',
   'Nada a preencher: a coluna soma o que a obra já tem lançado em contas a pagar pelo centro de custo dela — compras de material e medições de subempreiteiro aprovadas que viraram título a pagar.',
   'É a quarta fonte de custo real da obra (além de material, viagens e mão de obra apontada); entra no custo e na margem para o resultado refletir também o que a obra deve a fornecedores e subempreiteiros.',
   'Medição do subempreiteiro aprovada por R$ 31.600,00 (líquido) vira um a pagar no centro de custo da obra e aparece aqui.',
   'Achar que a coluna fica em zero por falta de dado: sem compra ou medição de subempreiteiro lançada no centro de custo da obra não há contas a pagar a somar.',
   'hub_construcao', 217)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();

-- O texto da coluna "Custo" citava só material, viagens e mão de obra; agora soma também rateio e contas a pagar.
UPDATE public.erp_ajuda_campo
   SET o_que_preencher = 'Nada a preencher: soma material, viagens, mão de obra apontada, custo fixo rateado e compras/subempreiteiros a pagar.',
       atualizado_em = now()
 WHERE chave = 'projetos.resultado_obra.custo';
