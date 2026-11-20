-- DEMO GE · /dashboard/cadastros/divisoes (business_lines) × /dashboard/linhas-negocio (linhas_negocio)
-- Tarefa PDCA (auditor_pdca_2, 19/11): as DUAS tabelas-base de "linha de negócio" divergiam
--   na DEMO GE. Prova RD-38 no dado (19/11):
--     DEMO Comércio 004: business_lines = {Geral, Comercial} ; linhas_negocio = {Atacado,
--                        Serviços, Varejo}  -> a tela Divisões (cadastro canônico) NÃO mostrava
--                        as linhas reais do negócio.
--     DEMO 005        : business_lines = {} (vazio) ; linhas_negocio = {Carne in natura,
--                        Industrializados, Subprodutos} -> cadastro canônico vazio.
--   Direção canônica (RD-52, 20260722230000): business_lines é a fonte da verdade do cadastro
--   (tela Divisões + FKs reais: cost_allocations, erp_lancamentos, daily_transactions, targets,
--   rateio_distribuicao...). linhas_negocio não tem NENHUMA FK apontando para ela.
--
-- O QUE ESTA MIGRATION FAZ (FASE 1 — ADITIVA, SÓ DEMO, RD-69/LGPD):
--   Semeia em business_lines, de forma ADITIVA e idempotente, as linhas ATIVAS de linhas_negocio
--   que ainda não existem em business_lines (por empresa + nome normalizado), SOMENTE para as
--   empresas DEMO 004 e 005. Assim a tela Divisões passa a refletir o conjunto real de linhas da
--   DEMO GE (business_lines ⊇ linhas_negocio). ln_number recebe o próximo slot livre (1..12).
--
-- SEGURANÇA / ESCOPO:
--   * SÓ empresas DEMO (b0700000-...-0004 e -0005). Empresas REAIS não são tocadas: as 2 reais
--     com linhas_negocio já têm todos os nomes em business_lines; o 3º company_id em
--     linhas_negocio é ÓRFÃO (não existe em companies — a própria FK business_lines_company_id_fkey
--     bloqueia, e fica documentado como achado de higiene de dado, NÃO migrado).
--   * 100% ADITIVA: só INSERT. Nenhuma linha existente é alterada, inativada ou apagada.
--     Nenhum dado financeiro é tocado. linhas_negocio não é tocada. RLS inalterada.
--   * Idempotente: NOT EXISTS por empresa+nome; rodar de novo insere 0.
--
-- FORA DESTA MIGRATION (FASE 2 — SENSÍVEL, escalado ao Eng. Chefe, ver corpo da PR):
--   unificar de fato as duas famílias (repoint de /api/linhas-negocio, fn_ge_dre_divisional,
--   fn_dre_vincular_categoria_linha para business_lines) exige backfill do de-para
--   linhas_negocio.id -> business_lines.id em m2_dre_divisional.ln_id, linhas_negocio_budget.linha_id
--   e erp_dre_divisoes.divisao (uuid-as-text) — mutação de dado financeiro de empresa real + há
--   mismatch pré-existente (budget gravado em Divisões por business_lines.id não casa com o DRE
--   Divisional, que casa por linhas_negocio.id). Isso é decisão/autorização do Eng. Chefe.

DO $$
DECLARE
  v_demo uuid[] := ARRAY[
    'b0700000-0000-4000-a000-000000000004',
    'b0700000-0000-4000-a000-000000000005'
  ]::uuid[];
  v_ins int := 0;
  v_falt_antes int;
  v_falt_depois int;
BEGIN
  -- Guarda: só segue se as DEMO existem em companies (ambiente de teste pode não ter)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = ANY(v_demo)) THEN
    RAISE NOTICE 'DEMO GE 004/005 ausentes em companies; nada a fazer.';
    RETURN;
  END IF;

  -- Contagem RD-38 (antes): nomes ativos de linhas_negocio dessas DEMO ainda sem par em business_lines
  SELECT count(*) INTO v_falt_antes FROM (
    SELECT DISTINCT ln.empresa_id, lower(btrim(ln.nome)) nm
    FROM linhas_negocio ln
    WHERE ln.empresa_id = ANY(v_demo) AND coalesce(ln.ativo,true)
      AND NOT EXISTS (SELECT 1 FROM business_lines bl
                      WHERE bl.company_id=ln.empresa_id AND lower(btrim(bl.name))=lower(btrim(ln.nome)))
  ) q;

  -- INSERT aditivo com atribuição de slot livre (1..12) por empresa
  WITH src AS (
    SELECT DISTINCT ON (ln.empresa_id, lower(btrim(ln.nome)))
      ln.empresa_id AS company_id, btrim(ln.nome) AS nome, ln.descricao, ln.cor, ln.ativo, ln.ordem, ln.created_at
    FROM linhas_negocio ln
    WHERE ln.empresa_id = ANY(v_demo)
      AND coalesce(ln.ativo,true)
      AND EXISTS (SELECT 1 FROM companies co WHERE co.id=ln.empresa_id)
      AND NOT EXISTS (SELECT 1 FROM business_lines bl
                      WHERE bl.company_id=ln.empresa_id AND lower(btrim(bl.name))=lower(btrim(ln.nome)))
    ORDER BY ln.empresa_id, lower(btrim(ln.nome)), ln.ordem NULLS LAST, ln.created_at
  ),
  free AS (
    SELECT c.company_id, g AS ln_number
    FROM (SELECT DISTINCT company_id FROM src) c
    CROSS JOIN generate_series(1,12) g
    WHERE NOT EXISTS (SELECT 1 FROM business_lines bl WHERE bl.company_id=c.company_id AND bl.ln_number=g)
  ),
  free_ranked AS (
    SELECT company_id, ln_number, row_number() OVER (PARTITION BY company_id ORDER BY ln_number) rn FROM free
  ),
  src_ranked AS (
    SELECT *, row_number() OVER (PARTITION BY company_id ORDER BY ordem NULLS LAST, nome) rn FROM src
  ),
  ins AS (
    INSERT INTO business_lines (company_id, name, type, is_active, cor, descricao, ln_number)
    SELECT s.company_id, s.nome, 'servico', coalesce(s.ativo,true), s.cor, s.descricao, f.ln_number
    FROM src_ranked s JOIN free_ranked f ON f.company_id=s.company_id AND f.rn=s.rn
    RETURNING 1
  )
  SELECT count(*) INTO v_ins FROM ins;

  -- Contagem RD-38 (depois): deve ser 0 faltantes
  SELECT count(*) INTO v_falt_depois FROM (
    SELECT DISTINCT ln.empresa_id, lower(btrim(ln.nome)) nm
    FROM linhas_negocio ln
    WHERE ln.empresa_id = ANY(v_demo) AND coalesce(ln.ativo,true)
      AND NOT EXISTS (SELECT 1 FROM business_lines bl
                      WHERE bl.company_id=ln.empresa_id AND lower(btrim(bl.name))=lower(btrim(ln.nome)))
  ) q;

  RAISE NOTICE 'DEMO GE divisoes superset: faltantes antes=%, inseridos=%, faltantes depois=%',
    v_falt_antes, v_ins, v_falt_depois;

  IF v_falt_depois <> 0 THEN
    RAISE EXCEPTION 'RD-38: ainda restam % linhas de linhas_negocio sem par em business_lines nas DEMO', v_falt_depois;
  END IF;
END $$;
