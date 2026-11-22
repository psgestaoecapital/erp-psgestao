-- Hub · Onda C-2 · tela 315 (orçamento por EAP) — CRUD do item (RD-98 p2): EDITAR e EXCLUIR.
-- Gap crítico do PDCA (d635c805): a árvore EAP só tinha "+ Item" (incluir). Sem editar/excluir, um item
-- lançado com erro (quantidade/custo/local/EAP) prendia o usuário. A UI precisa:
--   (a) LISTAR os itens individuais com seus IDs (a árvore só devolve nós agregados por EAP);
--   (b) EDITAR reaproveitando fn_projetos_orcamento_item_eap_salvar(..., p_item_id) — já existe;
--   (c) EXCLUIR por fn_orcamento_item_excluir(item_id) — soft-delete (excluido_em) + rastro — já existe.
-- Esta migration:
--   1. CRIA fn_projetos_orcamento_item_eap_listar — função NOVA de leitura (aditiva), guarda de empresa.
--   2. SUBSTITUI fn_projetos_orcamento_eap_arvore acrescentando o filtro `i.excluido_em IS NULL` nos joins,
--      para que item excluído saia da árvore e dos totais (sem o filtro, o soft-delete não refletiria).
-- RLS: SECURITY DEFINER com guarda explícita (get_user_company_ids). REVOKE anon/public; GRANT authenticated.
-- Idempotente (CREATE OR REPLACE). Não cria/altera estrutura de dados (nenhuma tabela/coluna nova).
-- Code: desenvolvedor_4_g

-- 1) LISTAR itens individuais do orçamento que têm complemento EAP (para a UI editar/excluir cada um).
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_listar(p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_itens jsonb;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  IF NOT EXISTS (
    SELECT 1 FROM public.erp_orcamentos o
    WHERE o.id = p_orcamento_id
      AND o.company_id IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  -- Antes de a tabela do slice 1 existir: devolve lista vazia (não quebra a tela)
  IF to_regclass('public.projetos_orcamento_item_eap') IS NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'itens', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'eap_codigo', x->>'local_nome'), '[]'::jsonb)
    INTO v_itens
  FROM (
    SELECT jsonb_build_object(
             'orcamento_item_id',   i.id,
             'servico_id',          i.servico_id,
             'servico_codigo',      i.servico_codigo,
             'servico_nome',        COALESCE(i.servico_descricao, i.produto_nome),
             'unidade',             i.unidade,
             'eap_codigo',          e.eap_codigo,
             'local_tipo',          e.local_tipo,
             'local_nome',          COALESCE(e.local_nome, lt.nome),
             'quantidade',          e.quantidade,
             'custo_material_unit', e.custo_material_unit,
             'custo_mao_obra_unit', e.custo_mao_obra_unit,
             'subtotal',            round(e.quantidade * (COALESCE(e.custo_material_unit,0) + COALESCE(e.custo_mao_obra_unit,0)), 2)
           ) AS x
    FROM public.projetos_orcamento_item_eap e
    JOIN public.erp_orcamentos_itens i
      ON i.id = e.orcamento_item_id
     AND i.orcamento_id = p_orcamento_id
     AND i.excluido_em IS NULL
    LEFT JOIN public.projetos_local_tipo lt ON lt.codigo = e.local_tipo
  ) q;

  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'itens', COALESCE(v_itens, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) IS
  'Hub C-2 tela 315: lista os itens individuais (com id) do orçamento que têm complemento EAP, para a UI editar/excluir cada item. Guarda de empresa; ignora itens com excluido_em. REVOKE anon.';

-- 2) ÁRVORE EAP: mesma função, acrescentando `AND i.excluido_em IS NULL` nos joins para que o
--    item excluído (soft-delete) saia da árvore e dos totais. Resto do corpo inalterado.
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_arvore(p_orcamento_id uuid, p_por_local boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     AND i.excluido_em IS NULL
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
         AND i.excluido_em IS NULL
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
         AND i.excluido_em IS NULL
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
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_arvore(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_arvore(uuid, boolean) TO authenticated;

-- 3) Ajuda de campo (RD-95) do bloco "Itens do orçamento" (lista com editar/excluir) +
--    correção do texto do "Total estruturado (EAP)": é a soma dos itens estruturados pela EAP,
--    não necessariamente o total cheio do orçamento (gap 2 do PDCA d635c805).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.itens','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Itens do orçamento','A lista de cada serviço lançado no orçamento, com EAP, local, quantidade e subtotal.','Permite corrigir (editar) ou remover (excluir) um item lançado com erro, sem refazer o orçamento. A árvore e os totais se ajustam.','Clique em Editar para ajustar quantidade/custo; Excluir remove o item do orçamento.','Excluir um item achando que só sai da visão — ele é removido do orçamento (com rastro) e o total cai.','projetos',50,'publicado'),
 ('projetos.orcamento_eap.total','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Total estruturado (EAP)','A soma dos itens já estruturados pela EAP (material + mão de obra).','Mostra o valor da obra organizado pela EAP. Se o orçamento tiver itens sem EAP, eles não entram aqui — o aviso informa quanto falta estruturar.','R$ 237.437,50 estruturados de um orçamento de R$ 690.902,50','Ler o total da EAP como total cheio da obra quando ainda há itens sem EAP.','projetos',10,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
