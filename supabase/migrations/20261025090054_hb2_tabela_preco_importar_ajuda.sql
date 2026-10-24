-- HB2 (RD-95): "?" da importação de faixas por planilha e do selo de vigência em /dashboard/projetos/tabelas-preco.
-- Só acrescenta textos de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.importar', 'Importar planilha', 'Cole as linhas da planilha do cliente: código, nome, unidade, de, até, preço.', 'Carrega de uma vez todas as faixas do contrato, sem digitar uma a uma.', 'uretano-6mm;Piso de uretano 6 mm;m²;0;300;98,00', 'Colar com colunas fora de ordem ou faltando: a linha é recusada e o motivo aparece.', 40),
 ('hub.tabela_preco.importar_texto', 'Linhas da planilha', 'Copie as células no Excel ou Sheets e cole aqui. Colunas separadas por tab ou ponto e vírgula.', 'Cada linha vira uma faixa de quantidade do contrato escolhido.', 'uretano-6mm;Piso de uretano 6 mm;m²;301;;92,50', 'Deixar o "até" preenchido na última faixa: a quantidade maior fica sem preço.', 41),
 ('hub.tabela_preco.importar_aplicar', 'Importar faixas', 'Confira a prévia e toque para gravar as faixas no contrato.', 'Grava as faixas; as que já existem para o mesmo serviço e começo são atualizadas.', '12 faixas', 'Importar na tabela errada: confira o nome do contrato acima.', 42),
 ('hub.tabela_preco.selo_vigencia', 'Situação da vigência', 'Mostra se o contrato está vigente, a vencer ou vencido. Não precisa preencher.', 'Avisa antes de medir com um contrato fora do prazo.', 'Vigente até 31/12/2026', 'Medir com contrato vencido sem renovar a tabela.', 43)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
