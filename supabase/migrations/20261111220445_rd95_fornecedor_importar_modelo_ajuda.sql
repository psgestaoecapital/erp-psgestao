-- Gestão Empresarial · Cadastros › Fornecedores (/dashboard/cadastros/fornecedores)
-- RD-95 ("?" em toda ação): as ações do topo "Baixar planilha modelo" e "Importar planilha" estavam
-- SEM "?" (a tela irmã Clientes já tinha). Cadastra as 2 chaves de ajuda dessas ações.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (erp_ajuda_campo), rota /dashboard/cadastros/fornecedores.
-- NÃO altera tabela/função nem dado de cliente. Idempotente. Versão acima da main, segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/fornecedores', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.fornecedor.modelo', 'Ações', 'Baixar planilha modelo',
  'Nada a preencher: baixa a planilha-modelo (.xlsx) já com as colunas certas para cadastrar vários fornecedores de uma vez.',
  'Padroniza a importação em massa — você preenche a planilha e sobe de volta, sem digitar um a um.',
  'Baixe o modelo, cole a lista de fornecedores do seu contador e depois use "Importar planilha".',
  'Montar uma planilha própria com outras colunas: a importação espera exatamente o layout do modelo.', 1),
 ('cadastros.fornecedor.importar', 'Ações', 'Importar planilha',
  'Nada a preencher: abre a tela para enviar a planilha preenchida (no layout do modelo) e cadastrar os fornecedores em lote.',
  'Cria muitos fornecedores de uma vez a partir da planilha, em vez de cadastrar manualmente.',
  'Depois de preencher o modelo, clique em Importar e confira o resumo antes de confirmar.',
  'Subir planilha fora do layout do modelo: as colunas não batem e as linhas são recusadas.', 2)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
