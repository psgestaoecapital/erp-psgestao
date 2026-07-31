-- RD-41 · Investimento em Despesas a Pagar + tratamento correto no DRE.
-- Achado da Jordana: categorias de investimento não apareciam em Nova Despesa
-- (o dropdown só deixava passar despesa/custo). Decisão CEO (RD-25): investimento
-- entra ABAIXO da linha operacional (não-operacional), sem afetar EBITDA/lucro op.
--
-- Parte A · dropdown: fn_plano_contas_buscar/arvore passam a incluir os tipos de
--   SAÍDA de caixa (despesa, custo, investimento, financeiro), excluindo receita.
-- Parte B.1a · chart canônico: folha aditiva 9.3 "Investimentos (CAPEX)" em NAO_OPER.
-- Parte B.2 · de-para (por empresa, idempotente): investimento → 9.3, reapontando
--   as que estavam sem de-para (35) e em RESULT_FIN (4). NÃO mexe nas que já estão
--   em NAO_OPER (9) nem nas NEUTRO (8) — RD-53 (não regride DRE histórico).
-- B.3 (rebuild do psgc_dre dos meses afetados via fn_psgc_recalcular_dre_mes) roda
--   como reprocesso de dados após esta migration (é dado, não schema).

-- ── Parte A ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_plano_contas_buscar(p_company_id uuid, p_termo text DEFAULT NULL::text, p_aplicacao text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descricao text, grupo text, tipo text, nivel integer, pai_codigo text, is_totalizador boolean, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  WITH filtrada AS (
    SELECT
      pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo, pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
      AND (
        p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        -- pagar = todas as saídas de caixa (RD-41): despesa/custo/investimento/financeiro
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo','investimento','financeiro'))
      )
      AND (
        p_termo IS NULL OR btrim(p_termo) = ''
        OR pc.codigo ILIKE '%' || btrim(p_termo) || '%'
        OR pc.descricao ILIKE '%' || btrim(p_termo) || '%'
      )
  ),
  dedup AS (
    SELECT DISTINCT ON (filtrada.codigo)
      filtrada.codigo, filtrada.descricao, filtrada.grupo, filtrada.tipo,
      filtrada.nivel, filtrada.pai_codigo, filtrada.is_totalizador, filtrada.origem
    FROM filtrada
    ORDER BY filtrada.codigo, filtrada.prio
  )
  SELECT dedup.codigo, dedup.descricao, dedup.grupo, dedup.tipo, dedup.nivel,
         dedup.pai_codigo, dedup.is_totalizador, dedup.origem
  FROM dedup
  ORDER BY dedup.is_totalizador ASC, dedup.codigo ASC
  LIMIT 50;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_plano_contas_arvore(p_company_id uuid, p_aplicacao text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descricao text, grupo text, tipo text, nivel integer, pai_codigo text, is_totalizador boolean, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  WITH todos AS (
    SELECT
      pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo, pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
      AND (
        p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo','investimento','financeiro'))
      )
  )
  SELECT DISTINCT ON (todos.codigo)
    todos.codigo, todos.descricao, todos.grupo, todos.tipo, todos.nivel,
    todos.pai_codigo, todos.is_totalizador, todos.origem
  FROM todos
  ORDER BY todos.codigo, todos.prio;
END $function$;

-- ── Parte B.1a · folha aditiva no chart canônico (NAO_OPER) ──────────────────
INSERT INTO psgc_contas
  (codigo, nome, nivel, pai_codigo, natureza, dre_grupo, dre_ordem, tipo,
   afeta_margem_bruta, afeta_margem_contribuicao, afeta_ebitda, ativo, imutavel)
-- tipo aqui é o classificador de custo do chart (direto|indireto|estrutural), NÃO o
-- tipo do plano de contas. Os irmãos 9/9.1/9.2 são 'estrutural' → 9.3 acompanha.
VALUES
  ('9.3', 'Investimentos (CAPEX)', 2, '9', 'nao_operacional', 'NAO_OPER', 1030,
   'estrutural', false, false, false, true, false)
ON CONFLICT (codigo) DO NOTHING;

-- ── Parte B.2 · de-para de investimento → 9.3 (idempotente, por empresa) ─────
-- 1) Reaponta de-paras ATIVOS de investimento que hoje caem em RESULT_FIN.
-- (a tabela-alvo dp não pode ser referenciada no JOIN do FROM — o join de
-- alvo_atual vai pra WHERE, que pode referenciar dp.)
UPDATE psgc_depara dp
SET psgc_codigo = '9.3',
    metodo = 'manual',
    observacao = COALESCE(observacao,'') || ' | CEO 31/07 opcao A (regra_tipo_investimento): investimento -> NAO_OPER',
    updated_at = now()
FROM erp_plano_contas pc, psgc_contas alvo_atual
WHERE pc.tipo = 'investimento'
  AND dp.company_id = pc.company_id
  AND dp.origem_codigo = pc.codigo
  AND dp.ativo = true
  AND alvo_atual.codigo = dp.psgc_codigo
  AND alvo_atual.dre_grupo = 'RESULT_FIN';

-- 2) Cria de-para para contas de investimento SEM mapeamento ativo
INSERT INTO psgc_depara
  (company_id, origem_codigo, origem_descricao, origem_sistema, psgc_codigo,
   metodo, confianca, revisado, observacao, ativo)
SELECT pc.company_id, pc.codigo, pc.descricao, 'erp_plano_contas', '9.3',
       'manual', 100, false,
       'CEO 31/07 opcao A (regra_tipo_investimento): investimento -> NAO_OPER', true
FROM erp_plano_contas pc
WHERE pc.tipo = 'investimento'
  AND pc.company_id IS NOT NULL   -- de-para é por empresa; contas globais (template) não entram
  AND NOT EXISTS (
    SELECT 1 FROM psgc_depara d
    WHERE d.company_id = pc.company_id
      AND d.origem_codigo = pc.codigo
      AND d.ativo = true
  );
