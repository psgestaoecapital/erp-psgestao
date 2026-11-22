-- Blueprint vivo (tabela que os auditores PDCA medem) alinhado à ÚLTIMA versão dos documentos mestres.
-- CEO 20/11/2026: "garantir que tudo esteja na última versão dos blueprints".
--
-- 1) PS EHS: o plano aprovado V11 (14/11, erp_documento_vertical 3135a5d8) tem 22 módulos (M1–M22) e
--    10 ondas, mas só estava no documento; a tabela tinha 58 linhas de referência. Aqui cada função do
--    "Mapa completo de módulos e funções" vira um requisito (tela_num = número do módulo), com a onda
--    do plano. A coluna de referência de mercado NÃO é copiada (RD-100). Lido do próprio documento
--    vigente, para não haver segunda cópia divergente.
-- 2) Hub: o addendum V29 (15/11, doc 6660af98) — coluna "PRECISA adicionar" da matriz consolidada e a
--    triagem "copiar já" — vira a tela 327.
-- Aditivo e idempotente (ON CONFLICT DO NOTHING). Sem dado de cliente.

WITH d AS (
  SELECT conteudo_md AS c FROM erp_documento_vertical WHERE id = '3135a5d8-cbff-4528-bebc-1b177396234e'
), s AS (
  SELECT substr(c, strpos(c, '## 4. Mapa completo'),
                strpos(c, '## 5. As inovações') - strpos(c, '## 4. Mapa completo')) AS t
  FROM d WHERE strpos(c, '## 4. Mapa completo') > 0
), l AS (
  SELECT x.n, x.linha FROM s, regexp_split_to_table(s.t, E'\n') WITH ORDINALITY AS x(linha, n)
), m AS (
  SELECT n, linha, regexp_match(linha, '^### M(\d+) · (.*?)( · NO AR)?\s*$') AS mm FROM l
), h AS (
  SELECT n, linha, max(CASE WHEN mm IS NOT NULL THEN n END) OVER (ORDER BY n) AS hn FROM m
), f AS (
  SELECT (mh.mm)[1]::int AS modulo, trim((mh.mm)[2]) AS modulo_nome,
         string_to_array(trim(both '|' from trim(h.linha)), '|') AS cols
  FROM h JOIN m mh ON mh.n = h.hn
  WHERE h.linha LIKE '| %' AND h.linha NOT LIKE '| Função%' AND h.linha NOT LIKE '| ---%'
), r AS (
  SELECT modulo, modulo_nome,
         trim(cols[1]) AS funcao,
         replace(trim(coalesce(cols[2], '')), '(ATAK)', '(sistema de produção)') AS detalhe,
         CASE modulo WHEN 1 THEN 'E1' WHEN 2 THEN 'E2' WHEN 3 THEN 'E8' WHEN 4 THEN 'E8' WHEN 5 THEN 'E9'
                     WHEN 6 THEN 'E4' WHEN 7 THEN 'E6' WHEN 8 THEN 'E6' WHEN 9 THEN 'E0' WHEN 10 THEN 'E3/E7'
                     WHEN 11 THEN 'E7' WHEN 12 THEN 'E7' WHEN 15 THEN 'E5' ELSE 'E9' END AS onda
  FROM f
)
INSERT INTO blueprint_tela_requisito (vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
SELECT 'ehs', r.modulo,
       'PS EHS · M' || r.modulo || ' ' || r.modulo_nome,
       CASE r.modulo WHEN 1 THEN '/dashboard/ehs/setores' WHEN 2 THEN '/dashboard/ehs/matriz'
                     WHEN 7 THEN '/dashboard/ehs/epi' WHEN 8 THEN '/dashboard/ehs/treinamentos-por-setor'
                     WHEN 9 THEN '/dashboard/ehs/pausas-tecnicas' WHEN 13 THEN '/dashboard/ehs/prestadores'
                     WHEN 17 THEN '/dashboard/ehs/validacao-automatica' WHEN 19 THEN '/dashboard/ehs/cockpit'
                     ELSE NULL END,
       r.funcao || CASE WHEN r.detalhe <> '' THEN ': ' || r.detalhe ELSE '' END
         || ' [PS EHS V11 · M' || r.modulo || ' · onda ' || r.onda || ']',
       CASE WHEN r.modulo IN (19, 22) OR r.funcao ~* 'painel' THEN 'bloco' ELSE 'tela' END,
       CASE WHEN r.funcao ~* '(IA|Previs[aã]o|Compara[cç][aã]o setorial|maturidade|ROI|Sensores|por v[ií]deo|Mapa de riscos|Radar|Simula[cç][aã]o de fiscaliza|API)'
            THEN 'diferencial' ELSE 'essencial' END,
       CASE
         WHEN r.modulo = 9 AND r.funcao ~* '(Motor de infra|Sensores)' THEN 'ausente'
         WHEN r.modulo = 9 AND r.funcao ~* 'Regime por ambiente' THEN 'parcial'
         WHEN r.modulo = 9 THEN 'atendido'
         WHEN r.modulo = 17 AND r.funcao ~* 'Matriz de conformidade' THEN 'atendido'
         WHEN (r.modulo = 1 AND r.funcao ~* '(Empresas|Setores|Trabalhadores|Fun[cç][oõ]es)')
           OR (r.modulo = 2 AND r.funcao ~* 'Invent[aá]rio')
           OR (r.modulo = 7 AND r.funcao ~* '(Matriz de EPI|Ficha|Estoque)')
           OR (r.modulo = 8 AND r.funcao ~* '(Matriz por NR|Vencimento)')
           OR (r.modulo = 13 AND r.funcao ~* '(Portal da contratada|Valida)')
           OR (r.modulo = 15 AND r.funcao ~* '(Painel|Valida)')
           OR (r.modulo = 19 AND r.funcao ~* 'Painel')
           THEN 'parcial'
         ELSE 'ausente' END
FROM r
ON CONFLICT (vertical, tela_num, requisito) DO NOTHING;

-- 2) Hub · V29 (15/11): o que o benchmark consolidado diz que PRECISA entrar
INSERT INTO blueprint_tela_requisito (vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
VALUES
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Orçamento com bases oficiais de custo, BDI e composição por insumo. [Hub V29.3 · copiar já]', 'tela', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Curva ABC da obra por fase, serviço, insumo, categoria e tipo de custo. [Hub V29.3 · copiar já]', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/[id]/cronograma', 'Gantt real com dependências, caminho crítico, linhas de base e curva S. [Hub V29.3]', 'tela', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/[id]/rdo', 'RDO gerado (um por dia por obra) com clima, mão de obra, equipamentos, atividades, ocorrências, checklist, material, fotos e anexos; assinatura por link e aprovação em quadro. [Hub V29.3 · copiar já]', 'tela', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Apontamento único de campo que alimenta RDO, avanço físico e medição. [Hub V29.4 · copiar já]', 'regra', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/[id]/medicoes', 'Medição dentro do contrato por período: quantidade, valor e %, acumulado e saldo, complementar e estorno. [Hub V29.4 · copiar já]', 'regra', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Motor único de contrato para A Pagar e A Receber, itens = tarefas do orçamento, com retenção, dedução, adiantamento, aditivo e reajuste; liberação gera título. [Hub V29.4 · copiar já]', 'regra', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/resultado', 'Apropriação por tarefa e insumo, alerta acima de 100%, lucro previsto × realizado e índices de desempenho de prazo e custo. [Hub V29.3]', 'regra', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Compras de obra: solicitação → cotação → mapa de cotação → alçada (inclusive do cliente) → ordem → recebimento parcial. [Hub V29.4 · copiar já]', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/[id]/materiais', 'Estoque de obra: almoxarifados, transferência entre obras, estoque mínimo e apropriação na baixa. [Hub V29.3]', 'tela', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Fichas de verificação de serviço configuráveis (pontuação e criticidade), reinspeção que reaproveita a ficha, inspeção ligada à medição. [Hub V29.4 · copiar já]', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'Gestão de pranchas com versões, marcações e leitura automática de número e título. [Hub V29.3]', 'tela', 'diferencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/obras/[id]/portal-cliente', 'Portal do cliente enriquecido: boletos, pastas, diário com fotos, mensagens, previsto × realizado e aprovação de compra pelo cliente. [Hub V29.3]', 'tela', 'essencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'App de campo que funciona sem internet: diário, aprovações e recebimentos. [Hub V29.3]', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/desempenho', 'Painel de obra: obras por situação, economia nas cotações e desempenho por fornecedor. [Hub V29.3]', 'bloco', 'diferencial', 'parcial'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', NULL, 'IA de campo (voz → RDO) e assistente que responde sobre os dados da obra. [Hub V29.3]', 'regra', 'diferencial', 'ausente'),
  ('hub_projetos', 327, 'Hub V29 · Benchmark consolidado — o que precisa entrar', '/dashboard/projetos/mao-obra', 'Importador de mão de obra (encargos da empresa e funcionários com CBO, vínculo e regime) e ponto da obra. [Hub V29.3]', 'regra', 'essencial', 'parcial')
ON CONFLICT (vertical, tela_num, requisito) DO NOTHING;
