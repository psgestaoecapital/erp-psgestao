-- SEED DEMO Indústria (RD-69: dado FICTÍCIO, só DEMO, nunca real) — destrava o aud8 nas 6 telas de Indústria.
-- Empresa DEMO Indústria = b0700000-0000-4000-a000-000000000005 (abatedouro fictício).
-- Tudo ADITIVO e IDEMPOTENTE (WHERE NOT EXISTS). Guarda RD-69: cada bloco só grava se a empresa existir e for is_demo=true.
-- Plant industrial já existente da DEMO: 49a0d5ae-c5f8-4969-a40e-46f800f1a2a1.
-- Aceite: plano de contas >=50, >=4 setores, >=10 postos, >=2 linhas de negócio.

-- ============================================================ 1) PLANO DE CONTAS
-- Copia as 62 contas sugeridas globais (preserva codigo/descricao/grupo/tipo/pai_codigo/nivel/is_totalizador, ativo=true).
-- Não propaga sugerida_global (fica no default false). WHERE NOT EXISTS por company_id+codigo.
-- DISTINCT ON (codigo): o catálogo global tem o mesmo codigo repetido em mais de um template;
-- pega uma linha por codigo (determinístico) para não violar uq_erp_plano_contas_codigo (company_id, codigo).
INSERT INTO public.erp_plano_contas (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, is_totalizador, ativo)
SELECT DISTINCT ON (g.codigo)
       'b0700000-0000-4000-a000-000000000005'::uuid, g.codigo, g.descricao, g.grupo, g.tipo, g.pai_codigo, g.nivel, g.is_totalizador, true
FROM public.erp_plano_contas g
WHERE g.sugerida_global = true
  AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000005' AND c.is_demo = true)
  AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas e
    WHERE e.company_id = 'b0700000-0000-4000-a000-000000000005' AND e.codigo = g.codigo
  )
ORDER BY g.codigo, g.nivel NULLS LAST, g.created_at;

-- ============================================================ 2) SETORES (prod_setor)
-- Já existem Abate (1) e Desossa (2); completa Expedição (3) e Quarteio (4). WHERE NOT EXISTS por company_id+nome.
INSERT INTO public.prod_setor (company_id, plant_id, nome, ordem, ativo)
SELECT 'b0700000-0000-4000-a000-000000000005'::uuid, '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1'::uuid, v.nome, v.ordem, true
FROM (VALUES ('Expedição', 3), ('Quarteio', 4)) AS v(nome, ordem)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000005' AND c.is_demo = true)
  AND NOT EXISTS (
    SELECT 1 FROM public.prod_setor s
    WHERE s.company_id = 'b0700000-0000-4000-a000-000000000005' AND s.nome = v.nome
  );

-- ============================================================ 3) POSTOS (prod_posto) — 12 postos fictícios, SEM pessoa real
-- numero único por company (WHERE NOT EXISTS por company_id+numero); setor_id resolvido pelo nome do setor.
-- supervisor_nome genérico/fictício (sem nome de pessoa real). cargo_id/categoria_produto_id ficam nulos.
INSERT INTO public.prod_posto (company_id, plant_id, setor_id, numero, atividade, descricao_funcao, centro_custo, capacidade_hora, supervisor_nome, ordem_linha, alocacao, ativo)
SELECT 'b0700000-0000-4000-a000-000000000005'::uuid, '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1'::uuid,
       s.id, v.numero, v.atividade, v.descricao_funcao, v.centro_custo, v.capacidade_hora::numeric, v.supervisor_nome, v.ordem_linha, 'fixa', true
FROM (VALUES
  ('Abate',     'P-ABATE-01', 'Insensibilização',      'Condução e insensibilização na entrada da linha', 'CC-ABATE',    60,  'Supervisão Abate',     1),
  ('Abate',     'P-ABATE-02', 'Sangria',               'Sangria e escorrimento',                          'CC-ABATE',    60,  'Supervisão Abate',     2),
  ('Abate',     'P-ABATE-03', 'Esfola',                'Retirada do couro',                               'CC-ABATE',    55,  'Supervisão Abate',     3),
  ('Desossa',   'P-DES-01',   'Desossa dianteiro',     'Desossa do quarto dianteiro',                     'CC-DESOSSA',  40,  'Supervisão Desossa',   1),
  ('Desossa',   'P-DES-02',   'Desossa traseiro',      'Desossa do quarto traseiro',                      'CC-DESOSSA',  38,  'Supervisão Desossa',   2),
  ('Desossa',   'P-DES-03',   'Toalete',               'Limpeza e toalete dos cortes',                    'CC-DESOSSA',  50,  'Supervisão Desossa',   3),
  ('Quarteio',  'P-QUART-01', 'Serra de carcaça',      'Corte da carcaça com serra',                      'CC-QUARTEIO', 45,  'Supervisão Quarteio',  1),
  ('Quarteio',  'P-QUART-02', 'Quarteamento',          'Divisão em quartos e meias-carcaças',             'CC-QUARTEIO', 48,  'Supervisão Quarteio',  2),
  ('Quarteio',  'P-QUART-03', 'Pesagem/classificação', 'Pesagem e classificação das peças',               'CC-QUARTEIO', 70,  'Supervisão Quarteio',  3),
  ('Expedição', 'P-EXP-01',   'Embalagem',             'Embalagem a vácuo e etiquetagem',                 'CC-EXPED',    80,  'Supervisão Expedição', 1),
  ('Expedição', 'P-EXP-02',   'Paletização',           'Montagem de paletes para carga',                  'CC-EXPED',    75,  'Supervisão Expedição', 2),
  ('Expedição', 'P-EXP-03',   'Carregamento',          'Carregamento de caminhão frigorífico',            'CC-EXPED',    65,  'Supervisão Expedição', 3)
) AS v(setor_nome, numero, atividade, descricao_funcao, centro_custo, capacidade_hora, supervisor_nome, ordem_linha)
JOIN public.prod_setor s
  ON s.company_id = 'b0700000-0000-4000-a000-000000000005' AND s.nome = v.setor_nome
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000005' AND c.is_demo = true)
  AND NOT EXISTS (
    SELECT 1 FROM public.prod_posto p
    WHERE p.company_id = 'b0700000-0000-4000-a000-000000000005' AND p.numero = v.numero
  );

-- ============================================================ 4) LINHAS DE NEGÓCIO (linhas_negocio)
INSERT INTO public.linhas_negocio (empresa_id, nome, descricao, ordem, ativo)
SELECT 'b0700000-0000-4000-a000-000000000005'::uuid, v.nome, v.descricao, v.ordem, true
FROM (VALUES
  ('Carne in natura', 'Cortes resfriados e congelados', 1),
  ('Subprodutos',     'Miúdos, sebo, ossos e couro',    2),
  ('Industrializados','Processados (linguiça, hambúrguer, almôndega)', 3)
) AS v(nome, descricao, ordem)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000005' AND c.is_demo = true)
  AND NOT EXISTS (
    SELECT 1 FROM public.linhas_negocio l
    WHERE l.empresa_id = 'b0700000-0000-4000-a000-000000000005' AND l.nome = v.nome
  );
