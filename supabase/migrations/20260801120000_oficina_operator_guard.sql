-- RD-41 · Oficina — papel Auxiliar (CLIENT_OPERATOR) com execução restrita.
-- Pilar 2: defesa no BACKEND (não só ocultação na tela). RPCs de valor não
-- devolvem R$ ao OPERATOR; RLS por empresa mantida. Reusa o RBAC existente
-- (tenant_user_roles via fn_acesso_efetivo). FRONTEIRA GE preservada: nada de
-- cálculo/tabela de valor novo — só bloqueio de retorno.

-- Helper: papel de gestão do chamador nesta empresa (CLIENT_OWNER/MANAGER/OPERATOR/VIEWER).
CREATE OR REPLACE FUNCTION public.fn_oficina_papel(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.fn_acesso_efetivo(auth.uid(), p_company_id) ->> 'papel_gestao'
$function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_papel(uuid) TO authenticated;

-- Status 'trocada' (aditivo) — o Auxiliar marca a peça como fisicamente trocada.
ALTER TABLE public.erp_os_peca_solicitacao DROP CONSTRAINT IF EXISTS erp_os_peca_solicitacao_status_check;
ALTER TABLE public.erp_os_peca_solicitacao ADD CONSTRAINT erp_os_peca_solicitacao_status_check
  CHECK (status = ANY (ARRAY['solicitado','aprovado','comprado','recusado','trocada']));

-- Marcar peça trocada (ação de execução do Auxiliar). Não colide com o fluxo de
-- compra do fn_oficina_peca_decidir (que segue só aprovado/comprado/recusado).
CREATE OR REPLACE FUNCTION public.fn_oficina_peca_marcar_trocada(p_company_id uuid, p_solicitacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  UPDATE erp_os_peca_solicitacao SET status='trocada'
   WHERE id=p_solicitacao_id AND company_id=p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Solicitação não encontrada.'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'trocada');
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_peca_marcar_trocada(uuid,uuid) TO authenticated;

-- Guard de valor: OPERATOR não recebe R$ da precificação (defesa no backend).
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_precificar(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_ch jsonb; v_custo_hora numeric; v_margem numeric; v_item record; v_itens jsonb := '[]'::jsonb;
        v_sug numeric; v_pp jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  -- Pilar 2: Auxiliar (OPERATOR) nunca vê valor.
  IF public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_valor');
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
END $function$;

-- Guard de valor: OPERATOR não registra orçamento (grava aprovação + valor_total).
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_registrar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_it jsonb; v_aprov int := 0; v_total int := 0; v_valor numeric := 0; v_geral text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  -- Pilar 2: Auxiliar (OPERATOR) não mexe em valor/aprovação.
  IF public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_valor');
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
END $function$;

-- Guard de valor: OPERATOR recebe a lista de peças SEM preco_venda (o resto igual).
CREATE OR REPLACE FUNCTION public.fn_oficina_peca_solicitacoes_listar(p_company_id uuid, p_os_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, os_id uuid, os_numero text, produto_id uuid, descricao text, quantidade numeric, foto_path text, observacao text, status text, solicitado_por_nome text, solicitado_em timestamp with time zone, preco_venda numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_oculta_valor boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  v_oculta_valor := public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR';
  RETURN QUERY
  SELECT s.id, s.os_id, (SELECT o.numero::text FROM erp_os o WHERE o.id=s.os_id), s.produto_id, s.descricao, s.quantidade,
         s.foto_path, s.observacao, s.status, s.solicitado_por_nome, s.solicitado_em,
         CASE WHEN v_oculta_valor THEN NULL
              ELSE (SELECT pr.preco_venda FROM erp_produtos pr WHERE pr.id=s.produto_id) END AS preco_venda
  FROM erp_os_peca_solicitacao s
  WHERE s.company_id=p_company_id AND (p_os_id IS NULL OR s.os_id=p_os_id)
  ORDER BY (s.status='solicitado') DESC, s.solicitado_em DESC;
END $function$;
