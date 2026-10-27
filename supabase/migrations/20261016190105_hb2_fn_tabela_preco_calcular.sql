-- HB2 (fatia 2): cálculo do preço pela tabela do cliente — o sistema escolhe a faixa pela quantidade e aplica o
-- adicional da condição (percentual da tabela ou preço fixo por condição). Função NOVA, SECURITY INVOKER (a RLS por
-- empresa das tabelas vale), somente leitura. Espelha src/lib/hub/tabelaPreco.ts.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_calcular(
  p_tabela uuid, p_servico_ref text, p_quantidade numeric, p_condicao text DEFAULT 'normal')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_item record; v_pct numeric; v_fixo numeric; v_cod text; v_preco numeric; v_cond text := coalesce(nullif(btrim(p_condicao),''),'normal');
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
  v_preco := CASE WHEN v_fixo IS NOT NULL THEN round(v_fixo, 2)
                  ELSE round(v_item.preco_base * (1 + coalesce(v_pct, 0) / 100), 2) END;
  RETURN jsonb_build_object('ok', true, 'servico_ref', p_servico_ref, 'unidade', v_item.unidade,
    'faixa_de', v_item.faixa_de, 'faixa_ate', v_item.faixa_ate, 'preco_base', v_item.preco_base,
    'condicao', v_cond, 'percentual', v_pct, 'preco_fixo', v_fixo, 'preco_unitario', v_preco,
    'total', round(v_preco * p_quantidade, 2), 'codigo_externo', v_cod);
END $$;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_calcular(uuid,text,numeric,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_calcular(uuid,text,numeric,text) TO authenticated;
