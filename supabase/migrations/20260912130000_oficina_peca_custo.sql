-- ============================================================
-- Oficina Onda 1 · 3.2 (backend do custo) — a peça traz o custo, e o item guarda o snapshot
-- ============================================================
-- A KGF tem 1.731 produtos com custo real (OMIE · preco_custo_medio). Mas fn_oficina_pecas_buscar NÃO
-- devolvia o custo → a peça entrava na OS com custo ZERO e a margem-100%-falsa sobrevivia mesmo com o
-- catálogo. Fix cirúrgico/aditivo (a fn é STABLE, só leitura): acrescenta preco_custo_medio e preco_custo
-- ao retorno. E o item de diagnóstico passa a guardar custo_unitario — SNAPSHOT do custo no momento do
-- lançamento (o custo médio muda com o tempo; o da OS não pode mudar depois). Isso liga a Onda 4 (custo
-- real da peça na OS) sem depender da baixa de estoque.

ALTER TABLE public.erp_os_diagnostico_item
  ADD COLUMN IF NOT EXISTS custo_unitario numeric;

CREATE OR REPLACE FUNCTION public.fn_oficina_pecas_buscar(p_company_id uuid, p_termo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'nome')), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', v.id, 'codigo', v.codigo, 'nome', v.nome, 'marca', v.marca, 'unidade', v.unidade,
      'preco_venda', v.preco_venda, 'estoque_atual', v.estoque_atual, 'status_estoque', v.status_estoque,
      -- #Onda4: custo real da peça, para a margem não nascer 100% falsa
      'preco_custo_medio', v.preco_custo_medio, 'preco_custo', v.preco_custo) AS x
    FROM v_erp_produtos_estoque v
    WHERE v.company_id = p_company_id
      AND coalesce(v.ativo, true) = true
      AND coalesce(v.tipo, '') <> 'servico'
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
      AND (p_termo IS NULL OR btrim(p_termo) = ''
           OR v.nome ILIKE '%' || p_termo || '%'
           OR v.codigo ILIKE '%' || p_termo || '%'
           OR v.codigo_barras ILIKE '%' || p_termo || '%')
    ORDER BY v.nome
    LIMIT 20
  ) q;
$function$;

-- ------------------------------------------------------------
-- E o SNAPSHOT: fn_oficina_diagnostico_salvar passa a gravar custo_unitario.
-- Regra (à prova de adulteração e fiel ao "momento do lançamento"): o custo é
-- lido NO SERVIDOR a partir de v_erp_produtos_estoque (não vem do cliente), e é
-- capturado UMA vez — COALESCE preserva o snapshot já gravado, então re-salvar o
-- laudo não move o custo, e o histórico não muda quando o custo médio muda depois.
-- Item livre (sem produto_id) fica com custo NULL. Nada mais no salvar muda (RD-55).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[]; v_bloqueados int := 0;
        v_prod uuid; v_custo numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  UPDATE erp_os SET
    diagnostico = nullif(btrim(coalesce(p_dados->>'diagnostico','')), ''),
    km = coalesce(nullif(p_dados->>'km','')::int, km),
    updated_at = now()
  WHERE id = p_os_id AND company_id = p_company_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    IF length(btrim(coalesce(v_item->>'descricao',''))) = 0 THEN CONTINUE; END IF;
    v_id := nullif(v_item->>'id','')::uuid;

    -- custo do momento: só p/ peça de catálogo (tem produto_id). Lido no servidor.
    v_prod := nullif(v_item->>'produto_id','')::uuid;
    v_custo := CASE WHEN v_prod IS NOT NULL THEN (
        SELECT coalesce(ve.preco_custo_medio, ve.preco_custo)
        FROM v_erp_produtos_estoque ve
        WHERE ve.id = v_prod AND ve.company_id = p_company_id LIMIT 1
      ) ELSE NULL END;

    IF v_id IS NOT NULL THEN
      -- item existente: atualiza SÓ os campos do laudo. preco / aprovado / aprovado_em INTOCADOS (RD-55).
      -- custo_unitario capturado UMA vez (COALESCE) — snapshot não se move em re-salvar.
      UPDATE erp_os_diagnostico_item SET
        tipo             = coalesce(nullif(v_item->>'tipo',''), tipo),
        servico_id       = nullif(v_item->>'servico_id','')::uuid,
        produto_id       = v_prod,
        descricao        = btrim(v_item->>'descricao'),
        quantidade       = coalesce(nullif(v_item->>'quantidade','')::numeric, 1),
        tempo_estimado_h = nullif(v_item->>'tempo_estimado_h','')::numeric,
        severidade       = coalesce(nullif(v_item->>'severidade',''), severidade),
        observacao       = nullif(v_item->>'observacao',''),
        custo_unitario   = COALESCE(custo_unitario, v_custo)
      WHERE id = v_id AND os_id = p_os_id AND company_id = p_company_id;
      IF FOUND THEN v_ids := array_append(v_ids, v_id); ELSE v_id := NULL; END IF;
    END IF;
    IF v_id IS NULL THEN
      -- item novo: entra pendente (preco/aprovado nulos) — precisa de nova aprovação só dele (FIX 3).
      INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
        quantidade, tempo_estimado_h, severidade, observacao, custo_unitario, ordem, criado_por)
      VALUES (p_company_id, p_os_id, coalesce(nullif(v_item->>'tipo',''), 'servico'),
        nullif(v_item->>'servico_id','')::uuid, v_prod, btrim(v_item->>'descricao'),
        coalesce(nullif(v_item->>'quantidade','')::numeric, 1), nullif(v_item->>'tempo_estimado_h','')::numeric,
        coalesce(nullif(v_item->>'severidade',''), 'recomendado'), nullif(v_item->>'observacao',''), v_custo, v_n, auth.uid())
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- Itens removidos da lista que JÁ foram pra cotação/apontamento: não deletar, contar p/ avisar.
  SELECT count(*) INTO v_bloqueados
  FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
       OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  -- Deleta os removidos que NÃO têm referência a jusante (inclusive aprovados — é só laudo).
  DELETE FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
           OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n, 'nao_removidos', v_bloqueados);
END $function$;
