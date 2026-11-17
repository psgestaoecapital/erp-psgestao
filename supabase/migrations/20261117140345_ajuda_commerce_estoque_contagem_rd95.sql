-- Comércio · Estoque › Planilha de contagem (inventário) — RD-95 "?" nos campos dos 2 modais (fatia)
-- ============================================================================
-- GAP (RD-95 · aud8 estoque 86–92): os modais "Baixar planilha de contagem" e "Subir contagem"
--   (src/components/estoque/PlanilhaContagemInventario.tsx, usados em /dashboard/commerce/estoque,
--   aba Inventário) não tinham "?" em NENHUM campo. São 7 campos: Local, Grupo/categoria,
--   Só itens com saldo e Contagem cega (baixar) + Local do inventário, Planilha (.xlsx) e
--   o filtro Mostrar (subir/prévia).
-- CORREÇÃO (aditiva, idempotente): 7 chaves NOVAS no grupo "Estoque · Contagem".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.estoque.contagem.local', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Local',
   'Escolha o depósito/local cujos itens vão entrar na planilha de contagem.',
   'Define quais saldos serão impressos para a equipe conferir no físico. Cada local gera a sua própria planilha.',
   'Depósito Central', 'Baixar a planilha do local errado faz a contagem bater contra o saldo de outro depósito e gerar diferenças que não existem.', 'gestao_empresarial', 70),

  ('commerce.estoque.contagem.grupo', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Grupo / categoria',
   'Opcional: filtre por um grupo/categoria de produto. Deixe em "Todos" para a planilha com o estoque inteiro.',
   'Serve para contar por partes (ex.: só "Bebidas" hoje) sem precisar inventariar tudo de uma vez.',
   'Bebidas', 'Se não há grupos cadastrados, o filtro fica vazio — a planilha sai com todos os itens mesmo assim.', 'gestao_empresarial', 71),

  ('commerce.estoque.contagem.so_saldo', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Só itens com saldo',
   'Escolha "Sim" para listar apenas itens com saldo maior que zero, ou "Não" para incluir todos os produtos ativos.',
   'Encurta a planilha quando você só quer conferir o que, em tese, tem no estoque.',
   'Sim', 'Com "Sim", um item que o sistema diz ter zero mas existe no físico não aparece — use "Não" para achar sobras de itens zerados.', 'gestao_empresarial', 72),

  ('commerce.estoque.contagem.cega', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Contagem cega',
   'Escolha "Sim" para esconder o saldo do sistema na planilha, ou "Não" para imprimir o saldo ao lado para conferência.',
   'A contagem cega evita que quem conta apenas repita o número do sistema — o conferente escreve o que viu, sem viés.',
   'Sim', 'Imprimir com o saldo visível ("Não") tende a mascarar divergências, porque a pessoa copia o número em vez de contar.', 'gestao_empresarial', 73),

  ('commerce.estoque.contagem.subir_local', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Local do inventário',
   'Confirme o depósito/local em que as contagens desta planilha serão registradas.',
   'É o local do inventário que será criado a partir da planilha preenchida. Deve ser o mesmo local em que a planilha foi baixada.',
   'Depósito Central', 'Subir num local diferente do que gerou a planilha faz as diferenças saírem erradas.', 'gestao_empresarial', 74),

  ('commerce.estoque.contagem.arquivo', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Planilha de contagem (.xlsx)',
   'Selecione o arquivo .xlsx que foi baixado e preenchido com as quantidades contadas.',
   'O sistema lê a planilha, mostra a prévia das diferenças contra o saldo atual e só então cria o inventário. Nada é alterado no estoque antes de você fechar o inventário.',
   'contagem_inventario_Deposito_Central_20261117_0830.xlsx', 'Alterar colunas ou códigos da planilha baixada faz linhas caírem em "não entram" — preencha só a quantidade contada.', 'gestao_empresarial', 75),

  ('commerce.estoque.contagem.mostrar', '/dashboard/commerce/estoque', 'Estoque · Contagem', 'Mostrar',
   'Escolha "Só com diferença" para ver apenas os itens que divergiram, ou "Todos os contados" para a lista completa.',
   'Ajuda a focar nas divergências (sobras e faltas) na hora de conferir a prévia antes de criar o inventário.',
   'Só com diferença', 'Ver "Só com diferença" pode esconder itens contados que bateram certo — troque para "Todos os contados" se quiser o total conferido.', 'gestao_empresarial', 76)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
