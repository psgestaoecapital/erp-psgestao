-- HB2 · Contrato de preços (fatia 4): arquivar contrato e MEDIÇÃO ao cliente (tela 273). Só funções NOVAS + chaves de ajuda.
-- Guarda de empresa, REVOKE anon por função, sem acesso direto de escrita.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_arquivar(p_tabela uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  UPDATE erp_tabela_preco_cliente SET ativo = false WHERE id = p_tabela;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Medição ao cliente: cada linha {servico_ref, quantidade, condicao} sai pela MESMA regra do contrato (fn_tabela_preco_calcular).
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_medir(p_tabela uuid, p_linhas jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid; l jsonb; c jsonb; v_out jsonb := '[]'; v_tot numeric := 0;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_linhas,'[]')) LOOP
    c := public.fn_tabela_preco_calcular(p_tabela, l->>'servico_ref', coalesce((l->>'quantidade')::numeric,0), coalesce(l->>'condicao','normal'));
    v_out := v_out || jsonb_build_array(c || jsonb_build_object('quantidade', coalesce((l->>'quantidade')::numeric,0)));
    IF (c->>'ok')::boolean THEN v_tot := v_tot + (c->>'total')::numeric; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'linhas', v_out, 'total', round(v_tot, 2));
END $$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_arquivar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_medir(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_arquivar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_medir(uuid, jsonb) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.arquivar', 'Arquivar contrato', 'Use quando o contrato acabou ou foi substituído.', 'Tira da lista sem apagar o histórico.', 'Arquivar o contrato 2025', 'Arquivar o contrato vigente.', 29),
 ('hub.tabela_preco.medicao', 'Medição ao cliente', 'Informe a quantidade medida de cada serviço e o regime em que foi feito.', 'Aplica faixa e regime do contrato e mostra o extrato com os códigos do cliente.', '700 m² de uretano no sábado', 'Medir sem escolher o regime.', 30),
 ('hub.tabela_preco.medicao_qtd', 'Quantidade medida', 'Quantidade executada no período, na unidade do serviço.', 'Define a faixa de preço usada.', '700', 'Somar quantidades de regimes diferentes na mesma linha.', 31)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
