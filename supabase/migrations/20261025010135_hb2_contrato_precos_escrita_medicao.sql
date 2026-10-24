-- HB2 · Contrato de preços do cliente (fatia 3): ESCRITA por RPC (salvar/editar/arquivar) e MEDIÇÃO ao cliente (tela 273).
-- Só funções NOVAS + chaves de ajuda; tabelas existentes não mudam. Guarda de empresa, REVOKE anon, sem acesso direto de escrita.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_salvar(p_company uuid, p_tabela uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_id uuid := p_tabela; v_nome text := btrim(coalesce(p_dados->>'nome',''));
  v_ini date := coalesce(nullif(p_dados->>'vigencia_inicio','')::date, current_date);
  v_fim date := nullif(p_dados->>'vigencia_fim','')::date;
  r jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company);
  IF length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o nome do contrato'; END IF;
  IF v_fim IS NOT NULL AND v_fim < v_ini THEN RAISE EXCEPTION 'A vigência termina antes de começar'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_tabela_preco_cliente (company_id, nome, vigencia_inicio, vigencia_fim, cliente_id)
    VALUES (p_company, v_nome, v_ini, v_fim, nullif(p_dados->>'cliente_id','')::uuid) RETURNING id INTO v_id;
  ELSE
    UPDATE erp_tabela_preco_cliente SET nome = v_nome, vigencia_inicio = v_ini, vigencia_fim = v_fim, ativo = true
     WHERE id = v_id AND company_id = p_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
    DELETE FROM erp_tabela_preco_codigo WHERE tabela_id = v_id;
    DELETE FROM erp_tabela_preco_condicao WHERE tabela_id = v_id;
    DELETE FROM erp_tabela_preco_item WHERE tabela_id = v_id;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'condicoes','[]')) LOOP
    INSERT INTO erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual)
    VALUES (p_company, v_id, btrim(r->>'condicao'), nullif(r->>'percentual','')::numeric);
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens','[]')) LOOP
    INSERT INTO erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base)
    VALUES (p_company, v_id, btrim(r->>'servico_ref'), btrim(r->>'servico_nome'), coalesce(nullif(btrim(r->>'unidade'),''),'m²'),
      coalesce(nullif(r->>'faixa_de','')::numeric, 0), nullif(r->>'faixa_ate','')::numeric, (r->>'preco_base')::numeric);
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'codigos','[]')) LOOP
    CONTINUE WHEN btrim(coalesce(r->>'codigo_externo','')) = '';
    INSERT INTO erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo, preco_fixo)
    VALUES (p_company, v_id, btrim(r->>'servico_ref'), coalesce(nullif(btrim(r->>'condicao'),''),'normal'),
      btrim(r->>'codigo_externo'), nullif(r->>'preco_fixo','')::numeric);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

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

REVOKE ALL ON FUNCTION public.fn_tabela_preco_salvar(uuid,uuid,jsonb), public.fn_tabela_preco_arquivar(uuid), public.fn_tabela_preco_medir(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_salvar(uuid,uuid,jsonb), public.fn_tabela_preco_arquivar(uuid), public.fn_tabela_preco_medir(uuid,jsonb) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.novo', 'Novo contrato', 'Clique para cadastrar o contrato de preços de um cliente do zero.', 'Guarda o preço por serviço, faixa de quantidade e regime, com o código do cliente.', 'Contrato BRF 2026.', 'Cadastrar sem vigência e não saber qual tabela vale.', 20),
 ('hub.tabela_preco.nome', 'Nome do contrato', 'Um nome que o time reconhece: cliente e ano.', 'Aparece na lista e na medição.', 'BRF — Piso industrial 2026', 'Usar o mesmo nome em dois contratos.', 21),
 ('hub.tabela_preco.vigencia_ini', 'Início da vigência', 'Data em que o contrato começa a valer.', 'Define qual tabela está ativa para o cliente.', '01/01/2026', 'Deixar a data de hoje por descuido.', 22),
 ('hub.tabela_preco.vigencia_fim', 'Fim da vigência', 'Data em que o contrato acaba. Vazio = sem fim.', 'Mostra quando o reajuste precisa ser negociado.', '31/12/2026', 'Fim antes do início.', 23),
 ('hub.tabela_preco.regime', 'Regime (turno/dia)', 'Nome do regime e o adicional em % sobre o preço normal.', 'Aplica noturno, sábado ou domingo/feriado sem criar outra tabela.', 'sabado +50', 'Digitar 1,5 em vez de 50.', 24),
 ('hub.tabela_preco.servico_novo', 'Serviço do contrato', 'Nome do serviço, unidade e a referência curta (sem espaço).', 'Liga o preço ao serviço medido.', 'Piso de uretano 6 mm · m²', 'Repetir a referência em dois serviços.', 25),
 ('hub.tabela_preco.faixa', 'Faixa de quantidade', 'Quantidade inicial e final da faixa e o preço por unidade.', 'O preço muda conforme a metragem: quanto mais, mais barato.', '500 a 1.000 m² = R$ 106,20', 'Faixas com sobreposição ou buraco entre elas.', 26),
 ('hub.tabela_preco.codigo', 'Código no cliente', 'Código do item no ERP do cliente, para cada regime.', 'A medição sai com o código que o cliente espera.', 'SAP 4500123', 'Esquecer o código do regime noturno.', 27),
 ('hub.tabela_preco.salvar', 'Salvar contrato', 'Confira nome, faixas e códigos e salve.', 'Grava tudo de uma vez; pode editar depois.', 'Salvar contrato', 'Sair da tela sem salvar.', 28),
 ('hub.tabela_preco.arquivar', 'Arquivar contrato', 'Use quando o contrato acabou ou foi substituído.', 'Tira da lista sem apagar o histórico.', 'Arquivar o contrato 2025', 'Arquivar o contrato vigente.', 29),
 ('hub.tabela_preco.medicao', 'Medição ao cliente', 'Informe a quantidade medida de cada serviço e o regime em que foi feito.', 'Aplica faixa e regime do contrato e mostra o extrato com os códigos do cliente.', '700 m² de uretano no sábado', 'Medir sem escolher o regime.', 30),
 ('hub.tabela_preco.medicao_qtd', 'Quantidade medida', 'Quantidade executada no período, na unidade do serviço.', 'Define a faixa de preço usada.', '700', 'Somar quantidades de regimes diferentes na mesma linha.', 31)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
