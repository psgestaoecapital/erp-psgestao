-- Chamado #3255 (Gean) · RD-95: "?" do campo Saldo inicial do formulário de produto novo.
-- 100% ADITIVA: só INSERT em erp_ajuda_campo (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('cadastros.produtos.saldo_inicial','Produtos · Estoque','Saldo inicial em estoque','A quantidade que você já tem deste produto hoje, na unidade do cadastro.','Lança a entrada inicial no estoque com o Preço de custo informado, para o saldo e o custo médio já começarem certos.','12 (com Preço de custo 35,00).','Preencher e esquecer o Preço de custo: sem ele o estoque entra valendo zero.',28,'/dashboard/cadastros/produtos','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
