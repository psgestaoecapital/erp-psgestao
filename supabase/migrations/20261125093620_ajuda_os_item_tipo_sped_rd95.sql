-- RD-95: "?" do Tipo de item (SPED) que passa a aparecer sob o nome de cada peça na ficha da OS
-- (/dashboard/os — #5452 item 2). Catálogo global de texto de ajuda; não toca estrutura, RLS nem dado de cliente.
-- Aditiva e idempotente: insere só a chave nova se ainda não existir (WHERE NOT EXISTS).
-- Segue a convenção já usada pelos campos de item desta tela (rota '/dashboard/os', grupo 'Oficina', vertical 'oficina').
-- Prova RD-38: SELECT count(*) WHERE chave='oficina.os.item_tipo_sped' = 0 antes, 1 depois (roda uma vez só).
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'oficina.os.item_tipo_sped', '/dashboard/os', 'Oficina', 'Tipo de item (SPED) da peça',
    'Este rótulo não é digitado: vem do cadastro do produto (campo Tipo de item SPED). Para mudá-lo, ajuste o produto em Cadastros.',
    'Mostra se a peça é estoque "quente" (00 - Mercadoria para revenda, pode sair em nota fiscal) ou "frio" (99 - Outras, não pode ser faturada), guiando a baixa de estoque e a emissão da NF-e.',
    '00 - Mercadoria para revenda',
    'Confundir item 99 (frio) com item 00 (quente) ao faturar — o item 99 não pode ser emitido em NF-e de venda.',
    'oficina', 6
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave
);
