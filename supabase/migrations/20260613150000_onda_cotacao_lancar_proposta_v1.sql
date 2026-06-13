-- =============================================================
-- ONDA-COTACAO-LANCAR-PROPOSTA-v1 · Parte A
-- =============================================================
-- A1: indice unico (1 proposta por fornecedor+item) — necessario pro upsert
-- A2: fn_cotacao_proposta_salvar — RPC que GRAVA a proposta (passo que faltava)
--     - valida fornecedor/item da mesma cotacao
--     - subtotal = preco * qtd * (1 - desc%)
--     - upsert por (cotacao_fornecedor_id, cotacao_item_id)
--     - recalcula total do fornecedor (so disponiveis)
--     - marca fornecedor como 'respondeu' + data_resposta
--     - move cotacao pra 'em_resposta' (sem rebaixar status final)
-- A3: fn_cotacao_whatsapp_links — FIX quantidade "1.000" => "1"
--     usa to_char(qtd,'FM999999999990.999') + replace('.',',')
--     mantem bullet "•", em-dash "—" e acentos como antes
--
-- Aplicada via MCP em 2026-06-13.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_cot_prop_fornec_item
  ON public.erp_cotacoes_propostas (cotacao_fornecedor_id, cotacao_item_id);

CREATE OR REPLACE FUNCTION public.fn_cotacao_proposta_salvar(
  p_cotacao_fornecedor_id uuid,
  p_cotacao_item_id uuid,
  p_preco_unitario numeric,
  p_desconto_percentual numeric DEFAULT 0,
  p_disponivel boolean DEFAULT true,
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cf record; v_item record;
  v_qtd numeric; v_subtotal numeric;
  v_prop_id uuid; v_fornec_total numeric; v_cot_status text;
BEGIN
  SELECT * INTO v_cf FROM erp_cotacoes_fornecedores WHERE id = p_cotacao_fornecedor_id;
  IF v_cf IS NULL THEN
    RAISE EXCEPTION 'Fornecedor da cotacao nao encontrado';
  END IF;

  SELECT * INTO v_item FROM erp_cotacoes_itens
    WHERE id = p_cotacao_item_id AND cotacao_id = v_cf.cotacao_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Item nao pertence a cotacao deste fornecedor';
  END IF;
  v_qtd := COALESCE(v_item.quantidade, 0);

  v_subtotal := ROUND(COALESCE(p_preco_unitario,0) * v_qtd
                      * (1 - COALESCE(p_desconto_percentual,0)/100.0), 2);

  INSERT INTO erp_cotacoes_propostas (
    cotacao_fornecedor_id, cotacao_item_id, company_id,
    preco_unitario, desconto_percentual, subtotal, disponivel, observacoes,
    created_at, updated_at)
  VALUES (
    p_cotacao_fornecedor_id, p_cotacao_item_id, v_cf.company_id,
    p_preco_unitario, COALESCE(p_desconto_percentual,0), v_subtotal,
    COALESCE(p_disponivel,true), p_observacoes, NOW(), NOW())
  ON CONFLICT (cotacao_fornecedor_id, cotacao_item_id)
  DO UPDATE SET
    preco_unitario     = EXCLUDED.preco_unitario,
    desconto_percentual= EXCLUDED.desconto_percentual,
    subtotal           = EXCLUDED.subtotal,
    disponivel         = EXCLUDED.disponivel,
    observacoes        = EXCLUDED.observacoes,
    updated_at         = NOW()
  RETURNING id INTO v_prop_id;

  SELECT COALESCE(SUM(subtotal),0) INTO v_fornec_total
    FROM erp_cotacoes_propostas
    WHERE cotacao_fornecedor_id = p_cotacao_fornecedor_id AND disponivel = true;

  UPDATE erp_cotacoes_fornecedores
    SET subtotal = v_fornec_total,
        total    = v_fornec_total,
        status   = CASE WHEN status IN ('convidado','visualizou') THEN 'respondeu' ELSE status END,
        data_resposta = COALESCE(data_resposta, NOW()),
        updated_at = NOW()
    WHERE id = p_cotacao_fornecedor_id;

  SELECT status INTO v_cot_status FROM erp_cotacoes WHERE id = v_cf.cotacao_id;
  IF v_cot_status IN ('rascunho','enviada') THEN
    UPDATE erp_cotacoes SET status='em_resposta', updated_at=NOW() WHERE id=v_cf.cotacao_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'proposta_id', v_prop_id,
    'subtotal', v_subtotal, 'fornecedor_total', v_fornec_total, 'quantidade', v_qtd);
END $$;

GRANT EXECUTE ON FUNCTION
  public.fn_cotacao_proposta_salvar(uuid,uuid,numeric,numeric,boolean,text)
  TO authenticated;

-- A3: fn_cotacao_whatsapp_links · fix quantidade
CREATE OR REPLACE FUNCTION public.fn_cotacao_whatsapp_links(p_cotacao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cot record; v_empresa text; v_itens text; v_prazo text; v_msg text;
  v_result jsonb := '[]'::jsonb; v_forn record; v_contato record; v_fone text; v_contatos jsonb;
BEGIN
  SELECT * INTO v_cot FROM erp_cotacoes WHERE id = p_cotacao_id;
  IF v_cot IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cotacao nao encontrada'); END IF;

  SELECT COALESCE(NULLIF(btrim(nome_fantasia),''), razao_social, '') INTO v_empresa
    FROM companies WHERE id = v_cot.company_id;

  SELECT string_agg(E'• '||COALESCE(NULLIF(btrim(produto_nome),''), NULLIF(btrim(produto_descricao),''), 'item')
                    ||E' — '||trim(trailing ',' from replace(to_char(COALESCE(quantidade,0),'FM999999999990.999'),'.',','))
                    ||' '||COALESCE(unidade,'UN'),
                    E'\n' ORDER BY ordem NULLS LAST, id)
    INTO v_itens FROM erp_cotacoes_itens WHERE cotacao_id = p_cotacao_id;
  v_itens := COALESCE(v_itens, '(sem itens)');

  v_prazo := CASE WHEN v_cot.data_limite IS NOT NULL
                  THEN E'\nPrazo para resposta: '||to_char(v_cot.data_limite,'DD/MM/YYYY') ELSE '' END;

  FOR v_forn IN
    SELECT fornecedor_id, fornecedor_nome FROM erp_cotacoes_fornecedores WHERE cotacao_id = p_cotacao_id
  LOOP
    v_contatos := '[]'::jsonb;
    FOR v_contato IN
      SELECT nome, telefone, principal FROM erp_fornecedor_contatos
      WHERE fornecedor_id = v_forn.fornecedor_id AND COALESCE(ativo,true)=true
        AND NULLIF(btrim(telefone),'') IS NOT NULL
      ORDER BY principal DESC, nome
    LOOP
      v_fone := regexp_replace(COALESCE(v_contato.telefone,''), '\D', '', 'g');
      IF v_fone <> '' AND left(v_fone,2) <> '55' AND length(v_fone) <= 11 THEN v_fone := '55'||v_fone; END IF;

      v_msg := E'Olá '||COALESCE(v_contato.nome,'')||E'! Solicitação de cotação'
               ||CASE WHEN COALESCE(v_empresa,'') <> '' THEN ' da '||v_empresa ELSE '' END
               ||E' — '||COALESCE(v_cot.numero,'')
               ||E'.\n\nItens:\n'||v_itens||v_prazo
               ||E'\n\nPode nos enviar preço unitário, prazo de entrega e condições de pagamento? Obrigado!';

      v_contatos := v_contatos || jsonb_build_object(
        'nome', v_contato.nome, 'telefone', v_fone, 'principal', v_contato.principal, 'mensagem', v_msg);
    END LOOP;

    v_result := v_result || jsonb_build_object(
      'fornecedor_id', v_forn.fornecedor_id, 'fornecedor_nome', v_forn.fornecedor_nome,
      'tem_contato', (jsonb_array_length(v_contatos) > 0), 'contatos', v_contatos);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cotacao_id', p_cotacao_id, 'numero', v_cot.numero, 'fornecedores', v_result);
END;
$function$;
