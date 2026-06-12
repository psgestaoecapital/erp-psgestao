-- =============================================================
-- FIX-FORNECEDOR-CONTATO-SAVE-MSG-KGF-v1 · Parte B
-- =============================================================
-- fn_cotacao_whatsapp_links v2 · agora resolve nome_fantasia (ou
-- razao_social) da empresa solicitante e injeta na mensagem:
--   "Solicitação de cotação da KGF AutoCenter — COT-2026-0042"
--
-- Resto da RPC inalterado (itens + prazo + normalizacao 55 + perguntas).
--
-- Aplicada via MCP em 2026-06-12.
-- =============================================================

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

  SELECT string_agg('• '||COALESCE(NULLIF(btrim(produto_nome),''), NULLIF(btrim(produto_descricao),''), 'item')
                    ||' — '||COALESCE(quantidade,0)::text||' '||COALESCE(unidade,'UN'),
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

      v_msg := 'Olá '||COALESCE(v_contato.nome,'')||'! Solicitação de cotação'
               ||CASE WHEN COALESCE(v_empresa,'') <> '' THEN ' da '||v_empresa ELSE '' END
               ||' — '||COALESCE(v_cot.numero,'')
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
