-- Versiona a view criada direto na produção pelo Eng. Chefe (CEO 14/10): dono de cada chamado por carteira.
-- Idempotente: CREATE OR REPLACE igual à definição viva.
CREATE OR REPLACE VIEW public.v_chamado_code_responsavel
WITH (security_invoker = true) AS
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
  WHERE (s.status <> ALL (ARRAY['concluida'::text, 'arquivada'::text])) AND COALESCE(s.interno, false) = false;

REVOKE ALL ON public.v_chamado_code_responsavel FROM anon, PUBLIC;
GRANT SELECT ON public.v_chamado_code_responsavel TO authenticated, service_role;
