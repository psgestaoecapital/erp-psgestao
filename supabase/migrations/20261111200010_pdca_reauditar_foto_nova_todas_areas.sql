-- PDCA · fila de re-auditoria do aud8 (CEO 10/11): corrige QUEM entra na fila. Não mexe em nota nem em critério.
--
-- Dois furos provados no banco:
--  1) a view só tinha 2 motivos (PR publicada depois da nota; nota <95 sem gap) — tela re-fotografada (thumb novo)
--     sem PR nova nunca era re-pontuada: 41 telas com foto mais nova que a nota (19 hub_construcao, 8 pm, 14 gestao_empresarial).
--  2) PR publicada só era lida por título (pm|projetos|hub) e o gap vago só para pm/hub/hub_construcao — a GE (0/74) nunca entrava.
--
-- Correção (CREATE OR REPLACE, mesmas colunas e mesmos tipos; security_invoker=on e grants só para service_role mantidos):
--  - motivo novo 'foto nova depois da nota': thumb mais novo que a última nota da matriz (de qualquer área);
--  - PR publicada: lê o prefixo de qualquer área do título; rota de outras áreas vira '/dashboard/<area>/<tela>'.
--    Só entra rota que existe em system_screens (o join garante que não cria tela inexistente);
--  - gap vago: sem restrição de área (todas as verticais).
-- O aud8 continua avaliando a-h de verdade; a nota só sobe se a tela passar.

CREATE OR REPLACE VIEW public.v_pdca_telas_reauditar
WITH (security_invoker = on) AS
 WITH pubs AS (
         SELECT e.pr_numero,
            e.ocorrido_em,
            substring(e.titulo, '\(([a-z_]+)/'::text) AS area_t,
            substring(e.titulo, '\([a-z_]+/([a-z0-9\-]+)'::text) AS tela_t
           FROM erp_dev_entrega e
          WHERE e.evento = 'publicada'::text AND e.ocorrido_em > (now() - '7 days'::interval)
        ), cand AS (
         SELECT p.pr_numero,
            p.ocorrido_em,
            unnest(
                CASE
                    WHEN p.area_t = 'pm'::text THEN ARRAY['/dashboard/pm/'::text || p.tela_t]
                    WHEN p.area_t = ANY (ARRAY['projetos'::text, 'hub'::text]) THEN ARRAY['/dashboard/projetos/'::text || p.tela_t, '/dashboard/hub/'::text || p.tela_t]
                    ELSE ARRAY['/dashboard/'::text || p.area_t || '/'::text || p.tela_t]
                END) AS rota
           FROM pubs p
          WHERE p.tela_t IS NOT NULL AND p.area_t IS NOT NULL
        ), nota AS (
         SELECT DISTINCT ON ((split_part(m.rota_completa, '?'::text, 1))) split_part(m.rota_completa, '?'::text, 1) AS rota,
            m.score_pct,
            m.consultado_em,
            m.bugs_detectados
           FROM erp_auditor_matriz_resultados m
          WHERE m.status = 'completo'::text AND m.score_pct IS NOT NULL
          ORDER BY (split_part(m.rota_completa, '?'::text, 1)), m.consultado_em DESC
        ), por_pr AS (
         SELECT s.rota,
            s.area,
            n.score_pct AS ultima_nota,
            n.consultado_em AS nota_em,
            max(c.ocorrido_em) AS ultima_pr_em,
            array_agg(DISTINCT c.pr_numero ORDER BY c.pr_numero) AS prs_depois_da_nota,
            COALESCE(s.auditada_ok, false) AS tem_selo,
            'PR publicada depois da nota'::text AS motivo
           FROM cand c
             JOIN system_screens s ON s.rota = c.rota
             LEFT JOIN nota n ON n.rota = s.rota
          WHERE n.consultado_em IS NULL OR c.ocorrido_em > n.consultado_em
          GROUP BY s.rota, s.area, n.score_pct, n.consultado_em, s.auditada_ok
        ), foto AS (
         SELECT s.rota,
            s.area,
            n.score_pct AS ultima_nota,
            n.consultado_em AS nota_em,
            NULL::timestamp with time zone AS ultima_pr_em,
            NULL::integer[] AS prs_depois_da_nota,
            COALESCE(s.auditada_ok, false) AS tem_selo,
            'foto nova depois da nota'::text AS motivo
           FROM (SELECT t.rota, max(t.atualizado_em) AS mx FROM erp_screen_thumb t GROUP BY t.rota) f
             JOIN nota n ON n.rota = f.rota
             JOIN system_screens s ON s.rota = f.rota
          WHERE f.mx > n.consultado_em
            AND NOT (EXISTS (SELECT 1 FROM por_pr p WHERE p.rota = s.rota))
        ), gap_vago AS (
         SELECT s.rota,
            s.area,
            n.score_pct,
            n.consultado_em,
            NULL::timestamp with time zone AS timestamptz,
            NULL::integer[] AS int4,
            COALESCE(s.auditada_ok, false) AS "coalesce",
            'nota <95 sem gap concreto (vazio ou "confirmar/verificar")'::text AS text
           FROM system_screens s
             JOIN nota n ON n.rota = s.rota
          WHERE n.score_pct < 95 AND NOT COALESCE(s.auditada_ok, false)
            AND (COALESCE(array_length(n.bugs_detectados, 1), 0) = 0
                 OR NOT (EXISTS (SELECT 1 FROM unnest(n.bugs_detectados) b(b)
                                  WHERE b.b !~* '^\s*(confirmar|verificar|polir|ajustes? fin)'::text)))
            AND NOT (EXISTS (SELECT 1 FROM por_pr p WHERE p.rota = s.rota))
            AND NOT (EXISTS (SELECT 1 FROM foto f WHERE f.rota = s.rota))
        )
 SELECT por_pr.rota, por_pr.area, por_pr.ultima_nota, por_pr.nota_em, por_pr.ultima_pr_em,
        por_pr.prs_depois_da_nota, por_pr.tem_selo, por_pr.motivo
   FROM por_pr
UNION ALL
 SELECT foto.rota, foto.area, foto.ultima_nota, foto.nota_em, foto.ultima_pr_em,
        foto.prs_depois_da_nota, foto.tem_selo, foto.motivo
   FROM foto
UNION ALL
 SELECT gap_vago.rota, gap_vago.area, gap_vago.score_pct, gap_vago.consultado_em, gap_vago.timestamptz,
        gap_vago.int4, gap_vago."coalesce", gap_vago.text
   FROM gap_vago;

REVOKE ALL ON public.v_pdca_telas_reauditar FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.v_pdca_telas_reauditar TO service_role;
