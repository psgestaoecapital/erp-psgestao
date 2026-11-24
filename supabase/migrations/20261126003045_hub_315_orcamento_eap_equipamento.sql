-- Hub · §315 Orçamento por EAP (C-2) — coluna de EQUIPAMENTO na composição do item
-- Requisito essencial (blueprint hub_projetos tela 315):
--   "previsão de equipamentos além de material e mão de obra (coluna de equipamentos na composição)".
-- ADITIVA e retrocompatível: a coluna nasce com DEFAULT 0, então o total de todo
-- orçamento já existente NÃO muda (equipamento = 0 em todas as linhas atuais).
-- RLS: a tabela projetos_orcamento_item_eap já tem RLS por empresa; as 3 funções abaixo
-- seguem SECURITY DEFINER com a guarda get_user_company_ids(). Nada de policy nova nem anon.

BEGIN;

-- 1) Coluna aditiva (idempotente)
ALTER TABLE public.projetos_orcamento_item_eap
  ADD COLUMN IF NOT EXISTS custo_equipamento_unit numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.projetos_orcamento_item_eap.custo_equipamento_unit IS
  'Custo de equipamento por unidade (locação/uso de máquina e equipamento), além de material e mão de obra. §315 C-2.';

-- 2) Salvar item: aceita o custo de equipamento (param novo com DEFAULT = retrocompatível)
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  p_orcamento_id uuid,
  p_servico_id uuid,
  p_quantidade numeric,
  p_local_tipo text DEFAULT NULL::text,
  p_local_nome text DEFAULT NULL::text,
  p_eap_codigo text DEFAULT NULL::text,
  p_custo_material_unit numeric DEFAULT NULL::numeric,
  p_custo_mao_obra_unit numeric DEFAULT NULL::numeric,
  p_item_id uuid DEFAULT NULL::uuid,
  p_custo_equipamento_unit numeric DEFAULT NULL::numeric
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company   uuid;
  v_servico   record;
  v_eap       text;
  v_mat       numeric;
  v_mo        numeric;
  v_equip     numeric;
  v_unit      numeric;
  v_qtd       numeric;
  v_item_id   uuid;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  -- Serviço do catálogo da MESMA empresa (satisfaz o CHECK chk_orc_item_ref_compativel)
  SELECT s.id, s.codigo, s.nome, s.unidade, s.eap_codigo, s.ref_padrao_codigo,
         COALESCE(s.custo_material, 0) AS custo_material,
         COALESCE(s.custo_mao_obra, 0) AS custo_mao_obra
  INTO v_servico
  FROM public.projetos_servicos s
  WHERE s.id = p_servico_id
    AND s.company_id = v_company
    AND COALESCE(s.ativo, true) = true
    AND s.deleted_at IS NULL;
  IF v_servico.id IS NULL THEN
    RAISE EXCEPTION 'serviço % não encontrado no catálogo desta empresa', p_servico_id
      USING ERRCODE = 'P0002';
  END IF;

  -- EAP efetiva: override do parâmetro ou a do serviço; obrigatória
  v_eap := COALESCE(NULLIF(btrim(p_eap_codigo), ''), NULLIF(btrim(v_servico.eap_codigo), ''));
  IF v_eap IS NULL THEN
    RAISE EXCEPTION 'código da EAP obrigatório (o serviço não tem EAP; informe p_eap_codigo)'
      USING ERRCODE = '22023';
  END IF;

  -- Custos efetivos: override ou os do serviço; nunca negativos
  v_mat   := COALESCE(p_custo_material_unit, v_servico.custo_material);
  v_mo    := COALESCE(p_custo_mao_obra_unit, v_servico.custo_mao_obra);
  v_equip := COALESCE(p_custo_equipamento_unit, 0);
  v_qtd   := COALESCE(p_quantidade, 0);
  IF v_qtd < 0 OR v_mat < 0 OR v_mo < 0 OR v_equip < 0 THEN
    RAISE EXCEPTION 'quantidade e custos não podem ser negativos' USING ERRCODE = '22023';
  END IF;
  v_unit := v_mat + v_mo + v_equip;

  -- Item compartilhado (erp_orcamentos_itens): insere novo ou atualiza o existente.
  -- O trigger recalc_orcamento_total recalcula o total do orçamento a partir do subtotal.
  IF p_item_id IS NULL THEN
    INSERT INTO public.erp_orcamentos_itens
      (orcamento_id, company_id, tipo_item, servico_id, servico_codigo, servico_descricao,
       unidade, quantidade, preco_unitario, preco_custo, subtotal)
    VALUES
      (p_orcamento_id, v_company, 'servico', v_servico.id, v_servico.codigo, v_servico.nome,
       v_servico.unidade, v_qtd, v_unit, v_unit, round(v_qtd * v_unit, 2))
    RETURNING id INTO v_item_id;
  ELSE
    UPDATE public.erp_orcamentos_itens
       SET tipo_item = 'servico',
           servico_id = v_servico.id,
           servico_codigo = v_servico.codigo,
           servico_descricao = v_servico.nome,
           unidade = v_servico.unidade,
           quantidade = v_qtd,
           preco_unitario = v_unit,
           preco_custo = v_unit,
           subtotal = round(v_qtd * v_unit, 2)
     WHERE id = p_item_id
       AND orcamento_id = p_orcamento_id
       AND company_id = v_company
       AND excluido_em IS NULL
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'item % não encontrado neste orçamento', p_item_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Complemento EAP 1:1 (upsert por orcamento_item_id)
  INSERT INTO public.projetos_orcamento_item_eap
    (orcamento_item_id, company_id, eap_codigo, ref_padrao_codigo, local_tipo, local_nome,
     quantidade, custo_material_unit, custo_mao_obra_unit, custo_equipamento_unit, origem)
  VALUES
    (v_item_id, v_company, v_eap, v_servico.ref_padrao_codigo,
     NULLIF(btrim(p_local_tipo), ''), NULLIF(btrim(p_local_nome), ''),
     v_qtd, v_mat, v_mo, v_equip, 'empresa')
  ON CONFLICT (orcamento_item_id) DO UPDATE
    SET eap_codigo             = EXCLUDED.eap_codigo,
        ref_padrao_codigo      = EXCLUDED.ref_padrao_codigo,
        local_tipo             = EXCLUDED.local_tipo,
        local_nome             = EXCLUDED.local_nome,
        quantidade             = EXCLUDED.quantidade,
        custo_material_unit    = EXCLUDED.custo_material_unit,
        custo_mao_obra_unit    = EXCLUDED.custo_mao_obra_unit,
        custo_equipamento_unit = EXCLUDED.custo_equipamento_unit,
        atualizado_em          = now();

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', v_item_id,
    'eap_codigo', v_eap,
    'subtotal', round(v_qtd * v_unit, 2)
  );
END;
$function$;

-- 3) Listar itens: devolve também o custo de equipamento por unidade
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_listar(p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_itens   jsonb;
BEGIN
  -- Guarda: o orçamento tem de ser de uma empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'item_id',                i.id,
             'servico_id',             i.servico_id,
             'servico_codigo',         i.servico_codigo,
             'servico_descricao',      i.servico_descricao,
             'unidade',                i.unidade,
             'eap_codigo',             e.eap_codigo,
             'local_tipo',             e.local_tipo,
             'local_nome',             e.local_nome,
             'quantidade',             i.quantidade,
             'custo_material_unit',    e.custo_material_unit,
             'custo_mao_obra_unit',    e.custo_mao_obra_unit,
             'custo_equipamento_unit', e.custo_equipamento_unit,
             'subtotal',               i.subtotal
           )
           ORDER BY e.eap_codigo NULLS LAST, e.local_nome NULLS LAST, i.created_at
         ), '[]'::jsonb)
  INTO v_itens
  FROM public.erp_orcamentos_itens i
  JOIN public.projetos_orcamento_item_eap e ON e.orcamento_item_id = i.id
  WHERE i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company
    AND i.excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END;
$function$;

-- 4) Árvore da EAP: soma equipamento por nó/local e no total geral
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
  v_equip      numeric;
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
      'total_geral', 0, 'material_geral', 0, 'mao_obra_geral', 0, 'equipamento_geral', 0,
      'nos', '[]'::jsonb
    );
  END IF;

  -- Base: itens EAP deste orçamento (valor = quantidade × custo unitário)
  WITH itens AS (
    SELECT e.eap_codigo,
           e.local_tipo,
           COALESCE(e.local_nome, lt.nome) AS local_nome,
           (e.quantidade * e.custo_material_unit)     AS material,
           (e.quantidade * e.custo_mao_obra_unit)     AS mao_obra,
           (e.quantidade * e.custo_equipamento_unit)  AS equipamento
    FROM public.projetos_orcamento_item_eap e
    JOIN public.erp_orcamentos_itens i
      ON i.id = e.orcamento_item_id AND i.orcamento_id = p_orcamento_id
    LEFT JOIN public.projetos_local_tipo lt ON lt.codigo = e.local_tipo
  ),
  tot AS (
    SELECT COALESCE(sum(material),0) material,
           COALESCE(sum(mao_obra),0) mao_obra,
           COALESCE(sum(equipamento),0) equipamento
    FROM itens
  )
  SELECT material, mao_obra, equipamento, material + mao_obra + equipamento
    INTO v_material, v_mao_obra, v_equip, v_total
  FROM tot;

  IF p_por_local THEN
    -- Pivot por local (toggle "agrupar por local")
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'local_nome'), '[]'::jsonb)
      INTO v_nos
    FROM (
      SELECT jsonb_build_object(
               'local_tipo', local_tipo,
               'local_nome', COALESCE(local_nome, '(sem local)'),
               'material',    round(sum(material),2),
               'mao_obra',    round(sum(mao_obra),2),
               'equipamento', round(sum(equipamento),2),
               'total',       round(sum(material + mao_obra + equipamento),2),
               'pct',         CASE WHEN v_total > 0
                                   THEN round(100 * sum(material + mao_obra + equipamento) / v_total, 2)
                                   ELSE 0 END
             ) AS x
      FROM (
        SELECT e.local_tipo,
               COALESCE(e.local_nome, lt.nome) AS local_nome,
               (e.quantidade * e.custo_material_unit)    AS material,
               (e.quantidade * e.custo_mao_obra_unit)    AS mao_obra,
               (e.quantidade * e.custo_equipamento_unit) AS equipamento
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
               (e.quantidade * e.custo_material_unit)    AS material,
               (e.quantidade * e.custo_mao_obra_unit)    AS mao_obra,
               (e.quantidade * e.custo_equipamento_unit) AS equipamento
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
               'equipamento',   round(sum(b.equipamento),2),
               'total',         round(sum(b.material + b.mao_obra + b.equipamento),2),
               'pct',           CASE WHEN v_total > 0
                                     THEN round(100 * sum(b.material + b.mao_obra + b.equipamento) / v_total, 2)
                                     ELSE 0 END
             ) AS x
      FROM nos n
      JOIN base b ON b.eap_codigo = n.no OR b.eap_codigo LIKE n.no || '.%'
      LEFT JOIN public.projetos_eap_padrao ep ON ep.codigo = n.no
      GROUP BY n.no, ep.nome
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'orcamento_id',      p_orcamento_id,
    'modo',              CASE WHEN p_por_local THEN 'local' ELSE 'eap' END,
    'total_geral',       round(COALESCE(v_total,0),2),
    'material_geral',    round(COALESCE(v_material,0),2),
    'mao_obra_geral',    round(COALESCE(v_mao_obra,0),2),
    'equipamento_geral', round(COALESCE(v_equip,0),2),
    'nos',               COALESCE(v_nos,'[]'::jsonb)
  );
END;
$function$;

-- 5) RD-95: "?" do novo campo Custo de equipamento (unit.)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'projetos.orcamento_eap.item_custo_equipamento',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Custo equipamento (unit.)',
  'O custo de equipamento por unidade do serviço: locação ou uso de máquina e equipamento (betoneira, andaime, grua, bomba). Deixe 0 quando não houver.',
  'Prevê o equipamento além de material e mão de obra, para o orçamento refletir o custo real do serviço e separar essa parcela na análise.',
  'R$ 12,50',
  'Somar o equipamento no custo de material — é uma parcela própria; some aqui só a locação/uso do equipamento.',
  'projetos',
  135
)
ON CONFLICT (chave) DO UPDATE
  SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
      o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
      exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
      vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();

COMMIT;
