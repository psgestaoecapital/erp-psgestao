-- GE · Resultado por negócio — sinal do lançamento (Eng. Chefe 06/11/2026, auditoria na fazenda).
-- A 1ª versão usava o valor absoluto: um estorno de receita (valor negativo, ex.: devolução de arrendamento de pasto)
-- virava receita a mais, e um estorno de despesa virava despesa a mais. Agora o sinal do lançamento é respeitado
-- (receber soma como está; pagar entra negativo, e o estorno de pagar entra positivo), igual ao DRE oficial.
-- Só troca o corpo da função de cálculo criada hoje (#4001); assinatura, guarda e permissões iguais.

CREATE OR REPLACE FUNCTION public.fn_ge_resultado_por_negocio_calc(p_company_id uuid, p_ini date, p_fim date, p_regime text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
WITH bl AS (
  SELECT b.id, b.name, b.ln_number FROM public.business_lines b WHERE b.company_id = p_company_id AND b.is_active
),
dpp AS (  -- grupo do DRE de cada conta de DESPESA (mesma prioridade do DRE oficial: neutro/destinação primeiro)
  SELECT DISTINCT ON (pd.origem_codigo) pd.origem_codigo, pc.dre_grupo
  FROM public.psgc_depara pd JOIN public.psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
  ORDER BY pd.origem_codigo, (pc.dre_grupo IN ('NEUTRO','DESTINACAO')) DESC, pd.confianca DESC, pd.revisado DESC
),
dpr AS (  -- grupo do DRE de cada conta de RECEITA
  SELECT DISTINCT ON (pd.origem_codigo) pd.origem_codigo, pc.dre_grupo
  FROM public.psgc_depara pd JOIN public.psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ativo
  ORDER BY pd.origem_codigo, pd.confianca DESC, pd.revisado DESC
),
lanc AS (
  SELECT 'pagar'::text AS origem, p.id, p.categoria::text AS conta, epc.descricao::text AS conta_nome,
         p.centro_custo::text AS centro, NULL::text AS ln_txt,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,'')) AS texto,
         -coalesce(p.valor,0)::numeric AS v,
         CASE WHEN epc.tipo = 'investimento' THEN 'INVESTIMENTO'
              ELSE coalesce(dpp.dre_grupo, CASE WHEN epc.tipo = 'custo' THEN 'CMV' ELSE 'DESP_FIXA' END) END AS grupo
  FROM public.erp_pagar p
  LEFT JOIN public.erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria
  LEFT JOIN dpp ON dpp.origem_codigo = p.categoria
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    AND (CASE WHEN p_regime = 'caixa' THEN p.data_pagamento ELSE coalesce(p.data_competencia, p.data_emissao) END) BETWEEN p_ini AND p_fim
  UNION ALL
  SELECT 'receber', r.id, r.categoria::text, epc.descricao::text, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,'')),
         coalesce(r.valor,0)::numeric,
         coalesce(dpr.dre_grupo, 'SEM_CLASSIFICACAO')
  FROM public.erp_receber r
  LEFT JOIN public.erp_plano_contas epc ON epc.company_id = r.company_id AND epc.codigo = r.categoria
  LEFT JOIN dpr ON dpr.origem_codigo = r.categoria
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND NOT coalesce(r.eh_repasse_cartao, false)
    AND (r.status IS NULL OR r.status <> 'cancelado')
    AND (CASE WHEN p_regime = 'caixa' THEN r.data_pagamento ELSE coalesce(r.data_competencia, r.data_emissao) END)::date BETWEEN p_ini AND p_fim
),
regras AS (
  SELECT m.source_type, lower(trim(m.source_key)) AS chave, m.source_key, m.business_line_id,
         coalesce(m.allocation_pct, 100) / 100.0 AS pct, coalesce(m.tipo_apropriacao, 'direto') AS tp
  FROM public.cost_center_map m
  WHERE m.company_id = p_company_id AND m.ativo AND m.source_type IN ('centro_custo','texto','conta')
),
cand AS (
  SELECT l.origem, l.id, b.id AS bl_id, 1.0::numeric AS pct, 1 AS nivel, 0 AS len, 'linha do lançamento'::text AS via
  FROM lanc l JOIN bl b ON l.ln_txt IS NOT NULL AND lower(trim(b.name)) = lower(l.ln_txt)
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 2, 0, 'centro ' || g.source_key
  FROM lanc l JOIN regras g ON g.source_type = 'centro_custo' AND l.centro IS NOT NULL AND g.chave = lower(trim(l.centro))
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 3, length(g.chave), 'texto "' || g.source_key || '"'
  FROM lanc l JOIN regras g ON g.source_type = 'texto' AND g.chave <> '' AND position(g.chave IN l.texto) > 0
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 4, length(g.chave), 'conta ' || g.source_key
  FROM lanc l JOIN regras g ON g.source_type = 'conta' AND l.conta IS NOT NULL
                          AND (lower(l.conta) = g.chave OR lower(l.conta) LIKE g.chave || '.%')
),
melhor AS (  -- a regra vencedora de cada lançamento: menor nível; no mesmo nível, a chave mais longa (mais específica)
  SELECT DISTINCT ON (origem, id, nivel) origem, id, nivel, len FROM cand
  ORDER BY origem, id, nivel, len DESC
),
venc AS (
  SELECT DISTINCT ON (origem, id) origem, id, nivel, len FROM melhor ORDER BY origem, id, nivel
),
reparte AS (
  SELECT c.origem, c.id, c.bl_id, c.pct, c.via
  FROM cand c JOIN venc w ON w.origem = c.origem AND w.id = c.id AND w.nivel = c.nivel AND w.len = c.len
),
reparte_total AS (
  SELECT r.origem, r.id, r.bl_id, r.pct, r.via FROM reparte r
  UNION ALL  -- sobra de % (regra que não soma 100%) e lançamento sem regra
  SELECT l.origem, l.id, NULL::uuid, 1 - coalesce(s.soma, 0), CASE WHEN s.soma IS NULL THEN 'sem regra' ELSE 'sobra da regra' END
  FROM lanc l LEFT JOIN (SELECT origem, id, sum(pct) AS soma FROM reparte GROUP BY origem, id) s ON s.origem = l.origem AND s.id = l.id
  WHERE coalesce(s.soma, 0) < 0.9999
),
aloc AS (
  SELECT l.origem, l.conta, l.conta_nome, l.grupo, t.bl_id, t.via, round(l.v * t.pct, 2) AS v
  FROM lanc l JOIN reparte_total t ON t.origem = l.origem AND t.id = l.id
),
-- o que entra no resultado operacional e o que fica fora
classe AS (
  SELECT a.*,
    CASE
      WHEN a.grupo IN ('INVESTIMENTO') THEN 'investimento'
      WHEN a.grupo IN ('DESTINACAO') THEN 'destinacao'
      WHEN a.grupo IN ('NEUTRO') THEN 'neutro'
      WHEN a.grupo = 'ROB' THEN 'receita'
      WHEN a.grupo IN ('DEDUCOES','IMPOSTOS_VENDA') THEN 'deducoes'
      WHEN a.grupo = 'CMV' THEN 'custos'
      WHEN a.grupo = 'DESP_VARIAVEL' THEN 'desp_variaveis'
      WHEN a.grupo = 'DESP_FIXA' THEN 'desp_fixas'
      ELSE 'nao_operacional'
    END AS linha
  FROM aloc a
),
-- comum a ratear: despesa sem negócio (receita sem negócio NÃO se rateia: fica em "sem negócio")
pool AS (
  SELECT linha, sum(v) AS v FROM classe
  WHERE bl_id IS NULL AND origem = 'pagar' AND linha IN ('deducoes','custos','desp_variaveis','desp_fixas','nao_operacional')
  GROUP BY linha
),
peso AS (
  SELECT b.id AS bl_id, sum(c.v) AS receita
  FROM bl b JOIN classe c ON c.bl_id = b.id AND c.linha = 'receita'
  GROUP BY b.id HAVING sum(c.v) > 0
),
peso_n AS (
  SELECT bl_id, receita, receita / nullif(sum(receita) OVER (), 0) AS fator FROM peso
),
por_bl AS (
  SELECT b.id AS bl_id, b.name AS nome, b.ln_number,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'receita'), 0) AS receita,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'deducoes'), 0) AS deducoes,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'custos'), 0) AS custos,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'desp_variaveis'), 0) AS desp_variaveis,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'desp_fixas'), 0) AS desp_fixas,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'nao_operacional'), 0) AS nao_operacional
  FROM bl b LEFT JOIN classe c ON c.bl_id = b.id
  GROUP BY b.id, b.name, b.ln_number
),
fim AS (
  SELECT p.*,
    p.receita + p.deducoes + p.custos + p.desp_variaveis + p.desp_fixas AS resultado_direto,
    coalesce(n.fator, 0) AS fator_rateio,
    round(coalesce(n.fator, 0) * coalesce((SELECT sum(v) FROM pool WHERE linha <> 'nao_operacional'), 0), 2) AS rateio_operacional,
    round(coalesce(n.fator, 0) * coalesce((SELECT v FROM pool WHERE linha = 'nao_operacional'), 0), 2) AS rateio_nao_operacional
  FROM por_bl p LEFT JOIN peso_n n ON n.bl_id = p.bl_id
)
SELECT jsonb_build_object(
  'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim, 'regime', p_regime),
  'metodo_rateio', CASE WHEN EXISTS (SELECT 1 FROM peso_n) THEN 'receita' ELSE 'sem_receita_sem_rateio' END,
  'negocios', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.bl_id, 'nome', f.nome,
      'receita', f.receita, 'deducoes', f.deducoes, 'custos', f.custos,
      'desp_variaveis', f.desp_variaveis, 'desp_fixas', f.desp_fixas,
      'resultado_direto', f.resultado_direto,
      'pct_rateio', round(f.fator_rateio * 100, 2),
      'rateio', f.rateio_operacional,
      'resultado_operacional', f.resultado_direto + f.rateio_operacional,
      'nao_operacional', f.nao_operacional + f.rateio_nao_operacional,
      'resultado', f.resultado_direto + f.rateio_operacional + f.nao_operacional + f.rateio_nao_operacional,
      'margem_pct', CASE WHEN f.receita > 0 THEN round((f.resultado_direto + f.rateio_operacional + f.nao_operacional + f.rateio_nao_operacional) / f.receita * 100, 1) END
    ) ORDER BY f.ln_number)
    FROM fim f
    WHERE f.receita <> 0 OR f.custos <> 0 OR f.desp_fixas <> 0 OR f.desp_variaveis <> 0 OR f.deducoes <> 0 OR f.nao_operacional <> 0
  ), '[]'::jsonb),
  'comum', jsonb_build_object(
    'total', coalesce((SELECT sum(v) FROM pool), 0),
    'rateado', CASE WHEN EXISTS (SELECT 1 FROM peso_n) THEN coalesce((SELECT sum(v) FROM pool), 0) ELSE 0 END,
    'por_linha', coalesce((SELECT jsonb_object_agg(linha, v) FROM pool), '{}'::jsonb)
  ),
  'sem_negocio', jsonb_build_object(
    'receita', coalesce((SELECT sum(v) FROM classe WHERE bl_id IS NULL AND origem = 'receber' AND linha = 'receita'), 0),
    'outras', coalesce((SELECT sum(v) FROM classe WHERE bl_id IS NULL AND origem = 'receber' AND linha NOT IN ('receita','investimento','destinacao','neutro')), 0)
  ),
  'fora_do_resultado', jsonb_build_object(
    'investimentos', coalesce((SELECT sum(v) FROM classe WHERE linha = 'investimento'), 0),
    'distribuicao', coalesce((SELECT sum(v) FROM classe WHERE linha = 'destinacao'), 0),
    'neutro', coalesce((SELECT sum(v) FROM classe WHERE linha = 'neutro'), 0)
  ),
  'total_empresa', coalesce((SELECT sum(v) FROM classe WHERE linha NOT IN ('investimento','destinacao','neutro')), 0),
  'contas', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'negocio', x->>'conta') FROM (
      SELECT jsonb_build_object('negocio', coalesce(b.name, CASE WHEN c.origem = 'pagar' THEN 'Comum (rateio)' ELSE 'Sem negócio' END),
                                'conta', coalesce(c.conta, '—'), 'nome', coalesce(c.conta_nome, 'sem conta'),
                                'linha', c.linha, 'via', c.via, 'valor', sum(c.v), 'qtd', count(*)) AS x
      FROM classe c LEFT JOIN bl b ON b.id = c.bl_id
      GROUP BY b.name, c.origem, c.conta, c.conta_nome, c.linha, c.via
    ) s
  ), '[]'::jsonb),
  'sem_regra', coalesce((
    SELECT jsonb_agg(jsonb_build_object('conta', conta, 'nome', conta_nome, 'origem', origem, 'valor', v, 'qtd', n) ORDER BY abs(v) DESC)
    FROM (SELECT origem, coalesce(conta,'—') AS conta, coalesce(conta_nome,'sem conta') AS conta_nome, sum(v) AS v, count(*) AS n
          FROM classe WHERE via = 'sem regra' AND linha NOT IN ('investimento','destinacao','neutro')
          GROUP BY origem, conta, conta_nome) z
  ), '[]'::jsonb)
);
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_resultado_por_negocio_calc(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
