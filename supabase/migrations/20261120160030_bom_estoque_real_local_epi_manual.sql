-- CEO 18/11 (FC Pisos/Diego · Hub/Projetos): "Adicionar item ao BOM" passa a ter 4 tipos (Material, Mão de obra,
-- Equipamento, EPI); Material/Equipamento/EPI puxam do ESTOQUE REAL (erp_produtos) com filtro por LOCAL de estoque;
-- qualquer tipo aceita ENTRADA MANUAL (nome+unidade+custo, sem cadastro); e a composição é FLEXÍVEL (o serviço pode
-- ter um único tipo). Decisão 🅰️ do CEO: EPI vem do ESTOQUE (local dos EPIs), não do módulo epi_catalogo.
--
-- Aditiva (RD-97): novas COLUNAS em projetos_servicos_bom (produto_id, local_id, item_nome_manual,
-- custo_unitario_manual) + CHECKs REDEFINIDOS (mesmo nome → o gate aceita como "redefinir"); as funções de custo e de
-- leitura passam a reconhecer as novas fontes (produto do estoque, manual, EPI); RPC nova fn_bom_estoque_fontes.
-- Nada destrutivo: itens antigos (insumo_id/m16, mao_obra_id) seguem válidos e com o mesmo cálculo. RLS já ligada em
-- projetos_servicos_bom / erp_produtos / erp_estoque_locais. SENSÍVEL (CREATE OR REPLACE de função + RLS) → revisor.

-- ───────────────────────── 1) Colunas novas (aditivas, nullable) ─────────────────────────
ALTER TABLE public.projetos_servicos_bom
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.erp_produtos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS local_id uuid REFERENCES public.erp_estoque_locais(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_nome_manual text,
  ADD COLUMN IF NOT EXISTS custo_unitario_manual numeric(12,2);

CREATE INDEX IF NOT EXISTS ix_projetos_servicos_bom_produto ON public.projetos_servicos_bom(produto_id);

-- ───────────────────────── 2) CHECKs redefinidos (mesmo nome) ─────────────────────────
-- tipo ganha 'epi'
ALTER TABLE public.projetos_servicos_bom DROP CONSTRAINT IF EXISTS projetos_servicos_bom_tipo_check;
ALTER TABLE public.projetos_servicos_bom ADD CONSTRAINT projetos_servicos_bom_tipo_check
  CHECK (tipo = ANY (ARRAY['insumo'::text, 'mao_obra'::text, 'equipamento'::text, 'epi'::text]));

-- Referência: exatamente UMA fonte por item (mao_obra_id, insumo_id legado, produto_id do estoque, ou item manual).
-- Itens antigos tinham exatamente uma (insumo_id OU mao_obra_id) → continuam válidos (soma = 1).
ALTER TABLE public.projetos_servicos_bom DROP CONSTRAINT IF EXISTS bom_uma_referencia;
ALTER TABLE public.projetos_servicos_bom ADD CONSTRAINT bom_uma_referencia CHECK (
  ( (mao_obra_id IS NOT NULL)::int
  + (insumo_id IS NOT NULL)::int
  + (produto_id IS NOT NULL)::int
  + (item_nome_manual IS NOT NULL)::int ) = 1
);

-- ───────────────────────── 3) Custo por LINHA do BOM (todas as fontes) ─────────────────────────
-- Resolve o custo unitário de cada linha a partir da fonte certa; mão de obra sem perda, demais com perda.
CREATE OR REPLACE FUNCTION public.fn_projetos_atualizar_cache_bom(p_servico_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_publico boolean;
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN RETURN; END IF;  -- serviço inexistente (ex.: cascade de exclusão): nada a fazer
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  UPDATE projetos_servicos_bom bom
  SET custo_unitario = src.cu,
      custo_total = bom.quantidade
                    * (CASE WHEN bom.tipo = 'mao_obra' THEN 1 ELSE (1 + COALESCE(bom.perda_pct, 0)/100) END)
                    * src.cu
  FROM (
    SELECT b.id,
      CASE
        WHEN b.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN b.produto_id IS NOT NULL       THEN COALESCE(p.preco_custo_medio, p.preco_custo, 0)
        WHEN b.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN b.item_nome_manual IS NOT NULL THEN COALESCE(b.custo_unitario_manual, 0)
        ELSE 0
      END AS cu
    FROM projetos_servicos_bom b
    LEFT JOIN m16_insumos i       ON i.id = b.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = b.produto_id
    WHERE b.servico_id = p_servico_id
  ) src
  WHERE bom.id = src.id AND bom.servico_id = p_servico_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) TO authenticated, service_role;

-- ───────────────────────── 4) Custo TOTAL do serviço (todas as fontes; EPI entra no material) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_recalcular_custo_servico(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_publico boolean;
  v_material numeric(12,2);
  v_mao_obra numeric(12,2);
  v_equip numeric(12,2);
  v_total numeric(12,2);
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('success', true, 'custo_total', 0); END IF;
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  WITH linhas AS (
    SELECT bom.tipo, bom.quantidade, COALESCE(bom.perda_pct, 0) AS perda,
      CASE
        WHEN bom.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN bom.produto_id IS NOT NULL       THEN COALESCE(p.preco_custo_medio, p.preco_custo, 0)
        WHEN bom.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN bom.item_nome_manual IS NOT NULL THEN COALESCE(bom.custo_unitario_manual, 0)
        ELSE 0
      END AS cu,
      (bom.insumo_id IS NOT NULL AND COALESCE(i.category, '') = 'EQUIP') AS legado_equip
    FROM projetos_servicos_bom bom
    LEFT JOIN m16_insumos i       ON i.id = bom.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = bom.produto_id
    WHERE bom.servico_id = p_servico_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN (tipo = 'insumo' AND NOT legado_equip) OR tipo = 'epi' THEN quantidade * (1 + perda/100) * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'mao_obra' THEN quantidade * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'equipamento' OR (tipo = 'insumo' AND legado_equip) THEN quantidade * (1 + perda/100) * cu END), 0)
  INTO v_material, v_mao_obra, v_equip
  FROM linhas;

  v_total := v_material + v_mao_obra + v_equip;

  UPDATE projetos_servicos
  SET custo_material = v_material, custo_mao_obra = v_mao_obra, custo_equipamento = v_equip,
      custo_unitario_total = v_total, updated_at = now()
  WHERE id = p_servico_id;

  RETURN jsonb_build_object('success', true, 'custo_total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) TO authenticated, service_role;

-- ───────────────────────── 5) Serviço completo (nome do item em todas as fontes + EPI) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_servico_completo(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_servico jsonb;
  v_bom jsonb;
  v_config jsonb;
  v_validacao jsonb;
BEGIN
  SELECT to_jsonb(s.*) INTO v_servico FROM projetos_servicos s WHERE s.id = p_servico_id;
  IF v_servico IS NULL THEN RETURN jsonb_build_object('error', 'servico nao encontrado'); END IF;

  IF (v_servico->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
     AND NOT COALESCE((v_servico->>'is_publico')::boolean, false)
     AND NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'sem acesso');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bom.id,
      'tipo', bom.tipo,
      'item_id', COALESCE(bom.produto_id, bom.insumo_id, bom.mao_obra_id),
      'produto_id', bom.produto_id,
      'local_id', bom.local_id,
      'item_nome', COALESCE(bom.item_nome_manual, p.nome, i.name, mo.funcao),
      'item_categoria', CASE
        WHEN bom.tipo = 'mao_obra' THEN 'mao_obra'
        WHEN bom.tipo = 'epi' THEN 'epi'
        WHEN bom.produto_id IS NOT NULL THEN COALESCE(p.categoria, bom.tipo)
        ELSE COALESCE(i.category, bom.tipo)
      END,
      'quantidade', bom.quantidade,
      'unidade', bom.unidade,
      'perda_pct', bom.perda_pct,
      'custo_unitario', bom.custo_unitario,
      'custo_total', bom.custo_total,
      'ordem', bom.ordem,
      'observacao', bom.observacao
    ) ORDER BY bom.ordem, bom.id
  ) INTO v_bom
  FROM projetos_servicos_bom bom
  LEFT JOIN m16_insumos i       ON i.id = bom.insumo_id
  LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
  LEFT JOIN erp_produtos p       ON p.id = bom.produto_id
  WHERE bom.servico_id = p_servico_id;

  SELECT to_jsonb(c.*) INTO v_config FROM projetos_modulo_config c WHERE c.company_id = (v_servico->>'company_id')::uuid;

  v_validacao := jsonb_build_object(
    'tem_material', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo IN ('insumo', 'equipamento')),
    'tem_mao_obra', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo = 'mao_obra'),
    'tem_epi', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo = 'epi'),
    'tem_produtividade', (v_servico->>'produtividade_unidade_dia') IS NOT NULL,
    'tem_custo_calculado', (v_servico->>'custo_unitario_total')::numeric > 0,
    'qtd_itens_bom', COALESCE(jsonb_array_length(v_bom), 0)
  );

  RETURN jsonb_build_object(
    'servico', v_servico,
    'bom', COALESCE(v_bom, '[]'::jsonb),
    'config', v_config,
    'validacao', v_validacao,
    'preview', jsonb_build_object(
      'custo_total', (v_servico->>'custo_unitario_total')::numeric,
      'bdi_pct', COALESCE((v_config->>'bdi_total_pct')::numeric, 0),
      'preco_venda', round((v_servico->>'custo_unitario_total')::numeric * (1 + COALESCE((v_config->>'bdi_total_pct')::numeric, 0)/100), 2),
      'lucro_estimado', round((v_servico->>'custo_unitario_total')::numeric * COALESCE((v_config->>'bdi_lucro_pct')::numeric, 0)/100, 2)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_servico_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_servico_completo(uuid) TO authenticated, service_role;

-- ───────────────────────── 6) Fontes do estoque p/ o modal (produtos + locais + mapa produto→locais) ─────────────────────────
-- Uma chamada por abertura do modal. Produto sem movimentação em local algum NÃO entra no mapa → cai em "Sem local" na UI.
CREATE OR REPLACE FUNCTION public.fn_bom_estoque_fontes(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_produtos jsonb;
  v_locais jsonb;
  v_mapa jsonb;
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'codigo', codigo, 'nome', nome, 'unidade', unidade,
           'custo', COALESCE(preco_custo_medio, preco_custo)) ORDER BY nome), '[]'::jsonb)
    INTO v_produtos
    FROM public.erp_produtos
   WHERE company_id = p_company_id AND ativo AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ativo', ativo)
           ORDER BY ativo DESC, nome), '[]'::jsonb)
    INTO v_locais
    FROM public.erp_estoque_locais
   WHERE company_id = p_company_id;

  SELECT COALESCE(jsonb_object_agg(produto_id, locais), '{}'::jsonb) INTO v_mapa FROM (
    SELECT produto_id, jsonb_agg(DISTINCT local_id) AS locais
    FROM public.erp_estoque_movimentacoes
    WHERE company_id = p_company_id AND produto_id IS NOT NULL AND local_id IS NOT NULL
    GROUP BY produto_id
  ) t;

  RETURN jsonb_build_object('ok', true, 'produtos', v_produtos, 'locais', v_locais, 'produto_locais', v_mapa);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bom_estoque_fontes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bom_estoque_fontes(uuid) TO authenticated, service_role;

-- ───────────────────────── 7) Ajuda de campo (RD-95) ─────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.catalogo.seletor.local', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Local de estoque', 'Escolha de qual local do estoque filtrar os itens (Container 1, Container 2…). "Todos" mostra tudo; "Sem local" mostra o que ainda não foi alocado.', 'Ajuda a achar o item certo pelo local onde ele fica (ex.: EPIs no Container 1, equipamentos no Container 2).', 'Container 1', 'Não achar um produto porque está filtrando por um local onde ele ainda não teve entrada: use "Todos" ou "Sem local".', 'hub_projetos', 500),
  ('projetos.catalogo.seletor.manual_nome', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Nome do item (manual)', 'O nome do item que você está digitando à mão, sem precisar de cadastro.', 'Permite incluir no BOM um item que ainda não está no estoque nem no catálogo.', 'Parafuso bucha 8mm', 'Digitar manual algo que já existe no estoque: prefira buscar para puxar o custo certo.', 'hub_projetos', 501),
  ('projetos.catalogo.seletor.manual_unidade', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Unidade (manual)', 'A unidade de medida do item digitado (un, m², kg, h…).', 'Define como a quantidade do item é medida no BOM.', 'un', 'Deixar em branco: sem unidade, o custo por unidade fica ambíguo.', 'hub_projetos', 502),
  ('projetos.catalogo.seletor.manual_custo', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Custo unitário (manual)', 'Quanto custa UMA unidade do item digitado (R$).', 'É o custo que entra no cálculo do BOM (quantidade × custo × (1+perda)).', '12,50', 'Informar o custo total em vez do custo de uma unidade.', 'hub_projetos', 503)
ON CONFLICT (chave) DO NOTHING;
