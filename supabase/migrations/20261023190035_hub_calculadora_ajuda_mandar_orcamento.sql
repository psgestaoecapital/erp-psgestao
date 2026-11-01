-- Hub · Calculadora de obra (RD-95): "?" no botão "Mandar para o orçamento". Só INSERT de texto de ajuda; idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.calculadora.mandar_orcamento', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 20, 'Mandar para o orçamento',
   'Nada a preencher: escolha o orçamento em rascunho ao lado e clique no botão.', 'Leva cada material calculado como item do orçamento, com a quantidade de compra e o custo do estoque.',
   'Calcular o forro, escolher ORC-2026-0012 e mandar', 'Clicar duas vezes: os itens são somados ao orçamento de novo, não substituídos.')
ON CONFLICT (chave) DO NOTHING;
