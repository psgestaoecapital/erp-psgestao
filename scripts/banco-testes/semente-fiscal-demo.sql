-- Dados fiscais das DEMOs no BANCO DE TESTES (nunca rodar em produção; os workflows travam o destino antes de chamar).
-- 19/10 (gilberto-desenv): a semente.sql cria as DEMOs só com nome/is_demo/ambiente e o fn_demo_reset/fn_gold_ge_seed_reparar
-- não escrevem uf_fiscal — numa vaga montada do zero a DEMO ficava com uf_fiscal NULL e TODA emissão de NF-e travava antes da
-- regra testada ("UF fiscal do emitente não cadastrada · defina a UF da empresa (companies.uf_fiscal)"): nfe-cfop-venda,
-- nfe-sem-tributacao-suposta e nfe-simples-cst vermelhas em toda PR, nas vagas 0 e 2. Valores ESPELHO da produção (19/10):
-- as 7 DEMOs com uf_fiscal = 'SC'; a Comércio GE (…0004) com inscricao_estadual = '255000000'. Só linhas is_demo.
-- Idempotente (rodar 2x dá o mesmo estado) e sem apagar nada. Chamado pela semente.sql (Montar), pela aceitação de PR
-- (depois do sync com a main e ANTES da foto da vaga) e pela aceitação da main (vaga 1).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';

UPDATE public.companies SET uf_fiscal = 'SC'
WHERE is_demo
  AND id IN ('b0700000-0000-4000-a000-000000000001', 'b0700000-0000-4000-a000-000000000002',
             'b0700000-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000004',
             'b0700000-0000-4000-a000-000000000005', 'b0700000-0000-4000-a000-000000000006',
             'ded00000-0000-4000-a000-000000000001')
  AND uf_fiscal IS DISTINCT FROM 'SC';

UPDATE public.companies SET inscricao_estadual = '255000000'
WHERE is_demo AND id = 'b0700000-0000-4000-a000-000000000004' AND inscricao_estadual IS NULL;

COMMIT;
