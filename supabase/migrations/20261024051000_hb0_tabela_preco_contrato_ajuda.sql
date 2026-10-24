-- HB0 (auditor F10 em /dashboard/projetos/tabelas-preco): a tela passa a mostrar o contrato completo e a vigência.
-- Só acrescenta os textos do "?" (RD-95) das duas áreas novas. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.vigencia', 'Vigência da tabela', 'Nada a preencher: mostra de quando até quando a tabela vale e quantos serviços e adicionais ela tem.', 'Confirma que você está usando o contrato em vigor antes de passar preço ao cliente.', 'Vigência 01/01/2026 a 31/12/2026 · 2 serviço(s) · 2 adicional(is).', 'Orçar com uma tabela vencida: confira a data final.', 7),
 ('hub.tabela_preco.contrato', 'Contrato completo', 'Nada a preencher: toque num preço para levar serviço, faixa e condição para a calculadora.', 'Mostra todo o contrato numa tela só: cada faixa de quantidade, o preço em cada condição (normal, noturno, domingo…) e o código do item no sistema do cliente.', 'Forro de gesso, faixa 100–300, domingo: preço fixo de R$ 135,00, cód. VV-FOR-01D.', 'Achar que o adicional vale para o preço fixo: quando a condição tem preço fixo, ele substitui o adicional.', 8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
