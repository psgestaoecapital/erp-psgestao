-- Chamado #135 (Triches) · item 3: a exclusão de item na edição da OS centralizada
-- precisa ficar REGISTRADA no histórico da OS, com quem excluiu e qual item.
--
-- Antes: fn_oficina_diagnostico_salvar deletava os itens removidos sem deixar rastro
-- (nenhum INSERT em audit_log_global na exclusão). Depois: cada item efetivamente
-- excluído gera uma linha em audit_log_global (acao = 'EXCLUIU_ITEM'), com user_id/
-- user_email de quem excluiu e o item em valor_anterior — mesmo padrão de fn_os_salvar.
--
-- Aditiva: só acrescenta o registro de auditoria ANTES do DELETE já existente; a regra
-- de exclusão (não deleta item que já foi para cotação/apontamento) permanece idêntica.
-- Nenhum dado de cliente é alterado — audit_log_global é log.

CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[]; v_bloqueados int := 0;
        v_prod uuid; v_custo numeric; v_pode_preco boolean; v_preco numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  -- #135 · atendimento centralizado: o Diagnóstico já recebe o preço (só p/ quem pode ver/lançar valor)
  v_pode_preco := COALESCE((public.fn_oficina_modelo_atendimento(p_company_id)->>'pode_preco')::boolean, false);

  UPDATE erp_os SET
    diagnostico = nullif(btrim(coalesce(p_dados->>'diagnostico','')), ''),
    km = coalesce(nullif(p_dados->>'km','')::int, km),
    updated_at = now()
  WHERE id = p_os_id AND company_id = p_company_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    IF length(btrim(coalesce(v_item->>'descricao',''))) = 0 THEN CONTINUE; END IF;
    v_id := nullif(v_item->>'id','')::uuid;
    v_preco := CASE WHEN v_pode_preco THEN nullif(v_item->>'preco','')::numeric ELSE NULL END;

    -- custo do momento: só p/ peça de catálogo (tem produto_id). Lido no servidor.
    v_prod := nullif(v_item->>'produto_id','')::uuid;
    v_custo := CASE WHEN v_prod IS NOT NULL THEN (
        SELECT coalesce(ve.preco_custo_medio, ve.preco_custo)
        FROM v_erp_produtos_estoque ve
        WHERE ve.id = v_prod AND ve.company_id = p_company_id LIMIT 1
      ) ELSE NULL END;

    IF v_id IS NOT NULL THEN
      -- item existente: atualiza SÓ os campos do laudo. aprovado / aprovado_em INTOCADOS (RD-55).
      -- preco: intocado, exceto no atendimento centralizado (#135) em item ainda não aprovado com preço informado.
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
        custo_unitario   = COALESCE(custo_unitario, v_custo),
        preco            = CASE WHEN v_preco IS NOT NULL AND aprovado IS DISTINCT FROM true THEN v_preco ELSE preco END
      WHERE id = v_id AND os_id = p_os_id AND company_id = p_company_id;
      IF FOUND THEN v_ids := array_append(v_ids, v_id); ELSE v_id := NULL; END IF;
    END IF;
    IF v_id IS NULL THEN
      -- item novo: entra pendente (aprovado nulo) — precisa de nova aprovação só dele (FIX 3).
      -- preco nulo, exceto no atendimento centralizado (#135), onde já vem do Diagnóstico.
      INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
        quantidade, tempo_estimado_h, severidade, observacao, custo_unitario, ordem, criado_por, preco)
      VALUES (p_company_id, p_os_id, coalesce(nullif(v_item->>'tipo',''), 'servico'),
        nullif(v_item->>'servico_id','')::uuid, v_prod, btrim(v_item->>'descricao'),
        coalesce(nullif(v_item->>'quantidade','')::numeric, 1), nullif(v_item->>'tempo_estimado_h','')::numeric,
        coalesce(nullif(v_item->>'severidade',''), 'recomendado'), nullif(v_item->>'observacao',''), v_custo, v_n, auth.uid(), v_preco)
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

  -- #135 · histórico da OS: registra a exclusão de cada item que SERÁ removido (quem + qual item),
  -- mesma condição do DELETE abaixo. Best-effort (não bloqueia o salvamento se o log falhar),
  -- igual ao audit de fn_os_salvar.
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    SELECT p_company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
           'erp_os_diagnostico_item', d.id::text, 'EXCLUIU_ITEM',
           jsonb_build_object('os_id', p_os_id, 'tipo', d.tipo, 'descricao', d.descricao,
                              'quantidade', d.quantidade, 'preco', d.preco,
                              'produto_id', d.produto_id, 'servico_id', d.servico_id),
           NULL
    FROM erp_os_diagnostico_item d
    WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
      AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
             OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Deleta os removidos que NÃO têm referência a jusante (inclusive aprovados — é só laudo).
  DELETE FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
           OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n, 'nao_removidos', v_bloqueados);
END $function$;

-- Segurança (RD-52): função SECURITY DEFINER acessível só a quem já usava; anon nunca.
REVOKE ALL ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
