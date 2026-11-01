-- HB2 (RD-95): "?" do simulador do contrato em /dashboard/projetos/tabelas-preco.
-- Só acrescenta texto de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.simulador', 'Simulador do contrato', 'Escolha serviço, quantidade e condição acima: o resumo mostra a faixa, o preço e o total que valerão na medição.', 'Vendedor e cliente conferem o valor antes de executar; a medição aplica exatamente esta mesma regra.', '350 m² no sábado: faixa 100–500, R$ 30,00 por m², total R$ 10.500,00', 'Esquecer de escolher a condição (sábado, noturno) e estranhar o adicional na medição.', 45)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
