-- Chamado #3255 (Gean · vale para todas) · RD-95: "?" do campo Fornecedor padrão do formulário de produto.
-- 100% ADITIVA: só INSERT em erp_ajuda_campo (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('cadastros.produtos.fornecedor_padrao','Produtos · Compra','Fornecedor padrão','O nome do fornecedor de quem você costuma comprar este item.','Aparece na sugestão de compra e ajuda a achar rápido de quem repor o produto.','Distribuidora Santos Peças.','Escrever o nome de forma diferente do cadastro de fornecedores: use o mesmo nome.',27,'/dashboard/cadastros/produtos','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
