-- ============================================================
-- Onda 4B (backend) · registrar custo_unitario da peça na aprovação
-- ============================================================
-- Para a margem virar verdade (4A), o oficina precisa INFORMAR o custo da peça. O lugar natural é a
-- aprovação (tela COM valor, já edita preço por item). Esta migration ensina fn_oficina_orcamento_registrar
-- a persistir p_dados.itens[].custo em erp_os_diagnostico_item.custo_unitario.
--
-- RD-55 (mesma regra do preço): custo vazio/ausente → MANTÉM o custo atual (nunca zera); custo preenchido
-- → grava (inclui 0 intencional). Assinatura inalterada (p_company_id, p_os_id, p_dados) → sem overload.
-- Só o custo_unitario é novo; todo o resto (aprovado, preço, assinatura, trilha) fica idêntico.

CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_registrar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
          END,
          custo_unitario = CASE
            WHEN nullif(v_it->>'custo','')::numeric IS NULL THEN custo_unitario    -- vazio/ausente → mantém (RD-55)
            ELSE nullif(v_it->>'custo','')::numeric                                -- custo informado (inclui 0 intencional)
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
