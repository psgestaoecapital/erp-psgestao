-- Auditoria 24/10 (/tabelas-preco): (a) condição inexistente não pode devolver ok:true a preço base;
-- (b) arredondar só no TOTAL (unitário exato × quantidade), não o unitário antes de multiplicar.
-- Função existente: definição viva lida com pg_get_functiondef antes de reescrever. Mesma assinatura e mesmos campos de retorno.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_calcular(p_tabela uuid, p_servico_ref text, p_quantidade numeric, p_condicao text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record; v_pct numeric; v_fixo numeric; v_cod text; v_exato numeric; v_preco numeric;
  v_cond text := coalesce(nullif(btrim(p_condicao),''),'normal');
BEGIN
  IF p_quantidade IS NULL OR p_quantidade < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'quantidade inválida');
  END IF;
  SELECT i.* INTO v_item FROM erp_tabela_preco_item i
   WHERE i.tabela_id = p_tabela AND i.servico_ref = p_servico_ref AND NOT i.adicional
     AND p_quantidade >= i.faixa_de AND (i.faixa_ate IS NULL OR p_quantidade < i.faixa_ate)
   ORDER BY i.faixa_de LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'serviço sem faixa para a quantidade ou tabela não encontrada');
  END IF;
  SELECT c.percentual INTO v_pct FROM erp_tabela_preco_condicao c WHERE c.tabela_id = p_tabela AND c.condicao = v_cond;
  SELECT k.preco_fixo, k.codigo_externo INTO v_fixo, v_cod FROM erp_tabela_preco_codigo k
   WHERE k.tabela_id = p_tabela AND k.servico_ref = p_servico_ref AND k.condicao = v_cond;
  -- (a) 'normal' é o preço base; qualquer outra condição precisa existir na tabela (percentual ou código/preço fixo)
  IF v_cond <> 'normal' AND v_pct IS NULL AND v_fixo IS NULL AND v_cod IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'condição "' || v_cond || '" não existe nesta tabela de preço');
  END IF;
  v_exato := CASE WHEN v_fixo IS NOT NULL THEN v_fixo ELSE v_item.preco_base * (1 + coalesce(v_pct, 0) / 100) END;
  v_preco := round(v_exato, 2);
  RETURN jsonb_build_object('ok', true, 'servico_ref', p_servico_ref, 'unidade', v_item.unidade,
    'faixa_de', v_item.faixa_de, 'faixa_ate', v_item.faixa_ate, 'preco_base', v_item.preco_base,
    'condicao', v_cond, 'percentual', v_pct, 'preco_fixo', v_fixo, 'preco_unitario', v_preco,
    'total', round(v_exato * p_quantidade, 2), 'codigo_externo', v_cod);
END $function$;

-- (b) regra documentada no "?" da quantidade (RD-95)
UPDATE public.erp_ajuda_campo
   SET para_que_serve = coalesce(para_que_serve,'') || ' Arredondamento: o preço unitário aparece com 2 casas, mas o total é calculado com o unitário exato e arredondado só no final (ex.: 250 ml noturno = 7.343,75, não 7.345,00).'
 WHERE chave = 'hub.tabela_preco.quantidade'
   AND coalesce(para_que_serve,'') NOT LIKE '%Arredondamento:%';
