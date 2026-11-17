-- GE · /dashboard/orcamentos — chaves de ajuda RD-95 ("?") para os dois campos em R$ do bloco de
-- fechamento do orçamento (Valor Frete e Desc. Geral em R$), que passaram a usar o CampoMoeda (#6874,
-- formatação automática em R$). Antes não tinham "?". ADITIVO e idempotente: só linhas novas em
-- erp_ajuda_campo (ON CONFLICT DO NOTHING). Nenhuma função/view/policy muda. Nenhum dado de cliente é tocado.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('orcamentos.campo.frete_valor', '/dashboard/orcamentos', 'Valor Frete (R$)',
  'O valor do frete em reais, quando o frete é cobrado à parte dos itens. Digite só os números: o campo formata sozinho em R$.',
  'Entra no total do orçamento somado aos itens (depois de descontos), como acréscimo de frete.',
  'R$ 150,00 de frete numa entrega.', 'Digitar o frete junto no preço dos itens e repetir aqui dobra o valor; informe o frete só neste campo.'),
 ('orcamentos.campo.desconto_valor', '/dashboard/orcamentos', 'Desc. Geral (R$)',
  'Um desconto geral em reais sobre o orçamento inteiro. Digite só os números: o campo formata sozinho em R$. Use junto ou no lugar do desconto geral em %.',
  'Abate do total do orçamento, somado ao desconto geral em % e aos descontos por item.',
  'R$ 100,00 de desconto fechado na proposta.', 'Desconto maior que o subtotal zera o total (não fica negativo); confira o valor antes de salvar.')
ON CONFLICT (chave) DO NOTHING;
