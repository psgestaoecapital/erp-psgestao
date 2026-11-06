-- HB0 (auditor F15 em /dashboard/projetos/propostas · "orçamento com itens reais"): a lista mostra a composição de cada
-- proposta (itens, quantos do catálogo, margem). Só acrescenta os textos do "?" (RD-95) das áreas novas.
-- Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.do_catalogo', 'Itens do catálogo', 'Nada a preencher: conta as propostas em que todos os itens vieram do catálogo de serviços ou produtos da empresa.', 'Mostra quantas propostas têm preço e custo vindos do cadastro, e não digitados à mão.', '4 de 5 propostas com todos os itens cadastrados.', 'Digitar o serviço à mão na proposta: ele fica sem custo e sem histórico no catálogo.', 18),
 ('projetos.propostas.composicao', 'Itens da proposta', 'Nada a preencher: quantos itens a proposta tem e quantos não vieram do catálogo.', 'Ajuda a achar proposta vazia ou com item avulso antes de enviar ao cliente.', '2 item(ns) · do catálogo.', 'Enviar proposta "sem itens": o cliente recebe só o total, sem o que está sendo vendido.', 19),
 ('projetos.propostas.margem', 'Margem dos itens', 'Nada a preencher: (preço dos itens − custo dos itens) ÷ preço dos itens. Item sem custo deixa a margem como "sem custo".', 'Mostra quanto sobra do preço depois do custo direto dos serviços e materiais, antes de frete e impostos da nota.', 'Preço R$ 39.716,00 e custo R$ 29.419,55 = 25,9%.', 'Confundir com BDI: o BDI é o acréscimo sobre o custo; a margem é a parte do preço que sobra.', 20)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
