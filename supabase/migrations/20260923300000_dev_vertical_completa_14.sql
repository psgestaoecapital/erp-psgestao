-- dev_vertical · completar o catálogo com as 14 verticais que só existiam fixas no código
-- (NOME_VERTICAL em src/app/dashboard/dev/page.tsx) + corretora_seguros, casando por slug.
-- Fecha a divergência de #1720: a aba "Leitura e diagnóstico" mostrava 14 (lista fixa, sem corretora)
-- e a aba "Desenvolvimento" 7 (dev_vertical). Com o seed completo + a aba de diagnóstico lendo
-- dev_vertical (mudança de tela no mesmo PR), as duas abas passam a mostrar exatamente a mesma lista.
--
-- Casa por slug (ON CONFLICT (slug)). O DO UPDATE só canoniza nome/ordem das linhas cujo nome ainda é o
-- auto-gerado (initcap do slug, como o #1720 semeou) — assim renomeações feitas pelo admin em "Gerenciar
-- verticais" são preservadas. Não duplica as 7 já semeadas.

INSERT INTO public.dev_vertical (slug, nome, ordem) VALUES
  ('agro',               'Agro / Pecuária',      10),
  ('bpo',                'BPO',                  20),
  ('compliance',         'Compliance',           30),
  ('custeio_a',          'Custeio A',            40),
  ('custeio_b',          'Custeio B',            50),
  ('gestao_empresarial', 'Gestão Empresarial',   60),
  ('hub',                'Hub (Construção)',     70),
  ('industrial',         'Industrial',           80),
  ('medica',             'Médica',               90),
  ('odonto',             'Odonto',              100),
  ('oficina',            'Oficina',             110),
  ('pm',                 'P&M (Agência)',       120),
  ('revenda_veiculos',   'Revenda de Veículos', 130),
  ('wealth',             'Wealth',              140),
  ('corretora_seguros',  'Corretora de Seguros',150)
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome, ordem = EXCLUDED.ordem
  WHERE dev_vertical.nome = initcap(replace(dev_vertical.slug, '_', ' '));
