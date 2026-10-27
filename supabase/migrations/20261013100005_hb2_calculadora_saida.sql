-- Hub HB2 · Calculadora de Obra (fatia 4): textos do "?" (RD-95) da saída para orçamento e da lista de compra.
-- Aditiva: só linhas novas em erp_ajuda_campo; sem UPDATE/DELETE.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.orcamento', 'Orçamento em rascunho', 'Escolha o orçamento em rascunho que vai receber os materiais calculados e clique em "Mandar para o orçamento".', 'Coloca cada material como item do orçamento, com a quantidade de compra e o custo do estoque. Itens sem produto vinculado vão com preço zero para você completar.', 'ORC-2026-0012 · Construtora Modelo', 'Mandar duas vezes o mesmo cálculo: os itens são somados ao orçamento, não substituídos.', 19),
 ('projetos.calculadora.lista_compra', 'Lista de compra', 'Nada a preencher: o botão copia a lista pronta.', 'Gera um texto com a quantidade e a unidade de compra de cada material, para colar no WhatsApp ou e-mail do fornecedor.', '33 × pç · Chapa ST 12,5', 'Esquecer de vincular os produtos: a lista usa o nome genérico do material.', 20)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
