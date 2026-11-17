-- Estoque (/dashboard/commerce/estoque) · modal "Ajuste de estoque" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): no modal de Ajuste de estoque, os campos "Produto" e "Tipo"
--   (positivo/negativo) estavam sem "?". Os demais campos do modal (Local,
--   Quantidade, Custo, Motivo, Observações) já têm ajuda.
-- CORREÇÃO (aditiva, idempotente): os 2 rótulos ganham "?"; 2 chaves NOVAS no
--   grupo "Estoque · Ajuste".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.estoque.ajuste.produto', '/dashboard/commerce/estoque', 'Estoque · Ajuste', 'Produto',
   'O produto cujo saldo você vai corrigir. Busque pelo nome ou código; ao selecionar, o sistema mostra o saldo atual dele.',
   'Garante que o ajuste cai no item certo. O saldo atual exibido ajuda a conferir antes de confirmar a correção.',
   'Chapa de drywall 12,5 mm (saldo atual: 48 un).',
   'Ajustar o produto errado desalinha o estoque de dois itens — confira o nome e o saldo atual antes de confirmar.',
   'geral', 48),
  ('commerce.estoque.ajuste.tipo', '/dashboard/commerce/estoque', 'Estoque · Ajuste', 'Tipo do ajuste',
   'Escolha "Positivo" quando encontrar mais itens do que o sistema mostra (entra estoque) ou "Negativo" quando faltar (sai estoque).',
   'Define o sentido da correção: positivo soma à quantidade em estoque, negativo subtrai.',
   'Contagem física achou 2 a mais → Positivo; avaria de 1 unidade → Negativo.',
   'Inverter o sentido dobra o erro em vez de corrigir — positivo é "sobrou", negativo é "faltou".',
   'geral', 49)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
