-- RD-95 · #5660: o campo Quantidade (Qtd) da linha de item do Orçamento passou a aceitar vírgula
-- (type=text inputMode=decimal + parseNumBR) e ganhou o "?" (AjudaCampo) no cabeçalho da coluna.
-- Esta migration cadastra a chave que a tela /dashboard/orcamentos passa a referenciar.
--
-- Aditivo (RD-55): só INSERT em catálogo de ajuda (erp_ajuda_campo), sem DDL, RLS, função ou dado de cliente.
-- IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING — rodar 2x não duplica nem sobrescreve texto já publicado.
-- Reverter: DELETE FROM public.erp_ajuda_campo WHERE chave = 'orcamentos.item.quantidade';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('orcamentos.item.quantidade', '/dashboard/orcamentos', 'Orçamentos', 'Quantidade (Qtd)',
   'Quantas unidades deste item entram no orçamento. Aceita vírgula para frações (ex.: 1,5 m², 2,25 h).',
   'Multiplica pelo preço unitário para formar o subtotal da linha e, somadas as linhas, o total do orçamento.',
   '1,5 (um e meio) · 10 · 2,25.',
   'Digitar com ponto achando que a vírgula não entra (agora entra); deixar 0, que zera o subtotal da linha.',
   'projetos', 3)
ON CONFLICT (chave) DO NOTHING;
