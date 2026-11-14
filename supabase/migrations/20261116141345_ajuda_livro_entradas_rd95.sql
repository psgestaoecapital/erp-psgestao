-- Commerce · Compras · Livro de Entradas (/dashboard/commerce/livro-entradas) — RD-95: "?" dos filtros e ações
-- ============================================================================
-- GAP (PDCA / anti-ócio GE): a tela do Livro de Entradas renderiza fn_fiscal_livro_entradas
--   (notas de compra por CFOP, base e ICMS no formato do contador) mas NÃO tinha nenhum "?"
--   (zero AjudaCampo). RD-95 pede ajuda em todo filtro e ação que o usuário usa.
-- CORREÇÃO (aditiva, idempotente): quatro chaves em erp_ajuda_campo — os dois filtros (Competência,
--   "Todas (trimestre)") e as duas ações (Exportar CSV, PDF); o front (page.tsx) passa a renderizar
--   <AjudaCampo chave="..."> ao lado de cada um.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- Não toca cálculo fiscal, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.livro_entradas.filtro_competencia', '/dashboard/commerce/livro-entradas', 'Livro de Entradas', 'Competência',
   'O mês/ano das notas de compra que você quer ver no livro (ex.: novembro de 2026).',
   'Filtra as notas de entrada pelo período de apuração — o livro mostra só as notas desse mês e o total do cabeçalho é desse mês.',
   '11/2026', 'Fica desativado quando "Todas (trimestre)" está marcado — desmarque para escolher um mês específico.', 'gestao_empresarial', 10),

  ('commerce.livro_entradas.filtro_todas', '/dashboard/commerce/livro-entradas', 'Livro de Entradas', 'Todas (trimestre)',
   'Marque para somar todas as competências do trimestre de uma vez, em vez de um mês só.',
   'Mostra o livro consolidado do trimestre (útil para conferir o total trimestral); ao marcar, o campo Competência é ignorado.',
   'Marcado para ver o trimestre inteiro de uma vez', 'Lembre que o total do cabeçalho muda: marcado soma o trimestre, desmarcado soma só o mês escolhido.', 'gestao_empresarial', 20),

  ('commerce.livro_entradas.exportar_csv', '/dashboard/commerce/livro-entradas', 'Livro de Entradas', 'Exportar CSV',
   'Baixa o livro do período em arquivo CSV (planilha) para enviar à contabilidade ou importar em outro sistema.',
   'Gera o arquivo das notas listadas e registra a exportação com um código de verificação (hash) para rastreabilidade.',
   'Clicar para baixar livro_entradas_11-2026.csv', 'Fica desativado quando não há nota no período — escolha uma competência com notas antes de exportar.', 'gestao_empresarial', 30),

  ('commerce.livro_entradas.imprimir_pdf', '/dashboard/commerce/livro-entradas', 'Livro de Entradas', 'PDF (imprimir)',
   'Abre a janela de impressão do navegador para salvar o livro do período em PDF ou imprimir no papel.',
   'Gera uma via do livro no formato que a contabilidade lê, sem alterar nada nos dados.',
   'Clicar e escolher "Salvar como PDF" na janela de impressão', 'Se a janela não abrir, verifique se o navegador não está bloqueando a impressão/pop-up.', 'gestao_empresarial', 40)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
