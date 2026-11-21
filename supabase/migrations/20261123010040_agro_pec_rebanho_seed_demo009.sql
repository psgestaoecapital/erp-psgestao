-- Agro · BI de Pecuária (/dashboard/agro/bi e /dashboard/agro/rebanho) — SEED DEMO (aud8 req871, auditor_pdca_2 21/11)
-- A tela de BI está muito bem feita (empty-states exemplares, "?" em filtros/indicadores, linguagem clara),
-- mas a empresa DEMO "Fazenda Modelo - DEMO" (b0700000-0000-4000-a000-000000000009) tinha 0 dados de rebanho
-- (prov. no dado: erp_pec_propriedade/erp_pec_lote/erp_pec_animal/erp_pec_movimentacao = 0 para ...009):
--   "Cabeças no rebanho" 0, "Lotes/áreas/prop" 0·0·0 e o gráfico "Evolução do rebanho" vazio — tela morta para
--   um BI de leitura (critério b: dado carrega; RD-98 p1: dado real, não mockup), impedindo o 95.
--
-- AÇÃO: só dado de DEMO (RD-69/LGPD — fictício), ADITIVO e IDEMPOTENTE. Nenhuma mudança de tela/função/RLS.
-- fn_pec_painel_rebanho lê erp_pec_animal (status='ativo'), erp_pec_lote (status='ativo'), erp_pec_area (ativo),
-- erp_pec_propriedade (ativo); o gráfico mês a mês (fatia 2) lê erp_pec_movimentacao (entradas/saídas por mês).
-- Semeia 1 propriedade, 6 áreas, 4 lotes ativos, 54 cabeças ativas (+6 vendidas p/ histórico) distribuídas por
-- categoria, e as movimentações de entrada (nascimento/compra) e venda, com datas relativas a CURRENT_DATE
-- (evergreen) para a jornada ficar auditável e os KPIs/gráficos populares com dado real.
--
-- IDEMPOTÊNCIA: ids fixos/determinísticos + ON CONFLICT (id) DO NOTHING. SEGURANÇA: só INSERT na empresa DEMO
-- ...009; não toca dado de cliente real; não altera RLS/função; sem UPDATE/DELETE. Valores conforme os CHECK
-- das tabelas (categoria/origem/sexo/status/tipo/modo/fase/tipo_operacao).

-- 1) Propriedade (ciclo completo)
INSERT INTO public.erp_pec_propriedade
  (id, company_id, nome, tipo_operacao, cidade, uf, area_total_ha, ativo, created_at, updated_at)
VALUES
  ('a9900009-0000-4a00-b000-000000000001','b0700000-0000-4000-a000-000000000009',
   'Fazenda Modelo','ciclo_completo','Campo Grande','MS',1200,true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 2) Áreas (piquetes + curral + sede + mangueira)
INSERT INTO public.erp_pec_area
  (id, company_id, propriedade_id, nome, tipo, area_ha, capacidade_ua, ativo, created_at, updated_at)
VALUES
  ('a9900009-0a00-4a00-b000-000000000001','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Sede',        'sede',        NULL, NULL, true, now(), now()),
  ('a9900009-0a00-4a00-b000-000000000002','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Curral de Manejo','curral_baia',  2,   50, true, now(), now()),
  ('a9900009-0a00-4a00-b000-000000000003','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Piquete A',    'piquete',    180,  120, true, now(), now()),
  ('a9900009-0a00-4a00-b000-000000000004','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Piquete B',    'piquete',    160,  100, true, now(), now()),
  ('a9900009-0a00-4a00-b000-000000000005','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Piquete C',    'piquete',    150,   90, true, now(), now()),
  ('a9900009-0a00-4a00-b000-000000000006','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','Mangueira',    'mangueira',    1,  NULL, true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 3) Lotes ativos (cria / recria / engorda / terminação)
INSERT INTO public.erp_pec_lote
  (id, company_id, propriedade_id, codigo, modo, fase, area_atual_id, data_abertura, status, ativo, created_at, updated_at)
VALUES
  ('a9900009-0b00-4a00-b000-000000000001','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','LOTE-CRIA-01',   'pasto',           'cria',       'a9900009-0a00-4a00-b000-000000000003', CURRENT_DATE - 240,'ativo',true, now(), now()),
  ('a9900009-0b00-4a00-b000-000000000002','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','LOTE-RECRIA-01', 'pasto',           'recria',     'a9900009-0a00-4a00-b000-000000000004', CURRENT_DATE - 200,'ativo',true, now(), now()),
  ('a9900009-0b00-4a00-b000-000000000003','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','LOTE-ENGORDA-01','semiconfinamento','engorda',    'a9900009-0a00-4a00-b000-000000000005', CURRENT_DATE - 120,'ativo',true, now(), now()),
  ('a9900009-0b00-4a00-b000-000000000004','b0700000-0000-4000-a000-000000000009','a9900009-0000-4a00-b000-000000000001','LOTE-TERMIN-01', 'confinamento',    'terminacao', 'a9900009-0a00-4a00-b000-000000000002', CURRENT_DATE -  80,'ativo',true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 4) Cabeças: 60 animais (n=1..54 ativos; n=55..60 vendidos p/ histórico de saída). Categoria/sexo/origem/lote
--    derivados de n; datas relativas a CURRENT_DATE. Mapa lote→área: cria→Piquete A, recria→Piquete B,
--    engorda→Piquete C, terminação→Curral.
WITH g AS (
  SELECT n,
    CASE WHEN n<=18 THEN 'matriz' WHEN n<=20 THEN 'touro'   WHEN n<=27 THEN 'bezerro'
         WHEN n<=34 THEN 'bezerra' WHEN n<=40 THEN 'novilha' WHEN n<=46 THEN 'garrote'
         WHEN n<=50 THEN 'boi_magro' ELSE 'boi_gordo' END AS categoria
  FROM generate_series(1,60) AS n
),
d AS (
  SELECT n, categoria,
    (n<=54) AS ativo_flag,
    CASE WHEN categoria IN ('matriz','bezerra','novilha') THEN 'F' ELSE 'M' END AS sexo,
    CASE WHEN categoria IN ('touro','boi_magro') OR (categoria='matriz' AND n<=9) THEN 'comprado' ELSE 'nascido' END AS origem,
    CASE WHEN categoria IN ('matriz','touro','bezerro','bezerra') THEN 'cria'
         WHEN categoria IN ('novilha','garrote') THEN 'recria'
         WHEN categoria='boi_magro' THEN 'engorda' ELSE 'terminacao' END AS lote_key,
    (CASE categoria WHEN 'matriz' THEN 430 WHEN 'touro' THEN 820 WHEN 'bezerro' THEN 120 WHEN 'bezerra' THEN 110
          WHEN 'novilha' THEN 290 WHEN 'garrote' THEN 310 WHEN 'boi_magro' THEN 380 ELSE 510 END)::numeric AS peso,
    CASE WHEN n>54 THEN (CURRENT_DATE - interval '5 months')::date
         ELSE (date_trunc('month', CURRENT_DATE) - (((n % 9))||' months')::interval + (((n*3) % 25)||' days')::interval)::date
    END AS d_entrada,
    CASE WHEN n>54 THEN (CURRENT_DATE - (((61-n))||' days')::interval)::date ELSE NULL::date END AS d_saida
  FROM g
),
m AS (
  SELECT d.*,
    CASE lote_key WHEN 'cria' THEN 'a9900009-0b00-4a00-b000-000000000001'
                  WHEN 'recria' THEN 'a9900009-0b00-4a00-b000-000000000002'
                  WHEN 'engorda' THEN 'a9900009-0b00-4a00-b000-000000000003'
                  ELSE 'a9900009-0b00-4a00-b000-000000000004' END::uuid AS lote_id,
    CASE lote_key WHEN 'cria' THEN 'a9900009-0a00-4a00-b000-000000000003'
                  WHEN 'recria' THEN 'a9900009-0a00-4a00-b000-000000000004'
                  WHEN 'engorda' THEN 'a9900009-0a00-4a00-b000-000000000005'
                  ELSE 'a9900009-0a00-4a00-b000-000000000002' END::uuid AS area_id
  FROM d
)
INSERT INTO public.erp_pec_animal
  (id, company_id, propriedade_id, lote_id, area_atual_id, identificacao, sexo, categoria, raca,
   data_nascimento, origem, data_entrada, peso_entrada_kg, contraparte_nome, status, data_saida, motivo_saida, ativo, created_at, updated_at)
SELECT
  ('a9900009-0c00-4a00-b000-'||lpad(to_hex(n),12,'0'))::uuid,
  'b0700000-0000-4000-a000-000000000009',
  'a9900009-0000-4a00-b000-000000000001',
  lote_id, area_id,
  'BR'||lpad(n::text,4,'0'),
  sexo, categoria, 'Nelore',
  CASE WHEN origem='nascido' THEN d_entrada ELSE NULL END,
  origem, d_entrada, peso,
  CASE WHEN origem='comprado' THEN 'Leilão Agropecuário Demo' ELSE NULL END,
  CASE WHEN ativo_flag THEN 'ativo' ELSE 'vendido' END,
  d_saida,
  CASE WHEN NOT ativo_flag THEN 'venda' ELSE NULL END,
  ativo_flag,
  now(), now()
FROM m
ON CONFLICT (id) DO NOTHING;

-- 5) Movimentações de ENTRADA (nascimento/compra) — uma por animal, na data de entrada
WITH g AS (
  SELECT n,
    CASE WHEN n<=18 THEN 'matriz' WHEN n<=20 THEN 'touro'   WHEN n<=27 THEN 'bezerro'
         WHEN n<=34 THEN 'bezerra' WHEN n<=40 THEN 'novilha' WHEN n<=46 THEN 'garrote'
         WHEN n<=50 THEN 'boi_magro' ELSE 'boi_gordo' END AS categoria
  FROM generate_series(1,60) AS n
),
d AS (
  SELECT n, categoria,
    CASE WHEN categoria IN ('touro','boi_magro') OR (categoria='matriz' AND n<=9) THEN 'comprado' ELSE 'nascido' END AS origem,
    CASE WHEN categoria IN ('matriz','touro','bezerro','bezerra') THEN 'cria'
         WHEN categoria IN ('novilha','garrote') THEN 'recria'
         WHEN categoria='boi_magro' THEN 'engorda' ELSE 'terminacao' END AS lote_key,
    (CASE categoria WHEN 'matriz' THEN 430 WHEN 'touro' THEN 820 WHEN 'bezerro' THEN 120 WHEN 'bezerra' THEN 110
          WHEN 'novilha' THEN 290 WHEN 'garrote' THEN 310 WHEN 'boi_magro' THEN 380 ELSE 510 END)::numeric AS peso,
    CASE WHEN n>54 THEN (CURRENT_DATE - interval '5 months')::date
         ELSE (date_trunc('month', CURRENT_DATE) - (((n % 9))||' months')::interval + (((n*3) % 25)||' days')::interval)::date
    END AS d_entrada
  FROM g
),
m AS (
  SELECT d.*,
    CASE lote_key WHEN 'cria' THEN 'a9900009-0b00-4a00-b000-000000000001'
                  WHEN 'recria' THEN 'a9900009-0b00-4a00-b000-000000000002'
                  WHEN 'engorda' THEN 'a9900009-0b00-4a00-b000-000000000003'
                  ELSE 'a9900009-0b00-4a00-b000-000000000004' END::uuid AS lote_id,
    CASE lote_key WHEN 'cria' THEN 'a9900009-0a00-4a00-b000-000000000003'
                  WHEN 'recria' THEN 'a9900009-0a00-4a00-b000-000000000004'
                  WHEN 'engorda' THEN 'a9900009-0a00-4a00-b000-000000000005'
                  ELSE 'a9900009-0a00-4a00-b000-000000000002' END::uuid AS area_id
  FROM d
)
INSERT INTO public.erp_pec_movimentacao
  (id, company_id, propriedade_id, animal_id, lote_id, tipo, data, area_destino_id, quantidade, peso_kg, valor, contraparte_nome, estornada, created_at, updated_at)
SELECT
  ('a9900009-0d00-4a00-b000-'||lpad(to_hex(n),12,'0'))::uuid,
  'b0700000-0000-4000-a000-000000000009',
  'a9900009-0000-4a00-b000-000000000001',
  ('a9900009-0c00-4a00-b000-'||lpad(to_hex(n),12,'0'))::uuid,
  lote_id,
  CASE WHEN origem='nascido' THEN 'nascimento' ELSE 'compra' END,
  d_entrada, area_id, 1, peso,
  CASE WHEN origem='comprado' THEN round(peso*10.5,2) ELSE NULL END,
  CASE WHEN origem='comprado' THEN 'Leilão Agropecuário Demo' ELSE NULL END,
  false, now(), now()
FROM m
ON CONFLICT (id) DO NOTHING;

-- 6) Movimentações de VENDA (n=55..60 vendidos) — saída recente, para o gráfico de evolução mostrar saídas
INSERT INTO public.erp_pec_movimentacao
  (id, company_id, propriedade_id, animal_id, lote_id, tipo, data, quantidade, peso_kg, valor, contraparte_nome, estornada, created_at, updated_at)
SELECT
  ('a9900009-0e00-4a00-b000-'||lpad(to_hex(n),12,'0'))::uuid,
  'b0700000-0000-4000-a000-000000000009',
  'a9900009-0000-4a00-b000-000000000001',
  ('a9900009-0c00-4a00-b000-'||lpad(to_hex(n),12,'0'))::uuid,
  'a9900009-0b00-4a00-b000-000000000004',
  'venda',
  (CURRENT_DATE - (((61-n))||' days')::interval)::date,
  1, 550::numeric, round(550*11.5,2), 'Frigorífico Demo',
  false, now(), now()
FROM generate_series(55,60) AS n
ON CONFLICT (id) DO NOTHING;
