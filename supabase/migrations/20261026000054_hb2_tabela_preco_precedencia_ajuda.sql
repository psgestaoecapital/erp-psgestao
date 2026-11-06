-- HB2 (RD-95): "?" da precedência de preço (contrato > tabela por cliente > tabela padrão) em /dashboard/projetos/tabelas-preco.
-- Só acrescenta texto de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.precedencia', 'Qual preço vale', 'Não precisa preencher: a tela mostra de onde vem o preço e por quê.', 'Evita orçar com a tabela errada: contrato vigente do cliente vale mais que a tabela do cliente, que vale mais que a padrão.', 'Contrato do cliente: R$ 98,00 por m²', 'Achar que a tabela padrão vale quando o cliente tem contrato vigente.', 44)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
