-- Produtos da planta (/dashboard/produtividade/produtos) — RD-95: "?" nas duas ações sem ajuda
-- ============================================================================
-- GAP (PDCA aud8 13/11, nota 94/95): as 16 chaves cobriam colunas, filtros e importação, mas a ação
--   "Arquivar" (exclusão de cada linha) e o botão "+ Novo produto" NÃO tinham o "?" (AjudaCampo).
--   RD-95: toda ação precisa de ajuda — tela com ação sem "?" não é entregue.
-- CORREÇÃO (aditiva, idempotente): duas chaves em erp_ajuda_campo; o front (page.tsx) passa a
--   renderizar <AjudaCampo chave="..."> ao lado de cada uma.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('prod.produto.novo', '/dashboard/produtividade/produtos', 'Produtos', 'Novo produto',
   'Abre o formulário para cadastrar um produto da planta informando ao menos o código e o nome.',
   'Cria um produto novo quando ele não vem do sistema vinculado nem da planilha; o resto (papel, linha, conservação, peso) pode ser ajustado depois direto na tabela.',
   'Clicar em "+ Novo produto" e lançar o código 1001 — Dianteiro com osso.',
   'Precisa selecionar uma planta/empresa específica no topo antes de cadastrar.',
   'industria', 12),

  ('prod.produto.arquivar', '/dashboard/produtividade/produtos', 'Produtos', 'Arquivar produto',
   'Arquiva o produto da linha: ele sai da lista ativa, mas o histórico não é apagado.',
   'Tira de circulação um produto que não é mais usado sem perder o que já foi lançado com ele; pode ser reativado depois.',
   'Arquivar um corte que a planta deixou de produzir.',
   'Achar que apaga o produto — ele só é arquivado (fica fora da lista), e o histórico permanece.',
   'industria', 95)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
