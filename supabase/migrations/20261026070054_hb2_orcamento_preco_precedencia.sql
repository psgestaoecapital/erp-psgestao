-- HB2 · Precedência de preço no item do orçamento (contrato do cliente > tabela por cliente > tabela padrão) · desenvolvedor_6_g (faixa 54).
-- ADITIVA: 2 funções NOVAS de LEITURA (guarda de empresa), 4 "?" NOVOS (RD-95). Nada existente é reescrito.
-- Contrato vigente = tabela ativa do cliente do orçamento cuja vigência cobre a data de hoje.
CREATE OR REPLACE FUNCTION public.fn_orcamento_contrato_servicos(p_orcamento uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid; v_cli uuid; v_tab record; v_out jsonb; v_cond jsonb;
BEGIN
  SELECT company_id, cliente_id INTO v_co, v_cli FROM erp_orcamentos WHERE id = p_orcamento;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', true, 'tabela_id', NULL, 'servicos', '[]'::jsonb); END IF;
  SELECT t.id, t.nome INTO v_tab FROM erp_tabela_preco_cliente t
   WHERE t.company_id = v_co AND t.cliente_id = v_cli AND t.ativo
     AND t.vigencia_inicio <= current_date AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= current_date)
   ORDER BY t.vigencia_inicio DESC LIMIT 1;
  IF v_tab.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'tabela_id', NULL, 'servicos', '[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'servico_ref'), '[]'::jsonb) INTO v_out FROM (
    SELECT DISTINCT ON (i.servico_ref) jsonb_build_object('servico_ref', i.servico_ref, 'nome', i.servico_nome, 'unidade', i.unidade) AS x
      FROM erp_tabela_preco_item i WHERE i.tabela_id = v_tab.id AND NOT i.adicional ORDER BY i.servico_ref, i.faixa_de) s;
  SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb) INTO v_cond FROM (
    SELECT condicao AS c FROM erp_tabela_preco_condicao WHERE tabela_id = v_tab.id
    UNION SELECT condicao FROM erp_tabela_preco_codigo WHERE tabela_id = v_tab.id AND condicao <> 'normal') q;
  RETURN jsonb_build_object('ok', true, 'tabela_id', v_tab.id, 'tabela_nome', v_tab.nome, 'servicos', v_out, 'condicoes', v_cond);
END $$;

-- Preço sugerido para o item: aplica a faixa/condição do contrato vigente do cliente e diz de onde veio.
CREATE OR REPLACE FUNCTION public.fn_orcamento_preco_sugerido(p_orcamento uuid, p_servico_ref text, p_quantidade numeric, p_condicao text DEFAULT 'normal')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_c jsonb; v_calc jsonb;
BEGIN
  v_c := public.fn_orcamento_contrato_servicos(p_orcamento);
  IF v_c->>'tabela_id' IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'origem', 'sem_contrato', 'contrato_vigente', false);
  END IF;
  v_calc := public.fn_tabela_preco_calcular((v_c->>'tabela_id')::uuid, p_servico_ref, p_quantidade, p_condicao);
  IF coalesce((v_calc->>'ok')::boolean, false) THEN
    RETURN v_calc || jsonb_build_object('origem', 'contrato', 'contrato_vigente', true, 'tabela_id', v_c->>'tabela_id', 'tabela_nome', v_c->>'tabela_nome');
  END IF;
  RETURN jsonb_build_object('ok', true, 'origem', 'sem_faixa', 'contrato_vigente', true, 'tabela_id', v_c->>'tabela_id',
    'tabela_nome', v_c->>'tabela_nome', 'erro', v_calc->>'erro');
END $$;

REVOKE ALL ON FUNCTION public.fn_orcamento_contrato_servicos(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_orcamento_preco_sugerido(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_contrato_servicos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_preco_sugerido(uuid, text, numeric, text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Orçamento', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/hub/orcamento-itens', 'hub', 'publicado'
FROM (VALUES
 ('hub.orcamento_itens.servico_contrato', 'Serviço do contrato', 'Escolha o serviço do contrato vigente do cliente deste orçamento.', 'O preço e a faixa saem do contrato, sem digitar; o mesmo número vale na medição.', 'Pintura epóxi', 'Cliente sem contrato vigente: a lista fica vazia e o preço é digitado.', 90),
 ('hub.orcamento_itens.regime_contrato', 'Regime de execução', 'Escolha dia útil, noturno, sábado ou domingo/feriado.', 'Aplica o adicional (% ou valor fixo) que o contrato prevê para o regime.', 'Noturno', 'Regime que não existe no contrato não calcula preço.', 91),
 ('hub.orcamento_itens.usar_preco_contrato', 'Usar preço do contrato', 'Toque para copiar o preço calculado para o campo Preço unitário.', 'Garante que o orçamento use o preço contratado; você ainda pode editar depois.', 'R$ 29,38 por m²', 'Editar o preço depois e esquecer que ele deixou de bater com o contrato.', 92),
 ('hub.orcamento_itens.origem_preco', 'De onde vem o preço', 'Informativo: mostra se o preço veio do contrato, da tabela do cliente ou da tabela padrão.', 'Ordem de prioridade: contrato do cliente, depois tabela por cliente, depois tabela padrão.', 'Contrato do cliente', 'Achar que a tabela padrão vale quando existe contrato vigente.', 93)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
