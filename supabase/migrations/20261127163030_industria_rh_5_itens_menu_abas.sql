-- =====================================================================
-- feat(indústria/rh): PR 2 — menu de RH em 5 itens + "?" das abas (CEO 25/11). Entra JUNTO com as abas e os
-- redirects no front (nunca antes — senão as telas que saem do menu ficam órfãs, o que a #6212 evitou).
-- module_catalog/system_screens/erp_ajuda_campo NÃO são tabela de domínio (RD-97 ok). Nada é apagado (RD-30):
-- os 5 itens que saem do menu só ficam com ativo=false; suas telas viram ABA e a rota antiga redireciona no front.
--
-- Estrutura final (subgrupo recursos_humanos, EXATAMENTE 5 itens):
--   1 Painel de RH   → /dashboard/industrial/rh/bi       · abas: Painel · Lotação e remuneração variável
--   2 Pessoas        → /dashboard/industrial/rh/pessoas  · abas: Cadastro · Quadro de pessoal · Custo da mão de obra
--   3 Postos e vagas → /dashboard/produtividade          · abas: Postos · Vagas e reposição · Importar quadro
--   4 Ponto          → /dashboard/industrial/ponto       · (tela única)
--   5 Folha          → /dashboard/industrial/folha       · abas: Folha · Encargos (PR 1)
-- Saem do menu (viram aba; rota antiga redireciona no front):
--   industrial_rh_quadro → Pessoas?aba=quadro · industrial_mao_obra → Pessoas?aba=custo
--   industrial_rh_vagas → Postos e vagas?aba=vagas · industrial_rh_importar_quadro → Postos e vagas?aba=importar
--   industrial_rh_painel → Painel de RH?aba=lotacao
-- =====================================================================

-- (1) 5 itens que FICAM (renomeia + reordena 1..5)
UPDATE public.module_catalog SET nome = 'Painel de RH',   ordem = 1, ativo = true WHERE id = 'industrial_rh_bi';
UPDATE public.module_catalog SET nome = 'Pessoas',        ordem = 2, ativo = true WHERE id = 'industrial_rh_pessoas';
UPDATE public.module_catalog SET nome = 'Postos e vagas', ordem = 3, ativo = true WHERE id = 'produtividade';
UPDATE public.module_catalog SET nome = 'Ponto',          ordem = 4, ativo = true WHERE id = 'industrial_ponto_eletronico';
UPDATE public.module_catalog SET nome = 'Folha',          ordem = 5, ativo = true WHERE id = 'industrial_folha_pagamento';

-- (2) 5 itens que SAEM do menu (viram aba; rota antiga redireciona no front). NÃO apaga (RD-30).
UPDATE public.module_catalog SET ativo = false
 WHERE id IN ('industrial_rh_quadro','industrial_rh_importar_quadro','industrial_rh_vagas','industrial_mao_obra','industrial_rh_painel');

-- (3) system_screens: alinha o título das 5 telas que ficam (as que saem permanecem cadastradas, RD-30).
UPDATE public.system_screens SET titulo = 'Painel de RH',   atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/bi';
UPDATE public.system_screens SET titulo = 'Pessoas',        atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/pessoas';
UPDATE public.system_screens SET titulo = 'Postos e vagas', atualizado_em = now() WHERE rota = '/dashboard/produtividade';
UPDATE public.system_screens SET titulo = 'Ponto',          atualizado_em = now() WHERE rota = '/dashboard/industrial/ponto';
UPDATE public.system_screens SET titulo = 'Folha',          atualizado_em = now() WHERE rota = '/dashboard/industrial/folha';

-- (4) RD-95 — "?" de cada ABA das 4 telas com abas (Ponto é tela única). Texto em linguagem do usuário.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 -- Painel de RH
 ('industrial.rh.painel.aba.painel', '/dashboard/industrial/rh/bi', 'Painel de RH', 'Aba Painel',
  'Nada — é a aba de indicadores de RH.',
  'Mostra os números de gente da empresa: headcount, custo, turnover, horas e afins, para acompanhar o mês.',
  'Headcount, custo da folha, turnover.', 'Procurar cadastro aqui: cadastro de pessoas fica na tela Pessoas.',
  'industria', 70, 'publicado'),
 ('industrial.rh.painel.aba.lotacao', '/dashboard/industrial/rh/bi', 'Painel de RH', 'Aba Lotação e remuneração variável',
  'Nada — é a aba de lotação e remuneração variável.',
  'Mostra onde cada pessoa está lotada e a parte variável da remuneração (prêmios, comissões, metas).',
  'Lotação por setor, prêmio por meta.', 'Confundir com a folha: aqui é a visão de lotação/variável, não o cálculo da folha.',
  'industria', 71, 'publicado'),
 -- Pessoas
 ('industrial.rh.pessoas.aba.cadastro', '/dashboard/industrial/rh/pessoas', 'Pessoas', 'Aba Cadastro',
  'Nada — é a aba de cadastro das pessoas.',
  'Cadastra cada pessoa com o custo completo (salário, encargos, benefícios), puxando do ponto ou digitado.',
  'Admitir pessoa, editar salário e benefícios.', 'Esperar o quadro aqui: a visão consolidada fica na aba Quadro de pessoal.',
  'industria', 72, 'publicado'),
 ('industrial.rh.pessoas.aba.quadro', '/dashboard/industrial/rh/pessoas', 'Pessoas', 'Aba Quadro de pessoal',
  'Nada — é a aba do quadro de pessoal.',
  'Mostra o quadro consolidado (quem está em cada setor/função, com o custo), para ver a estrutura de gente de uma vez.',
  'Quadro por setor com custo total.', 'Editar a pessoa aqui: edição individual fica na aba Cadastro.',
  'industria', 73, 'publicado'),
 ('industrial.rh.pessoas.aba.custo', '/dashboard/industrial/rh/pessoas', 'Pessoas', 'Aba Custo da mão de obra',
  'Nada — é a aba de custo da mão de obra.',
  'Mostra o custo da mão de obra a partir da folha (com encargos), por pessoa, setor e equipe.',
  'Custo por setor, custo por equipe.', 'Mudar o % de encargos aqui: o % se edita em Folha › Encargos.',
  'industria', 74, 'publicado'),
 -- Postos e vagas
 ('industrial.rh.postos.aba.postos', '/dashboard/produtividade', 'Postos e vagas', 'Aba Postos',
  'Nada — é a aba de postos de trabalho.',
  'Mostra cada posto de trabalho (posto a posto) e a produtividade associada.',
  'Posto, turno, pessoas alocadas.', 'Abrir vaga aqui: a reposição de vaga fica na aba Vagas e reposição.',
  'industria', 75, 'publicado'),
 ('industrial.rh.postos.aba.vagas', '/dashboard/produtividade', 'Postos e vagas', 'Aba Vagas e reposição',
  'Nada — é a aba de vagas e reposição.',
  'Controla as vagas em aberto e a reposição (quem saiu, o que precisa repor), ligada aos postos.',
  'Vaga aberta por saída, status da reposição.', 'Cadastrar a pessoa admitida aqui: o cadastro fica na tela Pessoas.',
  'industria', 76, 'publicado'),
 ('industrial.rh.postos.aba.importar', '/dashboard/produtividade', 'Postos e vagas', 'Aba Importar quadro',
  'Nada — é a aba de importação por planilha.',
  'Baixa um modelo .xlsx e sobe o quadro de postos em lote, para não digitar posto por posto.',
  'Baixar modelo, preencher, subir.', 'Subir planilha fora do modelo: use o modelo baixado para as colunas baterem.',
  'industria', 77, 'publicado'),
 -- Folha
 ('industrial.rh.folha.aba.folha', '/dashboard/industrial/folha', 'Folha', 'Aba Folha',
  'Nada — é a aba da folha de pagamento.',
  'Mostra a folha importada por competência (proventos, descontos, encargos) por pessoa.',
  'Folha de 10/2026 por pessoa.', 'Editar o % de encargos aqui: o % se edita na aba Encargos.',
  'industria', 78, 'publicado'),
 ('industrial.rh.folha.aba.encargos', '/dashboard/industrial/folha', 'Folha', 'Aba Encargos',
  'Nada — é a aba de encargos sobre a folha.',
  'Define o % de encargos sobre a folha (padrão 36,5%), o mesmo número usado no custo do Quadro, no BI e na ficha.',
  '36,5% ou o % real da folha.', 'Confundir com INSS/IRRF do empregado: aqui é o encargo patronal.',
  'industria', 79, 'publicado')
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
