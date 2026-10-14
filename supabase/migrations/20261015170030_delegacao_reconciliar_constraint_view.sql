-- DELEGAÇÃO aos sócios Jordana e Rodrigo (CEO 14/10 16:00) — RECONCILIAÇÃO (RD-52: o ledger não pode divergir).
-- O Eng. Chefe já aplicou DUAS mudanças NA PRODUÇÃO à mão; esta migration as versiona EXATAMENTE como estão lá,
-- para existirem no repositório e nos bancos de teste. Idempotente (DROP IF EXISTS + ADD / CREATE OR REPLACE):
-- no banco onde já existem, re-cria idêntico; no banco de teste, cria do zero.
--
--   1) constraint erp_agente_mensagem_socio_so_aviso ampliada: jordana-code e rodrigo-code passam a aceitar
--      mensagem de tipo != 'aviso' (ou seja, 'tarefa') do eng_chefe — antes só os gilberto-* aceitavam.
--   2) view v_chamado_code_responsavel: dono (Code responsável) de cada chamado por carteira.
--
-- Sem UPDATE/DELETE de dado de cliente. Aditivo/estrutural. Via revisada (governança/permissão de caixa).

-- 1) Constraint ampliada (exatamente como na produção) ---------------------------------------------------------
ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso CHECK (
  (tipo = 'aviso'::text)
  OR (para = ANY (ARRAY['gilberto-desenv'::text, 'gilberto-produto'::text, 'gilberto-automotivo'::text,
                        'gilberto-industria'::text, 'gilberto-chamados'::text, 'teste-despertador'::text,
                        'jordana-code'::text, 'rodrigo-code'::text]))
  OR (de ~ '^[a-z][a-z0-9]*-chat$'::text)
);

-- 2) View do dono de cada chamado por carteira (exatamente como na produção) -------------------------------------
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

GRANT SELECT ON public.v_chamado_code_responsavel TO authenticated, service_role;
