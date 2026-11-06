-- Hub · Catálogo: "?" (RD-95) do selo de BDI no cabeçalho — deixa claro que é o BDI PADRÃO da empresa,
-- aplicado à coluna "Preço venda". Contratos por cliente (tabela de preço) podem ter preço/BDI próprios;
-- o selo não é o único BDI do mundo, é o default usado aqui. Fecha a dúvida do auditor ("BDI único no cabeçalho").
-- Aditiva: só texto de ajuda novo; sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.catalogo.bdi', 'Cabeçalho', 'BDI da empresa',
  'Não se preenche aqui. É o BDI padrão da empresa, configurado em Configurações do Hub.',
  'É o BDI aplicado ao custo (CPU) para chegar ao "Preço venda" desta tela. Preço venda = custo × (1 + BDI).',
  'BDI 31,86% sobre um custo de R$ 100 → preço de venda R$ 131,86.',
  'Achar que este é o único BDI possível: contratos por cliente (Tabela de preço) podem ter preço próprio, que prevalece na proposta.',
  5, '/dashboard/projetos/catalogo')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
