-- HB2 Fatia 1: tela "Itens do orçamento" do Hub — "?" (RD-95) e registro em system_screens. Aditiva (só texto/registro novos).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Itens do orçamento', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/hub/orcamento-itens', 'hub', 'publicado'
FROM (VALUES
 ('hub.orcamento_itens.orcamento','Orçamento','Escolha o orçamento cujos itens quer ver ou alterar.','Define a lista de itens e o total mostrados abaixo.','ORC-0012 · Cliente X · rascunho','Orçamento já aprovado ou com escopo congelado só mostra os itens, sem alterar.',1),
 ('hub.orcamento_itens.total','Total do orçamento','Nada a preencher: é calculado sozinho.','Soma dos itens com descontos, acréscimos e frete do orçamento; muda a cada item incluído, editado ou excluído.','3 itens somando R$ 1.250,00.','Esperar que o total some o frete ou o desconto geral que ainda não foram lançados no orçamento.',2),
 ('hub.orcamento_itens.incluir','Incluir item','Toque para abrir o formulário de um item novo.','Acrescenta uma linha ao orçamento e recalcula o total.','Incluir “Parede de drywall”.','Botão desabilitado: o orçamento está congelado ou fora de edição.',3),
 ('hub.orcamento_itens.descricao','Descrição','Nome do serviço ou material como o cliente deve ler.','Aparece na proposta e na obra criada a partir do orçamento.','Parede drywall ST 12,5 mm','Deixar em branco: o sistema recusa.',4),
 ('hub.orcamento_itens.tipo','Tipo','Serviço (mão de obra) ou material/produto.','Separa serviço de material na proposta e na obra.','Serviço','Lançar material como serviço: o custo do estoque não é puxado.',5),
 ('hub.orcamento_itens.unidade','Unidade','Unidade de medida da quantidade.','Define como a quantidade e o preço unitário são lidos.','m², un, h','Misturar m² no preço e m na quantidade.',6),
 ('hub.orcamento_itens.quantidade','Quantidade','Quantas unidades serão fornecidas; maior que zero.','Multiplica o preço unitário para formar o subtotal.','12,5','Usar ponto de milhar; digite 1250,5 sem separador.',7),
 ('hub.orcamento_itens.preco','Preço unitário','Preço de venda de uma unidade, em reais.','Preço × quantidade, menos descontos, é o subtotal do item.','89,90','Informar o preço total em vez do unitário.',8),
 ('hub.orcamento_itens.desconto_pct','Desconto (%)','Desconto em percentual sobre o item, de 0 a 100.','Abate do subtotal do item antes de somar ao total.','5','Dar desconto aqui e de novo em reais para o mesmo motivo.',9),
 ('hub.orcamento_itens.desconto_valor','Desconto (R$)','Desconto fixo em reais sobre o item.','Abate do subtotal do item, somado ao desconto em %.','50,00','Valor maior que o item: o subtotal fica zerado.',10),
 ('hub.orcamento_itens.observacoes','Observações','Detalhe opcional do item.','Texto de apoio para quem executa e revisa.','Inclui rodapé e acabamento.','Colocar aqui o que deveria ir na descrição.',11),
 ('hub.orcamento_itens.salvar','Salvar item','Toque para gravar o item.','Grava o item, recalcula o total e registra no histórico do orçamento.','Salvar após conferir quantidade e preço.','Esquecer de salvar antes de trocar de orçamento.',12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.hub.orcamento_itens', '/dashboard/hub/orcamento-itens', 'hub', 'Hub · Itens do orçamento',
       'Incluir, editar e excluir os itens de um orçamento, com total recalculado e bloqueio quando o escopo está congelado.', 'pronto', true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/hub/orcamento-itens');
