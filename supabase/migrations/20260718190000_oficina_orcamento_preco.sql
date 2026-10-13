-- OFICINA LOTE 3.1 · ORÇAMENTO OPERACIONAL (preço na Aprovação). Fronteira recalibrada pelo CEO:
-- preço/orçamento É operacional (o tempário já precifica DENTRO da Oficina). Pode mostrar valor,
-- total, aprovar item a item, trilha de quem aprovou/quando. 🚫 PROIBIDO: gerar título, baixa de
-- estoque, tela financeira. Faturamento (#696) segue pausado = fronteira com a GE.
-- RD-26: reusa fn_oficina_custo_hora / fn_oficina_preco_peca. Aditivo puro (colunas novas + RPCs).

-- 1 · colunas aditivas: preço acordado por item + valor total na trilha de aprovação.
ALTER TABLE public.erp_os_diagnostico_item ADD COLUMN IF NOT EXISTS preco numeric;   -- total da linha (editável)
ALTER TABLE public.erp_os_aprovacao ADD COLUMN IF NOT EXISTS valor_total numeric;      -- soma dos aprovados

-- 2 · precificar: sugere valor por item (mão de obra pelo custo-hora × tempo × margem; peça pelo
--     preço do produto). NÃO grava — só sugere p/ a tela. SECURITY INVOKER (respeita RLS/precificação).
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_precificar(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_ch jsonb; v_custo_hora numeric; v_margem numeric; v_item record; v_itens jsonb := '[]'::jsonb;
        v_sug numeric; v_pp jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := coalesce((v_ch->>'custo_hora')::numeric, 0);
  v_margem := coalesce((v_ch->>'margem_mao_obra_pct')::numeric, 0);

  FOR v_item IN
    SELECT i.id, i.tipo, i.descricao, i.servico_id, i.produto_id, i.quantidade,
           i.tempo_estimado_h, i.severidade, i.aprovado, i.preco
      FROM erp_os_diagnostico_item i
      WHERE i.os_id = p_os_id AND i.company_id = p_company_id
      ORDER BY i.ordem, i.created_at
  LOOP
    v_sug := NULL;
    IF v_item.tipo = 'peca' AND v_item.produto_id IS NOT NULL THEN
      v_pp := public.fn_oficina_preco_peca(v_item.produto_id, p_company_id, coalesce(v_item.quantidade,1));
      IF coalesce((v_pp->>'ok')::boolean,false) THEN v_sug := (v_pp->>'preco')::numeric; END IF;
    ELSIF v_item.tipo = 'servico' AND v_item.tempo_estimado_h IS NOT NULL AND v_custo_hora > 0 THEN
      -- mão de obra: custo (tempo × custo-hora) + markup da margem-alvo
      v_sug := round(v_item.tempo_estimado_h * v_custo_hora * (1 + v_margem/100.0), 2);
    END IF;
    v_itens := v_itens || jsonb_build_object(
      'item_id', v_item.id, 'tipo', v_item.tipo, 'descricao', v_item.descricao,
      'servico_id', v_item.servico_id, 'produto_id', v_item.produto_id,
      'quantidade', v_item.quantidade, 'tempo_estimado_h', v_item.tempo_estimado_h,
      'severidade', v_item.severidade, 'aprovado', v_item.aprovado,
      'preco', v_item.preco, 'preco_sugerido', v_sug);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'custo_hora', v_custo_hora, 'margem_mao_obra_pct', v_margem,
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'cliente_telefone', NULL, 'placa', o.placa,
             'marca', o.marca, 'modelo', o.modelo, 'diagnostico', o.diagnostico)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id),
    'itens', v_itens);
END $$;

-- 3 · registrar orçamento/aprovação: grava preço por item + decisão + trilha c/ valor_total. Atômico.
--     🚫 NÃO gera título, NÃO baixa estoque, NÃO muda status da OS.
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_registrar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_it jsonb; v_aprov int := 0; v_total int := 0; v_valor numeric := 0; v_geral text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    UPDATE erp_os_diagnostico_item
      SET aprovado = (v_it->>'aprovado')::boolean, aprovado_em = now(),
          preco = nullif(v_it->>'preco','')::numeric
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
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_precificar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_registrar(uuid, uuid, jsonb) TO authenticated;
