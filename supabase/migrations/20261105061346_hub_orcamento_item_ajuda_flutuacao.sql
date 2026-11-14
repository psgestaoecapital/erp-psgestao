-- ONDA 1 (HUB) · Item de composição unificado — UI do aviso de flutuação de custo.
-- Aditiva e idempotente: cadastra a chave de ajuda (RD-95 "?") do aviso "custo do estoque mudou"
-- na tela /dashboard/hub/orcamento-itens (faixa no topo do orçamento aberto).
-- Só dado de referência global (erp_ajuda_campo); não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'hub.orcamento_itens.aviso_flutuacao',
  '/dashboard/hub/orcamento-itens',
  'Itens do orçamento · Custo',
  'Custo do estoque mudou',
  'Indicador (não é campo): aparece quando o custo de um item de catálogo mudou no estoque (ex.: nova compra) depois de o item entrar no orçamento. Mostra de quanto para quanto e o botão "Atualizar custo" aplica o custo atual naquele item, em um toque.',
  'Mantém o orçamento ainda aberto fiel ao custo real do estoque, sem redigitar: o aviso só aparece em orçamento editável e em itens vindos do catálogo. Orçamento aprovado congela o custo do momento da aprovação e não mostra o aviso.',
  'O produto mais caro do orçamento foi recomprado por um valor maior; o aviso mostra "subiu de R$ 100,00 para R$ 112,00" e, ao tocar em Atualizar custo, o item passa a usar R$ 112,00.',
  'Achar que o aviso muda o preço de venda: ele atualiza só o custo de referência do item (a margem recalcula); o preço unitário e os descontos continuam como você definiu.',
  'hub',
  33
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'hub.orcamento_itens.aviso_flutuacao'
);
