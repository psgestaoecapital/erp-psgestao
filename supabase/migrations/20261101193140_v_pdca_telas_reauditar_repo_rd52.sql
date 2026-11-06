-- RD-52: formaliza no repo a view public.v_pdca_telas_reauditar
--
-- A view foi criada direto em produção pelo eng_chefe (31/10), fora de migration/ledger.
-- Esta migration reproduz EXATAMENTE a definição viva de produção (lida com pg_get_viewdef),
-- preservando security_invoker=on (definido na migration 20261101193100), o mesmo COMMENT e
-- os mesmos grants (só service_role lê; anon/authenticated/PUBLIC sem acesso).
--
-- Ela lista telas com PR publicada (últimos 7 dias) DEPOIS da última nota da matriz,
-- para os auditores PDCA reavaliarem essas telas primeiro.
--
-- CREATE OR REPLACE é idempotente: aplicada em produção não altera o comportamento atual.

CREATE OR REPLACE VIEW public.v_pdca_telas_reauditar
WITH (security_invoker = on) AS
 WITH pubs AS (
         SELECT e.pr_numero,
            e.ocorrido_em,
            "substring"(e.titulo, '\((pm|projetos|hub)/'::text) AS area_t,
            "substring"(e.titulo, '\((?:pm|projetos|hub)/([a-z0-9\-]+)'::text) AS tela_t
           FROM erp_dev_entrega e
          WHERE e.evento = 'publicada'::text AND e.ocorrido_em > (now() - '7 days'::interval)
        ), cand AS (
         SELECT p.pr_numero,
            p.ocorrido_em,
            unnest(
                CASE
                    WHEN p.area_t = 'pm'::text THEN ARRAY['/dashboard/pm/'::text || p.tela_t]
                    ELSE ARRAY['/dashboard/projetos/'::text || p.tela_t, '/dashboard/hub/'::text || p.tela_t]
                END) AS rota
           FROM pubs p
          WHERE p.tela_t IS NOT NULL
        ), nota AS (
         SELECT DISTINCT ON ((split_part(m.rota_completa, '?'::text, 1))) split_part(m.rota_completa, '?'::text, 1) AS rota,
            m.score_pct,
            m.consultado_em
           FROM erp_auditor_matriz_resultados m
          WHERE m.status = 'completo'::text AND m.score_pct IS NOT NULL
          ORDER BY (split_part(m.rota_completa, '?'::text, 1)), m.consultado_em DESC
        )
 SELECT s.rota,
    s.area,
    n.score_pct AS ultima_nota,
    n.consultado_em AS nota_em,
    max(c.ocorrido_em) AS ultima_pr_em,
    array_agg(DISTINCT c.pr_numero ORDER BY c.pr_numero) AS prs_depois_da_nota,
    COALESCE(s.auditada_ok, false) AS tem_selo
   FROM cand c
     JOIN system_screens s ON s.rota = c.rota
     LEFT JOIN nota n ON n.rota = s.rota
  WHERE n.consultado_em IS NULL OR c.ocorrido_em > n.consultado_em
  GROUP BY s.rota, s.area, n.score_pct, n.consultado_em, s.auditada_ok;

COMMENT ON VIEW public.v_pdca_telas_reauditar IS
  'Telas com PR publicada (últimos 7 dias, pelo escopo do título: pm/, projetos/, hub/) DEPOIS da última nota da matriz — os auditores devem reavaliar estas primeiro. Criada pelo eng_chefe 31/10.';

-- Grants: só o canal de serviço lê (sem exposição a anon/authenticated/PUBLIC).
REVOKE ALL ON public.v_pdca_telas_reauditar FROM PUBLIC;
REVOKE ALL ON public.v_pdca_telas_reauditar FROM anon;
REVOKE ALL ON public.v_pdca_telas_reauditar FROM authenticated;
GRANT SELECT ON public.v_pdca_telas_reauditar TO service_role;
