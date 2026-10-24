-- HB2 (RD-95): "?" do botão de arquivo (Excel/PDF/foto lido por IA) em /dashboard/projetos/tabelas-preco.
-- Só acrescenta texto de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'hub.tabela_preco.importar_arquivo', 'Tabela de preço', 'Arquivo da tabela do cliente',
 'Escolha o Excel, o PDF ou a foto da tabela que o cliente enviou.',
 'A IA lê o arquivo e preenche as linhas na caixa abaixo; nada é gravado até você conferir a revisão lado a lado e tocar em Importar faixas.',
 'tabela-brf.pdf', 'Confiar sem conferir: a IA pode errar uma coluna; a revisão mostra a linha original ao lado do que foi entendido.', 44,
 '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
