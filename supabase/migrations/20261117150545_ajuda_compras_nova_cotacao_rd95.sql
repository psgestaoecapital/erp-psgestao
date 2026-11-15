-- Compras & Cotações (/dashboard/commerce/compras) · modal "Nova Cotação" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): no assistente de nova cotação da tela Compras, os campos do passo
--   "Identificação" (Descrição, Solicitante, Data limite para respostas) usavam
--   o componente <Field> sem "?".
-- CORREÇÃO (aditiva, idempotente): o <Field> ganhou prop opcional `ajuda` e estes
--   3 campos passam a chave; 3 chaves NOVAS no grupo "Compras & Cotações".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.cot_descricao', '/dashboard/commerce/compras', 'Compras & Cotações', 'Descrição da cotação',
   'Um nome curto que identifique o que você vai comprar, para achar a cotação depois na lista de compras.',
   'Aparece na lista e nos convites aos fornecedores, para todos saberem do que se trata este pedido de preço.',
   'Materiais de drywall para a obra do centro · Reposição mensal de insumos.',
   'Descrição genérica demais ("compras") faz confundir uma cotação com outra — diga o que está sendo cotado.',
   'geral', 9245),
  ('commerce.compras.cot_solicitante', '/dashboard/commerce/compras', 'Compras & Cotações', 'Solicitante',
   'Quem está pedindo a compra (pessoa ou setor). Campo opcional, mas ajuda a rastrear a origem do pedido.',
   'Registra quem solicitou, para a área de compras saber a quem responder e para histórico de quem pediu o quê.',
   'João Silva (Compras) · Setor de Produção.',
   'Deixar em branco quando há várias frentes pedindo dificulta saber de quem foi a solicitação depois.',
   'geral', 9246),
  ('commerce.compras.cot_data_limite', '/dashboard/commerce/compras', 'Compras & Cotações', 'Data limite para respostas',
   'A data até quando os fornecedores podem enviar os preços desta cotação.',
   'Organiza o prazo da coleta: depois dessa data você compara as propostas e decide de quem comprar.',
   'Hoje + 5 dias úteis, se precisa fechar a compra na semana seguinte.',
   'Pôr uma data no passado ou curta demais faz o fornecedor não responder a tempo — dê um prazo realista.',
   'geral', 9247)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
