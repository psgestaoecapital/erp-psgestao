-- Oficina · BUG #17: excluir item de diagnóstico não persistia. Vertical Oficina.
--
-- Premissa corrigida (RD-38/RD-51): fn_oficina_diagnostico_salvar JÁ fazia o diff (deletava os
-- itens que saíram da lista), MAS só quando aprovado=false. O item que o Gean tentava excluir era
-- um DUPLICADO já aprovado → o delete pulava → "voltava". O workaround dele (recusar na Aprovação
-- → aprovado=false → aí exclui) confirma a causa raiz.
--
-- Fix: deletar os itens removidos INCLUSIVE aprovados — o que protege de sumiço indevido não é o
-- flag 'aprovado', é a REFERÊNCIA a jusante. Se o item já foi pra cotação (erp_cotacoes_itens
-- .origem_diag_item_id) ou apontamento (erp_os_apontamento.diagnostico_item_id) → NÃO deleta e
-- devolve 'nao_removidos' (a UI avisa, não some silencioso). Se está só no diagnóstico → deleta.

CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[]; v_bloqueados int := 0;
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
    IF v_id IS NOT NULL THEN
      -- item existente: atualiza SÓ os campos do laudo. preco / aprovado / aprovado_em INTOCADOS (RD-55).
      UPDATE erp_os_diagnostico_item SET
        tipo             = coalesce(nullif(v_item->>'tipo',''), tipo),
        servico_id       = nullif(v_item->>'servico_id','')::uuid,
        produto_id       = nullif(v_item->>'produto_id','')::uuid,
        descricao        = btrim(v_item->>'descricao'),
        quantidade       = coalesce(nullif(v_item->>'quantidade','')::numeric, 1),
        tempo_estimado_h = nullif(v_item->>'tempo_estimado_h','')::numeric,
        severidade       = coalesce(nullif(v_item->>'severidade',''), severidade),
        observacao       = nullif(v_item->>'observacao','')
      WHERE id = v_id AND os_id = p_os_id AND company_id = p_company_id;
      IF FOUND THEN v_ids := array_append(v_ids, v_id); ELSE v_id := NULL; END IF;
    END IF;
    IF v_id IS NULL THEN
      -- item novo: entra pendente (preco/aprovado nulos) — precisa de nova aprovação só dele (FIX 3).
      INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
        quantidade, tempo_estimado_h, severidade, observacao, ordem, criado_por)
      VALUES (p_company_id, p_os_id, coalesce(nullif(v_item->>'tipo',''), 'servico'),
        nullif(v_item->>'servico_id','')::uuid, nullif(v_item->>'produto_id','')::uuid, btrim(v_item->>'descricao'),
        coalesce(nullif(v_item->>'quantidade','')::numeric, 1), nullif(v_item->>'tempo_estimado_h','')::numeric,
        coalesce(nullif(v_item->>'severidade',''), 'recomendado'), nullif(v_item->>'observacao',''), v_n, auth.uid())
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
