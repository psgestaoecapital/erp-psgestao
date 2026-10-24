-- HB2 · precedência de preço (contrato do cliente > tabela por cliente > tabela padrão): texto do "?" (RD-95). Aditiva.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.precedencia', 'De onde vem o preço', 'Nada a preencher: o sistema mostra qual fonte deu o preço. A ordem é sempre contrato do cliente, depois tabela do cliente, depois tabela padrão.', 'Evita preço diferente entre orçamento, medição e nota: o que está no contrato vale primeiro.', 'Contrato do cliente tem o serviço → vale o preço do contrato, mesmo que a tabela padrão seja menor.', 'Achar que a tabela padrão vale quando o cliente tem contrato com o serviço.', 66)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
