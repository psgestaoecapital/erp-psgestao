-- Cadastro de produtos (/dashboard/cadastros/produtos) — RD-95 "?" no modal Etiquetas A4
-- ============================================================================
-- GAP (RD-95): o modal EtiquetasProdutosModal tinha 3 campos SEM "?": "Cópias de cada produto",
--   "Começar na etiqueta nº" e "Imprimir código de barras". A ação "Etiquetas A4" já tinha chave
--   (cadastros.produtos.etiquetas); faltava a ajuda dos campos de configuração da impressão.
-- CORREÇÃO (aditiva, idempotente): 3 chaves NOVAS na rota do cadastro de produtos.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cadastros.produtos.etiqueta_copias', '/dashboard/cadastros/produtos', 'Produto · Etiquetas', 'Cópias de cada produto',
   'Quantas etiquetas iguais imprimir de CADA produto selecionado. De 1 a 100.',
   'Multiplica a impressão: se você escolheu 5 produtos e pede 3 cópias, saem 15 etiquetas. Use quando precisa de várias etiquetas do mesmo item (ex.: caixas iguais).',
   '3', 'Cópias é por produto, não o total de etiquetas. O total (produtos × cópias) aparece no resumo logo abaixo.', 'gestao_empresarial', 60),

  ('cadastros.produtos.etiqueta_inicio', '/dashboard/cadastros/produtos', 'Produto · Etiquetas', 'Começar na etiqueta nº',
   'Em qual posição da folha A4 a impressão deve começar (1 = primeira etiqueta, canto superior esquerdo).',
   'Permite reaproveitar uma folha de etiquetas já usada em parte: pule as posições gastas e comece onde ainda há etiqueta em branco.',
   '7 (folha com as 6 primeiras já usadas)', 'Contar a partir de 0 ou passar do total de etiquetas da folha — a numeração começa em 1 e vai até o máximo da folha.', 'gestao_empresarial', 61),

  ('cadastros.produtos.etiqueta_barras', '/dashboard/cadastros/produtos', 'Produto · Etiquetas', 'Imprimir código de barras',
   'Escolha Sim para sair o código de barras na etiqueta, ou Não para usar esse espaço com o texto em letra maior.',
   'Quem tem leitor de código de barras imprime com barras (Sim). Quem só lê à mão ganha legibilidade escolhendo Não.',
   'Sim, para bipar no caixa', 'Produto sem código de barras cadastrado sai sem as barras mesmo com "Sim" — preencha o EAN na ficha do produto.', 'gestao_empresarial', 62)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
