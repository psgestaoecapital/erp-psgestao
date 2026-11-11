-- Revenda · Garantia (/dashboard/revenda/garantia) · RD-95
-- A tela não tinha "?" (AjudaCampo) nos campos do formulário "Registrar garantia numa venda"
-- (Venda, Prazo, KM limite, Termo) nem no período do relatório "Sinistro por modelo" (De/Até).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente) cadastra as chaves de ajuda;
-- o front passa a renderizar o "?" ao lado de cada rótulo.
-- Faixa de migration do desenvolvedor_4_g (segundos :46), acima da main.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/revenda/garantia', 'revenda', 'publicado'
FROM (VALUES
 ('revenda.garantia.venda','Registrar garantia','Venda','Escolha a venda em que a garantia será registrada. A lista traz só as vendas que ainda NÃO têm garantia (data, veículo, cliente e valor para você reconhecer).','Vincula a garantia ao carro e ao cliente certos, puxando os dados da venda.','"12/03/2026 · Fiat Argo · João Silva · R$ 62.000".','Registrar na venda errada: a garantia fica no cliente/carro trocado. Confira cliente e data antes de registrar.',1),
 ('revenda.garantia.prazo','Registrar garantia','Prazo (meses)','Quantos meses a garantia cobre, contados da entrega. Deixe em branco para usar o prazo padrão configurado da loja (placeholder "config").','Define a data de fim da cobertura e os alertas de vencimento.','3 para garantia de 3 meses; em branco usa o padrão da loja.','Digitar dias no lugar de meses (ex.: 90): o campo é em MESES.',2),
 ('revenda.garantia.km','Registrar garantia','KM limite','Opcional: quilometragem máxima coberta pela garantia (além do prazo). Deixe vazio se a garantia for só por tempo.','Encerra a cobertura quando o carro passa do KM, mesmo dentro do prazo.','5000 para cobrir até 5.000 km rodados após a entrega.','Preencher 0 achando que é "sem limite": 0 é limite zero. Deixe VAZIO para não limitar por KM.',3),
 ('revenda.garantia.termo','Registrar garantia','Termo da garantia','Texto com as cláusulas da garantia (o que cobre, o que não cobre, condições). Sai junto do termo de entrega do cliente.','Deixa registrado e assinado o que foi prometido, evitando discussão depois.','"Cobre motor e câmbio por 3 meses; não cobre itens de desgaste."','Deixar vago ("garantia de fábrica"): descreva o que a loja realmente cobre.',4),
 ('revenda.garantia.periodo_sinistro','Sinistro por modelo','Período (De / Até)','Escolha a janela de datas dos ACIONAMENTOS de garantia que entram no relatório "Sinistro por modelo".','Mostra, no período, quantas garantias foram acionadas por modelo e o custo — para enxergar o modelo que mais dá problema.','01/01/2026 a 31/12/2026 para ver o ano todo.','Período curto demais e concluir que "não há sinistro": amplie as datas.',5)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
