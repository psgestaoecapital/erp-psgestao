-- PDCA GE jornada 4 · ADENDO 24/11 (auditor_pdca_2) · CORRECTNESS NÚCLEO
-- DRE/Resultado-por-negócio e elo Hub↔GE contam título RENEGOCIADO (fantasma).
--
-- RAIZ (mesma classe da #6036): quando um título é renegociado o ORIGINAL fica
--   vivo (deleted_at IS NULL, status='renegociado') e nascem os títulos-filho
--   que o substituem. Toda fn que soma valor de face de erp_receber com filtro
--   `status <> 'cancelado'` (sem excluir 'renegociado') conta o original fantasma.
--   #6036 corrigiu só fn_ge_resultado_por_negocio_calc; estas 2 ficaram para trás.
--
-- Esta migration corrige 2 das 4 funções do adendo (as de LEITURA):
--   1. fn_ge_dre_lancamentos_negocio — ramos etl_receber_direto / etl_receber_caixa.
--   2. fn_obras_receita — CTE titulos (elo Hub↔GE; LATENTE hoje, mas dobraria
--      a_receber da obra quando houver obra com título renegociado).
--   (fn_psgc_recalcular_dre_mes — writer do DRE — vai em PR dedicada por ser 16 KB;
--    fn_psgc_recalcular_fluxo — aguarda o merge da #6027 que já a reescreve.)
--
-- PROVA RD-38 (DEMO GE b0700000-0000-4000-a000-000000000004):
--   os 2 únicos títulos vivos de abr/mai-2026 são ambos 'renegociado' (R$1.550 +
--   R$1.420 = R$2.970,00); os filhos 'aberto' (R$3.118,50) estão em outros meses.
--   fn_ge_dre_lancamentos_negocio hoje lista esses 2 fantasmas no drill de negócio.
--
-- PAGAR: NÃO alterado — erp_pagar não tem NENHUM título com status like '%reneg%'
--   (0 linhas, provado no dado), então os ramos etl_pagar_* já estão corretos.
--
-- Fix pontual, aditivo, leitura, sem tocar estrutura nem dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_ge_dre_lancamentos_negocio(p_company_id uuid, p_ini date, p_fim date)
 RETURNS TABLE(fonte text, lanc_id uuid, categoria text, valor numeric, bl_id uuid, pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH bl AS (
  SELECT b.id, b.name FROM public.business_lines b WHERE b.company_id = p_company_id AND b.is_active
),
lanc AS (
  SELECT 'etl_pagar_direto'::text AS fonte, 'pagar'::text AS origem, p.id, p.categoria::text AS categoria, p.valor::numeric AS valor,
         p.centro_custo::text AS centro, NULL::text AS ln_txt,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,'')) AS texto
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND coalesce(p.data_competencia, p.data_emissao) BETWEEN p_ini AND p_fim
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
  UNION ALL
  SELECT 'etl_pagar_caixa', 'pagar', p.id, p.categoria::text, p.valor::numeric, p.centro_custo::text, NULL,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,''))
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND p.data_pagamento BETWEEN p_ini AND p_fim
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
  UNION ALL
  SELECT 'etl_receber_direto', 'receber', r.id, r.categoria::text, r.valor::numeric, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,''))
  FROM public.erp_receber r
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND NOT coalesce(r.eh_repasse_cartao, false)
    AND coalesce(r.data_competencia, r.data_emissao)::date BETWEEN p_ini AND p_fim
    AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
  UNION ALL
  SELECT 'etl_receber_caixa', 'receber', r.id, r.categoria::text, r.valor::numeric, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,''))
  FROM public.erp_receber r
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND coalesce(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
    AND r.data_pagamento::date BETWEEN p_ini AND p_fim
    AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
),
regras AS (
  SELECT m.source_type, lower(trim(m.source_key)) AS chave, m.business_line_id,
         coalesce(m.allocation_pct, 100) / 100.0 AS pct, coalesce(m.tipo_apropriacao, 'direto') AS tp
  FROM public.cost_center_map m
  WHERE m.company_id = p_company_id AND m.ativo AND m.source_type IN ('centro_custo','texto','conta')
),
cand AS (
  SELECT l.fonte, l.id, b.id AS bl_id, 1.0::numeric AS pct, 1 AS nivel, 0 AS len
  FROM lanc l JOIN bl b ON l.ln_txt IS NOT NULL AND lower(trim(b.name)) = lower(l.ln_txt)
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 2, 0
  FROM lanc l JOIN regras g ON g.source_type = 'centro_custo' AND l.centro IS NOT NULL AND g.chave = lower(trim(l.centro))
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 3, length(g.chave)
  FROM lanc l JOIN regras g ON g.source_type = 'texto' AND g.chave <> '' AND position(g.chave IN l.texto) > 0
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 4, length(g.chave)
  FROM lanc l JOIN regras g ON g.source_type = 'conta' AND l.categoria IS NOT NULL
                          AND (lower(l.categoria) = g.chave OR lower(l.categoria) LIKE g.chave || '.%')
),
melhor AS (
  SELECT DISTINCT ON (fonte, id, nivel) fonte, id, nivel, len FROM cand ORDER BY fonte, id, nivel, len DESC
),
venc AS (
  SELECT DISTINCT ON (fonte, id) fonte, id, nivel, len FROM melhor ORDER BY fonte, id, nivel
),
reparte AS (
  SELECT c.fonte, c.id, c.bl_id, c.pct
  FROM cand c JOIN venc w ON w.fonte = c.fonte AND w.id = c.id AND w.nivel = c.nivel AND w.len = c.len
),
reparte_total AS (
  SELECT r.fonte, r.id, r.bl_id, r.pct FROM reparte r
  UNION ALL
  SELECT l.fonte, l.id, NULL::uuid, 1 - coalesce(s.soma, 0)
  FROM lanc l LEFT JOIN (SELECT fonte, id, sum(pct) AS soma FROM reparte GROUP BY fonte, id) s ON s.fonte = l.fonte AND s.id = l.id
  WHERE coalesce(s.soma, 0) < 0.9999
)
SELECT l.fonte, l.id, l.categoria, l.valor, t.bl_id, t.pct
FROM lanc l JOIN reparte_total t ON t.fonte = l.fonte AND t.id = l.id;
$function$;

-- Guarda de acesso (check_fn_guards · [revoke_anon]): reafirma a ACL VIVA, que é
-- SÓ service_role (a fn não confere acesso do chamador ao p_company_id — é chamada
-- por wrapper). NÃO conceder a authenticated (abriria leitura cross-tenant).
REVOKE ALL ON FUNCTION public.fn_ge_dre_lancamentos_negocio(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_dre_lancamentos_negocio(uuid, date, date) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_obras_receita(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, faturado numeric, recebido numeric, a_receber numeric, notas integer, notas_sem_titulo integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH notas AS (
    SELECT n.obra_id, n.id, COALESCE(n.valor_bruto, n.valor_servicos, 0) AS bruto, n.erp_receber_id
      FROM public.erp_nfse_emitidas n
     WHERE n.company_id = ANY(p_company_ids)
       AND n.company_id IN (SELECT public.get_user_company_ids())
       AND n.obra_id IS NOT NULL
       AND n.status = 'autorizada'
  ), titulos AS (
    SELECT DISTINCT ON (r.id) nt.obra_id, r.id, r.valor, r.status,
           COALESCE((SELECT sum(b.valor) FROM public.erp_receber_baixa b WHERE b.receber_id = r.id AND b.deleted_at IS NULL),
                    CASE WHEN r.status = 'pago' THEN COALESCE(r.valor_pago, r.valor) ELSE COALESCE(r.valor_pago, 0) END) AS entrou
      FROM notas nt
      JOIN public.erp_receber r ON r.id = nt.erp_receber_id
     WHERE r.deleted_at IS NULL AND r.status NOT IN ('cancelado','renegociado')
  )
  SELECT o.id,
         COALESCE((SELECT sum(nt.bruto) FROM notas nt WHERE nt.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(t.entrou) FROM titulos t WHERE t.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(GREATEST(t.valor - t.entrou, 0)) FROM titulos t WHERE t.obra_id = o.id AND t.status <> 'pago'), 0)::numeric(14,2),
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id)::int,
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id AND nt.erp_receber_id IS NULL)::int
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids());
$function$;

-- Guarda de acesso (check_fn_guards · [revoke_anon]): reafirma a ACL VIVA
-- (authenticated + service_role), sem ampliar acesso.
REVOKE ALL ON FUNCTION public.fn_obras_receita(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_receita(uuid[]) TO authenticated, service_role;
