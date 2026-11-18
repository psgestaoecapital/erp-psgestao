-- Achados do Code-Auditor (sugestoes.agente='gilberto-produto', area='hub_projetos') não são chamados de cliente (CEO 17/10, RD-97).
-- 1) v_chamado_code_responsavel: os achados saem de esperando_ps (acordadores chamados-plantao-5min, jordana-/rodrigo-chamados-5min).
--    Mesmas colunas e ordem; só ganha um filtro. 2) Função NOVA só de leitura com os dois blocos separados para o painel.
CREATE OR REPLACE VIEW public.v_chamado_code_responsavel AS
 SELECT s.id AS sugestao_id,
    s.numero,
    s.status,
    s.company_id,
    COALESCE(c.nome_fantasia, c.razao_social) AS empresa,
    e.nome_curto AS socio_carteira,
        CASE e.agente
            WHEN 'code-jordana'::text THEN 'jordana-code'::text
            WHEN 'code-rodrigo'::text THEN 'rodrigo-code'::text
            ELSE 'gilberto-chamados'::text
        END AS code_responsavel,
        CASE
            WHEN e.agente = ANY (ARRAY['code-jordana'::text, 'code-rodrigo'::text]) THEN 'carteira do sócio'::text
            WHEN e.agente IS NOT NULL THEN 'carteira atendida pelo central'::text
            ELSE 'sem carteira (central)'::text
        END AS regra,
    s.status = ANY (ARRAY['nova'::text, 'em_analise'::text, 'aceita'::text, 'em_desenvolvimento'::text]) AS esperando_ps,
    s.created_at
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id
     LEFT JOIN LATERAL ( SELECT cr_1.responsavel_id
           FROM erp_carteira_responsavel cr_1
          WHERE cr_1.company_id = s.company_id AND (cr_1.vigencia_fim IS NULL OR cr_1.vigencia_fim >= CURRENT_DATE)
          ORDER BY cr_1.vigencia_inicio DESC NULLS LAST
         LIMIT 1) cr ON true
     LEFT JOIN erp_chamado_equipe e ON e.user_id = cr.responsavel_id AND e.ativo
  WHERE (s.status <> ALL (ARRAY['concluida'::text, 'arquivada'::text]))
    AND COALESCE(s.interno, false) = false
    AND NOT (s.agente = 'gilberto-produto' AND s.area = 'hub_projetos');

CREATE OR REPLACE FUNCTION public.fn_dev_chamados_clientes_x_auditor()
RETURNS TABLE(bloco text, abertos integer, corrigidos integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN QUERY
  SELECT CASE WHEN s.agente = 'gilberto-produto' AND s.area = 'hub_projetos' THEN 'achados_auditor' ELSE 'chamados_clientes' END,
         (count(*) FILTER (WHERE s.status NOT IN ('concluida', 'arquivada')))::integer,
         (count(*) FILTER (WHERE s.status = 'concluida'))::integer
  FROM public.sugestoes s
  WHERE COALESCE(s.interno, false) = false
  GROUP BY 1
  ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_chamados_clientes_x_auditor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_chamados_clientes_x_auditor() TO authenticated, service_role;
