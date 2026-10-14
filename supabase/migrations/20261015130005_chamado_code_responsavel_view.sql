-- Versiona no repositório a view criada direto na produção pelo Eng. Chefe (CEO 14/10):
-- dono de cada chamado = Code da carteira do sócio; demais carteiras e empresas sem carteira = gilberto-chamados.
-- Idempotente: definição idêntica à viva (pg_get_viewdef de 14/10).
CREATE OR REPLACE VIEW public.v_chamado_code_responsavel
WITH (security_invoker = true) AS
SELECT s.id AS sugestao_id,
       s.numero,
       s.status,
       s.company_id,
       COALESCE(c.nome_fantasia, c.razao_social) AS empresa,
       e.nome_curto AS socio_carteira,
       CASE e.agente
         WHEN 'code-jordana' THEN 'jordana-code'
         WHEN 'code-rodrigo' THEN 'rodrigo-code'
         ELSE 'gilberto-chamados'
       END AS code_responsavel,
       CASE
         WHEN e.agente = ANY (ARRAY['code-jordana','code-rodrigo']) THEN 'carteira do sócio'
         WHEN e.agente IS NOT NULL THEN 'carteira atendida pelo central'
         ELSE 'sem carteira (central)'
       END AS regra,
       s.status = ANY (ARRAY['nova','em_analise','aceita','em_desenvolvimento']) AS esperando_ps,
       s.created_at
  FROM sugestoes s
  LEFT JOIN companies c ON c.id = s.company_id
  LEFT JOIN LATERAL (
        SELECT cr_1.responsavel_id
          FROM erp_carteira_responsavel cr_1
         WHERE cr_1.company_id = s.company_id
           AND (cr_1.vigencia_fim IS NULL OR cr_1.vigencia_fim >= CURRENT_DATE)
         ORDER BY cr_1.vigencia_inicio DESC NULLS LAST
         LIMIT 1) cr ON true
  LEFT JOIN erp_chamado_equipe e ON e.user_id = cr.responsavel_id AND e.ativo
 WHERE s.status <> ALL (ARRAY['concluida','arquivada'])
   AND COALESCE(s.interno, false) = false;

REVOKE ALL ON public.v_chamado_code_responsavel FROM PUBLIC, anon;
GRANT SELECT ON public.v_chamado_code_responsavel TO authenticated, service_role;
