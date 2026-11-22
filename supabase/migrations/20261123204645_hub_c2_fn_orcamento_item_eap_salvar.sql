-- Onda C-2 · slice 3 (Hub · tela 315) — ESCRITA do item do orçamento pela EAP
--
-- Contexto (RD-38): os slices 1 (tabela projetos_orcamento_item_eap) e 2 (leitura
-- fn_projetos_orcamento_eap_arvore) já estão na main, mas NÃO havia RPC de escrita —
-- 0 itens EAP existiam em lugar nenhum, então a tela 315 era inconstruível/improvável.
-- Esta função é a peça que faltava: grava um item do orçamento estruturado pela EAP.
--
-- Modelo (CEO 21/11): o item é SERVIÇO × LOCAL, com material e mão de obra separados.
--   * O serviço vem do catálogo da empresa (projetos_servicos) — a tabela compartilhada
--     erp_orcamentos_itens tem o CHECK chk_orc_item_ref_compativel que EXIGE servico_id
--     quando tipo_item='servico'; por isso o item EAP liga a um serviço do catálogo.
--   * O LOCAL é dimensão do item (não nível da EAP) e vai no complemento 1:1
--     projetos_orcamento_item_eap (slice 1).
--   * quantidade, custo de material e custo de mão de obra por unidade ficam no
--     complemento; o item compartilhado guarda subtotal = qtd × (material + mão de obra),
--     que o trigger existente recalc_orcamento_total soma para o total do orçamento.
--
-- RD-26: REUSA as tabelas compartilhadas (erp_orcamentos_itens) e o catálogo
--   (projetos_servicos) — não recria nem acrescenta coluna do Hub na tabela compartilhada.
-- Segurança: SECURITY DEFINER com GUARDA EXPLÍCITA de empresa (get_user_company_ids),
--   espelhando fn_projetos_orcamento_eap_arvore (já na main). REVOKE anon/public;
--   GRANT só a authenticated. Idempotente (CREATE OR REPLACE de função NOVA).
-- RD-94.1: aditiva (função nova); escreve em tabela compartilhada => PR sensível
--   (revisao-eng-chefe).
--
-- Prova RD-38 (BEGIN/ROLLBACK, orçamento 4dbd137b, serviço GESSO-FORRO-ARAMADO cm=43,50
--   cmo=36,80, qtd=12): item inserido tipo_item='servico' + complemento satisfez TODOS os
--   CHECK/FK; recalc_orcamento_total atualizou erp_orcamentos.total = 963,60 = 12×(43,50+36,80)
--   = soma da árvore EAP. Rolled back.

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  p_orcamento_id        uuid,
  p_servico_id          uuid,                 -- serviço do catálogo da empresa (projetos_servicos)
  p_quantidade          numeric,
  p_local_tipo          text    DEFAULT NULL, -- FK projetos_local_tipo (pavimento, zona, unidade…)
  p_local_nome          text    DEFAULT NULL,
  p_eap_codigo          text    DEFAULT NULL, -- override; default = eap_codigo do serviço
  p_custo_material_unit numeric DEFAULT NULL, -- override; default = custo_material do serviço
  p_custo_mao_obra_unit numeric DEFAULT NULL, -- override; default = custo_mao_obra do serviço
  p_item_id             uuid    DEFAULT NULL  -- quando edita um item já existente do orçamento
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company   uuid;
  v_servico   record;
  v_eap       text;
  v_mat       numeric;
  v_mo        numeric;
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
  v_mat := COALESCE(p_custo_material_unit, v_servico.custo_material);
  v_mo  := COALESCE(p_custo_mao_obra_unit, v_servico.custo_mao_obra);
  v_qtd := COALESCE(p_quantidade, 0);
  IF v_qtd < 0 OR v_mat < 0 OR v_mo < 0 THEN
    RAISE EXCEPTION 'quantidade e custos não podem ser negativos' USING ERRCODE = '22023';
  END IF;
  v_unit := v_mat + v_mo;

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
     quantidade, custo_material_unit, custo_mao_obra_unit, origem)
  VALUES
    (v_item_id, v_company, v_eap, v_servico.ref_padrao_codigo,
     NULLIF(btrim(p_local_tipo), ''), NULLIF(btrim(p_local_nome), ''),
     v_qtd, v_mat, v_mo, 'empresa')
  ON CONFLICT (orcamento_item_id) DO UPDATE
    SET eap_codigo          = EXCLUDED.eap_codigo,
        ref_padrao_codigo   = EXCLUDED.ref_padrao_codigo,
        local_tipo          = EXCLUDED.local_tipo,
        local_nome          = EXCLUDED.local_nome,
        quantidade          = EXCLUDED.quantidade,
        custo_material_unit = EXCLUDED.custo_material_unit,
        custo_mao_obra_unit = EXCLUDED.custo_mao_obra_unit,
        atualizado_em       = now();

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', v_item_id,
    'eap_codigo', v_eap,
    'subtotal', round(v_qtd * v_unit, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(uuid, uuid, numeric, text, text, text, numeric, numeric, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(uuid, uuid, numeric, text, text, text, numeric, numeric, uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(uuid, uuid, numeric, text, text, text, numeric, numeric, uuid) IS
  'Hub C-2 · grava item do orçamento pela EAP (serviço do catálogo × local, material×MO). Insere/edita erp_orcamentos_itens (tipo servico) + complemento projetos_orcamento_item_eap. Guarda de empresa. Onda C-2 slice 3.';
