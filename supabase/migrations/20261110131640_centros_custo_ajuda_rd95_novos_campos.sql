-- RD-95: "?" (AjudaCampo) nos campos do cadastro manual e nos novos filtros da tela
-- Centros de Custo (/dashboard/gestao-empresarial/centros-custo). As COLUNAS da tabela já têm
-- chave; faltavam os campos do bloco "Cadastrar centro de custo manualmente", a busca e o filtro.
-- Aditiva/idempotente (ON CONFLICT DO NOTHING). Exemplos neutros (GE universal, não acopla a vertical).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ge.centros_custo.novo_nome', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Nome do centro (cadastro manual)',
   'Digite o nome/código do centro de custo que você quer criar antes de existir qualquer lançamento com ele.',
   'Permite mapear o centro adiantado — assim, quando o lançamento chegar, ele já entra classificado no resultado por negócio.',
   'ADMIN · COMERCIAL · PROJETO_X', 'Usar nomes diferentes para o mesmo centro (ex.: "ADM" e "ADMIN"): viram dois centros separados.',
   'gestao_empresarial', 10, 1, 'publicado'),

  ('ge.centros_custo.novo_tipo', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Tipo (cadastro manual)',
   'Escolha como o custo é apropriado: direto (vai inteiro a uma linha), comum (rateado entre linhas) ou extra (fora do rateio, só revisar).',
   'Define se o valor do centro vai inteiro a um negócio, é dividido entre negócios ou fica de fora do rateio.',
   'Aluguel do galpão de uma linha = direto; energia da matriz = comum.', 'Marcar como "direto" sem escolher a linha: o valor não chega a nenhum negócio.',
   'gestao_empresarial', 11, 1, 'publicado'),

  ('ge.centros_custo.novo_linha', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Linha (cadastro manual)',
   'Escolha a linha de negócio a que o centro pertence (obrigatório quando o tipo é direto; em comum/extra pode ficar em branco).',
   'Liga a receita/despesa do centro ao negócio certo no resultado por negócio e no DRE Divisional.',
   'Centro "COMERCIAL" → linha "Varejo".', 'Deixar um centro direto sem linha: sem a linha o valor não aparece no negócio.',
   'gestao_empresarial', 12, 1, 'publicado'),

  ('ge.centros_custo.novo_lote', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Lote (cadastro manual)',
   'Só aparece quando a empresa usa lotes (p. ex. pecuária/safra) e o tipo é direto: escolha o lote específico; senão deixe em branco.',
   'Detalha o custo direto até o lote de produção, para medir resultado por lote além do resultado por negócio.',
   'Custo de insumo do lote "2026-01".', 'Selecionar lote em centro comum/extra: o lote só vale para o tipo direto.',
   'gestao_empresarial', 13, 1, 'publicado'),

  ('ge.centros_custo.novo_cadastrar', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Cadastrar (botão)',
   'Clique para criar o centro com o tipo e a linha escolhidos. Ele passa a aparecer na lista de centros ao lançar despesa/receita.',
   'Grava o mapeamento do centro para que o rateio e o resultado por negócio já o reconheçam.',
   'Preenche "ADMIN" + comum e clica em Cadastrar.', 'Clicar sem preencher o nome: o centro não é criado.',
   'gestao_empresarial', 14, 1, 'publicado'),

  ('ge.centros_custo.busca', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Buscar centro',
   'Digite parte do nome do centro para filtrar a lista — útil quando há muitos centros.',
   'Encontra rapidamente um centro específico sem rolar toda a lista.',
   'Digitar "PROJ" para ver os centros de projeto.', 'Esperar que a busca procure por valor/linha: ela filtra pelo nome do centro.',
   'gestao_empresarial', 15, 1, 'publicado'),

  ('ge.centros_custo.filtro_status', '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Filtro de status',
   'Filtre a lista por situação: Todos, Não mapeados (precisam de classificação), Mapeados (ativos) ou Inativos.',
   'Ajuda a focar no que falta: comece pelos "Não mapeados", que entram como extra+revisar até serem classificados.',
   'Escolher "Não mapeados" para resolver as pendências primeiro.', 'Achar que "Inativos" sumiram: eles seguem no histórico, só não são mais aplicados no rateio.',
   'gestao_empresarial', 16, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
