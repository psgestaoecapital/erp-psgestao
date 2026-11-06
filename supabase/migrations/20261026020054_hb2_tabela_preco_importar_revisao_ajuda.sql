-- HB2 (RD-95): "?" da revisão lado a lado da importação de planilha em /dashboard/projetos/tabelas-preco.
-- Só acrescenta texto de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.importar_revisao', 'Revisão lado a lado', 'Não precisa preencher: confira cada linha colada ao lado do que o sistema entendeu.', 'Mostra, antes de gravar, o texto original e o resultado (serviço, faixa, unidade, preço) ou o motivo da recusa.', 'Linha 2: Piso de uretano 6 mm · 0–300 m² · R$ 98,00', 'Importar sem conferir e gravar preço na coluna errada.', 45)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
