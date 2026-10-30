-- Teste em Postgres LOCAL (esquema mínimo + a migration A2). Uso:
--   psql -v ON_ERROR_STOP=1 -f scripts/testes-sql/prod_posto_custo_rateio.sql <banco_vazio>
-- Prova: (1) custo/hora = total ÷ horas; (2) posto com 1 e 2 pessoas NÃO devolve mão de obra (protegida) e o custo/hora
-- não a contém; 3 pessoas devolve só o agregado; (3) nova vigência encerra a anterior sem perder histórico;
-- (4) rateio por peso fecha 100%; (5) outra empresa → sem_acesso; planta de outra empresa recusada. Idempotente (2 rodadas).
\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('t.uid', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.get_user_company_ids() RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('t.emp', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE IF NOT EXISTS industrial_plants (id uuid PRIMARY KEY, company_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS prod_setor (id uuid PRIMARY KEY, company_id uuid, nome text);
CREATE TABLE IF NOT EXISTS prod_posto (id uuid PRIMARY KEY, company_id uuid, plant_id uuid, numero text, atividade text, setor_id uuid,
  capacidade_hora numeric, capacidade_origem text, ativo boolean DEFAULT true, updated_at timestamptz);
CREATE TABLE IF NOT EXISTS prod_posto_pessoa (id uuid DEFAULT gen_random_uuid(), posto_id uuid, funcionario_id uuid, vigencia_inicio date DEFAULT current_date, vigencia_fim date);
CREATE TABLE IF NOT EXISTS prod_posto_turno (id uuid DEFAULT gen_random_uuid(), posto_id uuid, pessoas int, vigencia_inicio date DEFAULT current_date, vigencia_fim date);
CREATE TABLE IF NOT EXISTS prod_salario_base (funcionario_id uuid, valor numeric, vigencia_inicio date DEFAULT '2020-01-01', vigencia_fim date);
CREATE TABLE IF NOT EXISTS prod_fluxo (id uuid PRIMARY KEY, company_id uuid, nome text, ordem int, deleted_at timestamptz);
CREATE TABLE IF NOT EXISTS prod_fluxo_etapa (id uuid PRIMARY KEY, fluxo_id uuid, posto_id uuid, ordem int, nome text, tipo text, unidade text, tempo_ciclo_seg numeric, pessoas int, deleted_at timestamptz);
CREATE TABLE IF NOT EXISTS prod_produto (id uuid PRIMARY KEY, codigo text, nome text);
CREATE TABLE IF NOT EXISTS prod_estrutura (id uuid DEFAULT gen_random_uuid(), company_id uuid, fluxo_id uuid, produto_id uuid, tipo_saida text, rendimento_padrao_pct numeric, ativo boolean DEFAULT true);
\i supabase/migrations/20261031000058_prod_posto_custo_rateio_banco.sql
\i supabase/migrations/20261031000058_prod_posto_custo_rateio_banco.sql

BEGIN;
SET LOCAL t.emp = '00000000-0000-0000-0000-00000000000a';
SET LOCAL t.uid = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO industrial_plants VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a'),
                                     ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-00000000000b');
INSERT INTO prod_posto (id, company_id, plant_id, numero, atividade) SELECT ('00000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid,
  '00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b1', i::text, 'p'||i FROM generate_series(1,3) i;
-- posto 1: 1 pessoa (salário 20000); posto 2: 2 pessoas; posto 3: 3 pessoas (3 × 10000)
INSERT INTO prod_posto_pessoa (posto_id, funcionario_id) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000002a1'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000002a2'),('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000002a3'),
 ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000002a4'),('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000002a5'),('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-0000000002a6');
INSERT INTO prod_salario_base (funcionario_id, valor) SELECT f, 10000 FROM unnest(ARRAY['00000000-0000-0000-0000-0000000002a2','00000000-0000-0000-0000-0000000002a3','00000000-0000-0000-0000-0000000002a4','00000000-0000-0000-0000-0000000002a5','00000000-0000-0000-0000-0000000002a6']::uuid[]) f;
INSERT INTO prod_salario_base VALUES ('00000000-0000-0000-0000-0000000002a1', 20000);
DO $$ DECLARE r jsonb; i int; id uuid; BEGIN
  FOR i IN 1..3 LOOP
    id := ('00000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid;
    r := fn_prod_posto_custo_salvar(jsonb_build_object('posto_id', id, 'encargos_pct', 0, 'energia_mes', 800, 'agua_mes', 200, 'outros_mes', 100, 'horas_operacao_mes', 200));
    ASSERT (r->>'ok')::boolean, 'salvar custo '||i;
  END LOOP;
  -- 1 e 2 pessoas: protegida, sem mão de obra, custo/hora SEM mão de obra = (800+200+100)/200 = 5.5
  FOR i IN 1..2 LOOP
    r := fn_prod_posto_custo_hora_interno(('00000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid);
    ASSERT (r->>'mao_obra_protegida')::boolean, 'protegida '||i;
    ASSERT r->'mao_obra_mes' = 'null'::jsonb AND r->'mao_obra_origem' = 'null'::jsonb, 'sem mão de obra '||i;
    ASSERT (r->>'custo_hora')::numeric = 5.5, 'custo/hora sem MO '||i||' = '||(r->>'custo_hora');
  END LOOP;
  -- 3 pessoas: agregado 30000 + 1100 = 31100 ÷ 200 = 155.5
  r := fn_prod_posto_custo_hora_interno('00000000-0000-0000-0000-000000000103');
  ASSERT NOT (r->>'mao_obra_protegida')::boolean AND (r->>'mao_obra_mes')::numeric = 30000 AND (r->>'custo_hora')::numeric = 155.5, 'posto de 3 = '||r::text;
  -- valor manual também é protegido em posto de 1 pessoa
  PERFORM fn_prod_posto_custo_salvar(jsonb_build_object('posto_id','00000000-0000-0000-0000-000000000101','mao_obra_mes',9999,'horas_operacao_mes',100,'vigencia_inicio', (current_date+1)::text));
  r := fn_prod_posto_custo_hora_interno('00000000-0000-0000-0000-000000000101', current_date+1);
  ASSERT r->'mao_obra_mes' = 'null'::jsonb AND (r->>'custo_hora')::numeric = 0, 'manual protegido '||r::text;
  -- nova vigência encerrou a anterior sem perder histórico
  ASSERT (SELECT count(*) FROM prod_posto_custo WHERE posto_id='00000000-0000-0000-0000-000000000101' AND deleted_at IS NULL) = 2, 'histórico';
  ASSERT (SELECT count(*) FROM prod_posto_custo WHERE posto_id='00000000-0000-0000-0000-000000000101' AND vigencia_fim = current_date) = 1, 'vigência anterior encerrada';
  -- vivo_listar: nenhum campo de salário individual no JSON (3 pessoas: 10000 não aparece; só o total)
  r := fn_prod_posto_vivo_listar('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b1');
  ASSERT (r->>'ok')::boolean, 'vivo ok';
  ASSERT r::text NOT LIKE '%20000%', 'salário individual de posto de 1 pessoa não aparece';
  -- outra empresa / planta de outra empresa
  ASSERT fn_prod_posto_vivo_listar('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b2')->>'erro' = 'sem_acesso', 'outra empresa';
  ASSERT fn_prod_posto_vivo_listar('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b2')->>'erro' = 'planta_de_outra_empresa', 'planta alheia (listar)';
  ASSERT fn_prod_rateio_criterio_salvar('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b2','peso')->>'erro' = 'planta_de_outra_empresa', 'planta alheia (critério)';
  ASSERT (fn_prod_rateio_criterio_salvar('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b1','valor')->>'ok')::boolean, 'critério ok';
END $$;
-- rateio por peso fecha 100%
SET LOCAL t.emp = '00000000-0000-0000-0000-00000000000a';
INSERT INTO prod_fluxo VALUES ('00000000-0000-0000-0000-0000000003f1','00000000-0000-0000-0000-00000000000a','raia',1,NULL);
INSERT INTO prod_produto VALUES ('00000000-0000-0000-0000-0000000004a1','1','a'),('00000000-0000-0000-0000-0000000004a2','2','b'),('00000000-0000-0000-0000-0000000004a3','3','c');
INSERT INTO prod_estrutura (company_id,fluxo_id,produto_id,tipo_saida,rendimento_padrao_pct) VALUES
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000003f1','00000000-0000-0000-0000-0000000004a1','principal',50),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000003f1','00000000-0000-0000-0000-0000000004a2','coproduto',30),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000003f1','00000000-0000-0000-0000-0000000004a3','subproduto',20);
DELETE FROM prod_rateio_config;
DO $$ DECLARE r jsonb; BEGIN
  r := fn_prod_rateio_raia('00000000-0000-0000-0000-0000000003f1');
  ASSERT r->>'criterio' = 'peso', 'critério padrão';
  ASSERT (SELECT round(sum((x->>'parte_custo_pct')::numeric)) FROM jsonb_array_elements(r->'saidas') x) = 100, 'rateio fecha 100%';
  PERFORM set_config('t.emp','00000000-0000-0000-0000-00000000000b',true);
  ASSERT fn_prod_rateio_raia('00000000-0000-0000-0000-0000000003f1')->>'erro' = 'sem_acesso', 'rateio outra empresa';
END $$;
ROLLBACK;
\echo 'OK prod_posto_custo_rateio'
