-- PR-FIX ao 20260706230000: Postgres reclama "invalid UNION/INTERSECT/EXCEPT
-- ORDER BY clause" na fn_lancamento_historico_global (depende da versao do parser).
-- Como erp_lancamento_log e tabela unica polimorfica, nao precisamos de UNION:
-- 1 SELECT + LEFT JOIN em pagar e receber, COALESCE dos campos, ORDER BY simples.
-- Aplicada via MCP em 2026-07-06.

CREATE OR REPLACE FUNCTION public.fn_lancamento_historico_global(
  p_company_id  uuid,
  p_tipo        text DEFAULT 'todos',
  p_acao        text DEFAULT 'todas',
  p_data_inicio date DEFAULT NULL,
  p_data_fim    date DEFAULT NULL,
  p_limite      integer DEFAULT 500
)
RETURNS TABLE (
  log_id           uuid,
  data_evento      timestamptz,
  user_email       text,
  acao             text,
  tabela_origem    text,
  lancamento_id    uuid,
  descricao        text,
  valor            numeric,
  nome_pessoa      text,
  campos_alterados jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  SELECT
    l.id AS log_id,
    l.created_at AS data_evento,
    l.user_email,
    l.acao,
    l.tabela_origem,
    l.lancamento_id,
    COALESCE(
      p.descricao,
      r.descricao,
      (l.campos_alterados->'registro'->>'descricao')
    )::text AS descricao,
    COALESCE(
      p.valor,
      r.valor,
      NULLIF(l.campos_alterados->'registro'->>'valor','')::numeric
    ) AS valor,
    COALESCE(
      p.fornecedor_nome,
      r.cliente_nome,
      l.campos_alterados->'registro'->>'fornecedor_nome',
      l.campos_alterados->'registro'->>'cliente_nome',
      l.campos_alterados->'registro'->>'nome_pessoa'
    )::text AS nome_pessoa,
    l.campos_alterados
  FROM public.erp_lancamento_log l
  LEFT JOIN public.erp_pagar p
    ON p.id = l.lancamento_id AND l.tabela_origem = 'erp_pagar'
   AND p.company_id = p_company_id
  LEFT JOIN public.erp_receber r
    ON r.id = l.lancamento_id AND l.tabela_origem = 'erp_receber'
   AND r.company_id = p_company_id
  WHERE (p_data_inicio IS NULL OR l.created_at >= p_data_inicio)
    AND (p_data_fim    IS NULL OR l.created_at <  (p_data_fim + interval '1 day'))
    AND (p_acao = 'todas' OR l.acao = p_acao)
    AND (p_tipo = 'todos' OR l.tabela_origem = 'erp_' || p_tipo)
    AND (
      p.id IS NOT NULL
      OR r.id IS NOT NULL
      OR (l.acao = 'EXCLUIU'
          AND (l.campos_alterados->'registro'->>'company_id')::uuid = p_company_id)
    )
  ORDER BY l.created_at DESC
  LIMIT p_limite;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_lancamento_historico_global(uuid, text, text, date, date, integer)
  TO authenticated, service_role;
