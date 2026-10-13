-- 🚨 RD-41 · Oficina (KGF/Kleiton) — blindagem RD-55 contra zeragem de preço no orçamento.
-- Causa raiz: fn_oficina_diagnostico_salvar fazia DELETE-tudo + reinsert (perdia preco E aprovado);
-- e fn_oficina_orcamento_registrar gravava preco = NULLIF(...) (payload vazio → NULL → apagava o valor).
-- Correções: (1) diagnóstico faz UPSERT por id (preserva preco/aprovado; nunca deleta item aprovado);
-- (2) registrar nunca zera preço por vazio/null, e não zera item aprovado sem intenção; (3) aprovacao_obter
-- passa a devolver preco (a tela de aprovação/impressão via essa fonte mostrava 0,00).

-- (1) DIAGNÓSTICO · UPSERT por id — NÃO apaga preco/aprovado de item existente (RD-55).
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[];
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

  -- remove só os itens que saíram da lista E que NÃO estão aprovados (RD-55: aprovado nunca some silencioso).
  DELETE FROM erp_os_diagnostico_item
   WHERE os_id = p_os_id AND company_id = p_company_id
     AND NOT (id = ANY(v_ids))
     AND COALESCE(aprovado, false) = false;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n);
END $function$;

-- (2) REGISTRAR · nunca zera preço por vazio/null; e não zera item aprovado sem intenção explícita (zerar).
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_registrar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_it jsonb; v_aprov int := 0; v_total int := 0; v_valor numeric := 0; v_geral text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_valor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    UPDATE erp_os_diagnostico_item
      SET aprovado = COALESCE((v_it->>'aprovado')::boolean, aprovado),
          aprovado_em = now(),
          preco = CASE
            WHEN nullif(v_it->>'preco','')::numeric IS NULL THEN preco            -- vazio/ausente → mantém (RD-55)
            WHEN nullif(v_it->>'preco','')::numeric = 0 AND aprovado IS TRUE
                 AND coalesce((v_it->>'zerar')::boolean, false) = false THEN preco -- 0 em aprovado sem confirmar → mantém
            ELSE nullif(v_it->>'preco','')::numeric                                -- valor explícito (inclui 0 intencional)
          END
      WHERE id = (v_it->>'item_id')::uuid AND os_id = p_os_id AND company_id = p_company_id;
  END LOOP;

  SELECT count(*) FILTER (WHERE aprovado IS TRUE), count(*),
         coalesce(sum(preco) FILTER (WHERE aprovado IS TRUE), 0)
    INTO v_aprov, v_total, v_valor
    FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = p_company_id;

  v_geral := CASE WHEN v_aprov = 0 THEN 'recusado'
                  WHEN v_aprov = v_total THEN 'aprovado' ELSE 'parcial' END;

  INSERT INTO erp_os_aprovacao (company_id, os_id, decisao, aprovador_nome, canal, assinatura,
    observacao, itens_aprovados, itens_total, valor_total, criado_por)
  VALUES (p_company_id, p_os_id, v_geral, nullif(p_dados->>'aprovador_nome',''),
    nullif(p_dados->>'canal',''), nullif(p_dados->>'assinatura',''), nullif(p_dados->>'observacao',''),
    v_aprov, v_total, v_valor, auth.uid());

  RETURN jsonb_build_object('ok', true, 'decisao', v_geral, 'itens_aprovados', v_aprov,
    'itens_total', v_total, 'valor_total', v_valor);
END $function$;

-- (3) APROVAÇÃO_OBTER · passa a devolver preco (fonte usada por aprovação/impressão mostrava 0,00).
CREATE OR REPLACE FUNCTION public.fn_oficina_aprovacao_obter(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca, 'modelo', o.modelo,
             'diagnostico', o.diagnostico)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'quantidade', i.quantidade,
             'preco', i.preco,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade, 'aprovado', i.aprovado)
             ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i WHERE i.os_id = p_os_id AND i.company_id = p_company_id), '[]'::jsonb),
    'ultima_aprovacao', (SELECT jsonb_build_object('decisao', a.decisao, 'aprovador_nome', a.aprovador_nome,
             'canal', a.canal, 'itens_aprovados', a.itens_aprovados, 'itens_total', a.itens_total,
             'created_at', a.created_at)
           FROM erp_os_aprovacao a WHERE a.os_id = p_os_id AND a.company_id = p_company_id
           ORDER BY a.created_at DESC LIMIT 1)
  );
$function$;
