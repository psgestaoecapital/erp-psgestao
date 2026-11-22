-- Onda C-2 · slice 2 (Hub · tela 315) — árvore EAP do orçamento com somas e %
-- ADITIVA: função NOVA de leitura. Depende da tabela projetos_orcamento_item_eap
-- (slice 1 · PR #5791). Guarda to_regclass => segura mesmo antes da tabela existir.
-- RLS: SECURITY DEFINER com guarda explícita de empresa (get_user_company_ids).
-- Idempotente (CREATE OR REPLACE de função NOVA).

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_arvore(
  p_orcamento_id uuid,
  p_por_local    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      numeric;
  v_material   numeric;
  v_mao_obra   numeric;
  v_nos        jsonb;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  IF NOT EXISTS (
    SELECT 1 FROM public.erp_orcamentos o
    WHERE o.id = p_orcamento_id
      AND o.company_id IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id
      USING ERRCODE = '42501';
  END IF;

  -- Antes de a tabela do slice 1 existir: devolve estrutura vazia (não quebra a tela)
  IF to_regclass('public.projetos_orcamento_item_eap') IS NULL THEN
    RETURN jsonb_build_object(
      'orcamento_id', p_orcamento_id,
      'modo', CASE WHEN p_por_local THEN 'local' ELSE 'eap' END,
      'total_geral', 0, 'material_geral', 0, 'mao_obra_geral', 0,
      'nos', '[]'::jsonb
    );
  END IF;

  -- Base: itens EAP deste orçamento (valor = quantidade × custo unitário)
  WITH itens AS (
    SELECT e.eap_codigo,
           e.local_tipo,
           COALESCE(e.local_nome, lt.nome) AS local_nome,
           (e.quantidade * e.custo_material_unit)  AS material,
           (e.quantidade * e.custo_mao_obra_unit)  AS mao_obra
    FROM public.projetos_orcamento_item_eap e
    JOIN public.erp_orcamentos_itens i
      ON i.id = e.orcamento_item_id AND i.orcamento_id = p_orcamento_id
    LEFT JOIN public.projetos_local_tipo lt ON lt.codigo = e.local_tipo
  ),
  tot AS (
    SELECT COALESCE(sum(material),0) material,
           COALESCE(sum(mao_obra),0) mao_obra
    FROM itens
  )
  SELECT material, mao_obra, material + mao_obra
    INTO v_material, v_mao_obra, v_total
  FROM tot;

  IF p_por_local THEN
    -- Pivot por local (toggle "agrupar por local")
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'local_nome'), '[]'::jsonb)
      INTO v_nos
    FROM (
      SELECT jsonb_build_object(
               'local_tipo', local_tipo,
               'local_nome', COALESCE(local_nome, '(sem local)'),
               'material',  round(sum(material),2),
               'mao_obra',  round(sum(mao_obra),2),
               'total',     round(sum(material + mao_obra),2),
               'pct',       CASE WHEN v_total > 0
                                 THEN round(100 * sum(material + mao_obra) / v_total, 2)
                                 ELSE 0 END
             ) AS x
      FROM (
        SELECT e.local_tipo,
               COALESCE(e.local_nome, lt.nome) AS local_nome,
               (e.quantidade * e.custo_material_unit) AS material,
               (e.quantidade * e.custo_mao_obra_unit) AS mao_obra
        FROM public.projetos_orcamento_item_eap e
        JOIN public.erp_orcamentos_itens i
          ON i.id = e.orcamento_item_id AND i.orcamento_id = p_orcamento_id
        LEFT JOIN public.projetos_local_tipo lt ON lt.codigo = e.local_tipo
      ) s
      GROUP BY local_tipo, local_nome
    ) q;
  ELSE
    -- Árvore EAP: cada nó = soma de si + descendentes (match por prefixo)
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'eap_codigo'), '[]'::jsonb)
      INTO v_nos
    FROM (
      WITH base AS (
        SELECT e.eap_codigo,
               (e.quantidade * e.custo_material_unit) AS material,
               (e.quantidade * e.custo_mao_obra_unit) AS mao_obra
        FROM public.projetos_orcamento_item_eap e
        JOIN public.erp_orcamentos_itens i
          ON i.id = e.orcamento_item_id AND i.orcamento_id = p_orcamento_id
      ),
      nos AS (  -- todos os ancestrais (inclusive o próprio nó) dos códigos presentes
        SELECT DISTINCT
          array_to_string((string_to_array(eap_codigo,'.'))[1:g], '.') AS no
        FROM base, generate_series(1, array_length(string_to_array(eap_codigo,'.'),1)) g
      )
      SELECT jsonb_build_object(
               'eap_codigo',    n.no,
               'nome',          COALESCE(ep.nome, n.no),
               'nivel',         array_length(string_to_array(n.no,'.'),1),
               'parent_codigo', NULLIF(regexp_replace(n.no,'\.[^.]+$',''), n.no),
               'material',      round(sum(b.material),2),
               'mao_obra',      round(sum(b.mao_obra),2),
               'total',         round(sum(b.material + b.mao_obra),2),
               'pct',           CASE WHEN v_total > 0
                                     THEN round(100 * sum(b.material + b.mao_obra) / v_total, 2)
                                     ELSE 0 END
             ) AS x
      FROM nos n
      JOIN base b ON b.eap_codigo = n.no OR b.eap_codigo LIKE n.no || '.%'
      LEFT JOIN public.projetos_eap_padrao ep ON ep.codigo = n.no
      GROUP BY n.no, ep.nome
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'orcamento_id',   p_orcamento_id,
    'modo',           CASE WHEN p_por_local THEN 'local' ELSE 'eap' END,
    'total_geral',    round(COALESCE(v_total,0),2),
    'material_geral', round(COALESCE(v_material,0),2),
    'mao_obra_geral', round(COALESCE(v_mao_obra,0),2),
    'nos',            COALESCE(v_nos,'[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_arvore(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_arvore(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.fn_projetos_orcamento_eap_arvore(uuid, boolean) IS
  'Hub C-2 · árvore EAP do orçamento (somas material/MO/total + % por nó); p_por_local pivota por local. Guarda de empresa.';
