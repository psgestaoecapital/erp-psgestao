-- #132 (Mecânica Diesel Triches) · Aprovação do Cliente somava o preço UNITÁRIO sem multiplicar pela quantidade:
-- "óleo motor" 28 × R$ 28,00 aparecia como R$ 28,00 e o "Total aprovado" fechava em R$ 118,00 em vez de R$ 874,00.
--
-- Contrato (o que o resto do sistema já usa): erp_os_diagnostico_item.preco = PREÇO UNITÁRIO.
-- Total da OS, NF-e, NFS-e, impressão, aprovação pública e diagnóstico multiplicam preco × quantidade.
-- Três pontos quebravam esse contrato:
--   1) fn_oficina_orcamento_registrar gravava erp_os_aprovacao.valor_total = sum(preco) (sem × quantidade);
--   2) fn_oficina_orcamento_precificar devolvia preco_sugerido = preço da LINHA (fn_oficina_preco_peca já
--      multiplica pela qtd) → "usar sugerido" gravava a linha no campo unitário (cobrança em dobro);
--   3) fn_os_cotacao_aplicar_precos gravava o valor da LINHA em preco (idem).
-- Sem mexer em dado de cliente (RD-55): só as funções. Os 3 itens reais já precificados por cotação com qtd > 1
-- estão listados para o CEO (diagnóstico), não alterados.

-- 1) registrar: total aprovado = Σ preco × quantidade
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

  -- #132: preco é UNITÁRIO → valor da linha = preco × quantidade
  SELECT count(*) FILTER (WHERE aprovado IS TRUE), count(*),
         coalesce(sum(round(coalesce(preco,0) * coalesce(quantidade,1), 2)) FILTER (WHERE aprovado IS TRUE), 0)
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

-- 2) precificar: preco_sugerido UNITÁRIO para peça (fn_oficina_preco_peca devolve o total da qtd)
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_precificar(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_ch jsonb; v_custo_hora numeric; v_margem numeric; v_item record; v_itens jsonb := '[]'::jsonb;
        v_sug numeric; v_pp jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_valor');
  END IF;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := coalesce((v_ch->>'custo_hora')::numeric, 0);
  v_margem := coalesce((v_ch->>'margem_mao_obra_pct')::numeric, 0);

  FOR v_item IN
    SELECT i.id, i.tipo, i.descricao, i.servico_id, i.produto_id, i.quantidade,
           i.tempo_estimado_h, i.severidade, i.aprovado, i.preco, i.custo_unitario
      FROM erp_os_diagnostico_item i
      WHERE i.os_id = p_os_id AND i.company_id = p_company_id
      ORDER BY i.ordem, i.created_at
  LOOP
    v_sug := NULL;
    IF v_item.tipo = 'peca' AND v_item.produto_id IS NOT NULL THEN
      v_pp := public.fn_oficina_preco_peca(v_item.produto_id, p_company_id, coalesce(v_item.quantidade,1));
      IF coalesce((v_pp->>'ok')::boolean,false) THEN
        -- #132: fn_oficina_preco_peca devolve o preço da QUANTIDADE toda; o campo é unitário.
        v_sug := round((v_pp->>'preco')::numeric / coalesce(nullif(v_item.quantidade, 0), 1), 2);
      END IF;
    ELSIF v_item.tipo = 'servico' AND v_item.tempo_estimado_h IS NOT NULL AND v_custo_hora > 0 THEN
      v_sug := round(v_item.tempo_estimado_h * v_custo_hora * (1 + v_margem/100.0), 2);
    END IF;
    v_itens := v_itens || jsonb_build_object(
      'item_id', v_item.id, 'tipo', v_item.tipo, 'descricao', v_item.descricao,
      'servico_id', v_item.servico_id, 'produto_id', v_item.produto_id,
      'quantidade', v_item.quantidade, 'tempo_estimado_h', v_item.tempo_estimado_h,
      'severidade', v_item.severidade, 'aprovado', v_item.aprovado,
      'preco', v_item.preco, 'preco_sugerido', v_sug,
      'custo_unitario', v_item.custo_unitario);   -- Onda 4B · custo informado (p/ pré-preencher o campo)
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'custo_hora', v_custo_hora, 'margem_mao_obra_pct', v_margem,
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'cliente_telefone', NULL, 'placa', o.placa,
             'marca', o.marca, 'modelo', o.modelo, 'diagnostico', o.diagnostico)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id),
    'itens', v_itens);
END $function$;

-- 3) cotação → preço do diagnóstico: grava o UNITÁRIO de venda (não a linha)
CREATE OR REPLACE FUNCTION public.fn_os_cotacao_aplicar_precos(p_cotacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot RECORD; v_cf_id uuid; v_n int := 0;
  v_it RECORD; v_custo_unit numeric; v_unit_venda numeric;
BEGIN
  SELECT * INTO v_cot FROM public.erp_cotacoes WHERE id = p_cotacao_id;
  IF NOT FOUND OR v_cot.os_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_os'); END IF;

  SELECT id INTO v_cf_id FROM public.erp_cotacoes_fornecedores
   WHERE cotacao_id = p_cotacao_id AND fornecedor_id = v_cot.fornecedor_vencedor_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_cf_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vencedor'); END IF;

  FOR v_it IN
    SELECT ci.origem_diag_item_id, ci.quantidade, cp.preco_unitario, cp.subtotal
    FROM public.erp_cotacoes_itens ci
    JOIN public.erp_cotacoes_propostas cp
      ON cp.cotacao_item_id = ci.id AND cp.cotacao_fornecedor_id = v_cf_id AND COALESCE(cp.disponivel, true) = true
    WHERE ci.cotacao_id = p_cotacao_id AND ci.origem_diag_item_id IS NOT NULL
  LOOP
    -- custo unitário efetivo (já com desconto da proposta): subtotal/qtd, fallback preco_unitario
    v_custo_unit := COALESCE(NULLIF(v_it.subtotal, 0) / NULLIF(v_it.quantidade, 0), v_it.preco_unitario);
    v_unit_venda := public.fn_oficina_markup_aplicar(v_custo_unit, v_cot.company_id);
    IF v_unit_venda IS NULL THEN CONTINUE; END IF;
    -- #132: diag.preco = UNITÁRIO (total da OS/NF multiplicam pela quantidade). Antes gravava a linha → 2×.
    UPDATE public.erp_os_diagnostico_item
       SET preco = round(v_unit_venda, 2)
     WHERE id = v_it.origem_diag_item_id AND os_id = v_cot.os_id AND company_id = v_cot.company_id;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;

  UPDATE public.erp_os
     SET status = 'aguardando_aprovacao', updated_at = now()
   WHERE id = v_cot.os_id AND company_id = v_cot.company_id
     AND status IN ('aberta', 'aguardando_peca');   -- só a partir da fase pré-execução; não regride OS avançada

  RETURN jsonb_build_object('sucesso', true, 'itens_precificados', v_n, 'os_id', v_cot.os_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_orcamento_registrar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_registrar(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_oficina_orcamento_precificar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_precificar(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_os_cotacao_aplicar_precos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_cotacao_aplicar_precos(uuid) TO authenticated, service_role;
