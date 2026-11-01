-- HB2 · Contrato de preços do cliente — ESCRITA por RPC (antes a tabela era só leitura). Funções NOVAS, SECURITY DEFINER com
-- guarda de empresa (fn__guarda_empresa), sem anon. Cadastram/editam tabela, faixa de quantidade, condição (regime) e código
-- do cliente. Aditiva: não altera dado existente nem função existente.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF btrim(coalesce(p_dados->>'nome','')) = '' THEN RAISE EXCEPTION 'Informe o nome da tabela'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.erp_tabela_preco_cliente (company_id, nome, vigencia_inicio, vigencia_fim)
    VALUES (p_company_id, btrim(p_dados->>'nome'), COALESCE(NULLIF(p_dados->>'vigencia_inicio','')::date, CURRENT_DATE), NULLIF(p_dados->>'vigencia_fim','')::date)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_tabela_preco_cliente SET nome = btrim(p_dados->>'nome'),
      vigencia_inicio = COALESCE(NULLIF(p_dados->>'vigencia_inicio','')::date, vigencia_inicio),
      vigencia_fim = NULLIF(p_dados->>'vigencia_fim','')::date
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_faixa_salvar(p_tabela_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_ref text := btrim(coalesce(p_dados->>'servico_ref',''));
  v_de numeric := COALESCE((p_dados->>'faixa_de')::numeric, 0); v_ate numeric := NULLIF(p_dados->>'faixa_ate','')::numeric;
  v_preco numeric := (p_dados->>'preco_base')::numeric; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_ref = '' OR btrim(coalesce(p_dados->>'servico_nome','')) = '' OR btrim(coalesce(p_dados->>'unidade','')) = '' THEN
    RAISE EXCEPTION 'Informe serviço, nome e unidade'; END IF;
  IF v_preco IS NULL OR v_preco < 0 THEN RAISE EXCEPTION 'Preço inválido'; END IF;
  IF v_de < 0 OR (v_ate IS NOT NULL AND v_ate <= v_de) THEN RAISE EXCEPTION 'Faixa inválida: o fim deve ser maior que o início'; END IF;
  -- faixas do mesmo serviço não podem se sobrepor ([de, ate) como no cálculo)
  IF EXISTS (SELECT 1 FROM public.erp_tabela_preco_item i
              WHERE i.tabela_id = p_tabela_id AND i.servico_ref = v_ref AND NOT i.adicional
                AND i.id IS DISTINCT FROM NULLIF(p_dados->>'id','')::uuid
                AND v_de < COALESCE(i.faixa_ate, 'Infinity'::numeric) AND i.faixa_de < COALESCE(v_ate, 'Infinity'::numeric)) THEN
    RAISE EXCEPTION 'Esta faixa se sobrepõe a outra do mesmo serviço'; END IF;
  v_id := NULLIF(p_dados->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base)
    VALUES (v_company, p_tabela_id, v_ref, btrim(p_dados->>'servico_nome'), btrim(p_dados->>'unidade'), v_de, v_ate, v_preco) RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_tabela_preco_item SET servico_nome = btrim(p_dados->>'servico_nome'), unidade = btrim(p_dados->>'unidade'),
      faixa_de = v_de, faixa_ate = v_ate, preco_base = v_preco
     WHERE id = v_id AND tabela_id = p_tabela_id AND company_id = v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faixa não encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_faixa_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_item WHERE id = p_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Faixa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  DELETE FROM public.erp_tabela_preco_item WHERE id = p_id AND company_id = v_company;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_condicao_salvar(p_tabela_id uuid, p_condicao text, p_percentual numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_c text := btrim(coalesce(p_condicao,''));
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_c = '' OR v_c = 'normal' THEN RAISE EXCEPTION 'Informe o nome da condição (a normal já existe)'; END IF;
  UPDATE public.erp_tabela_preco_condicao SET percentual = p_percentual WHERE tabela_id = p_tabela_id AND condicao = v_c;
  IF NOT FOUND THEN
    INSERT INTO public.erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual) VALUES (v_company, p_tabela_id, v_c, p_percentual);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_codigo_salvar(p_tabela_id uuid, p_servico_ref text, p_condicao text, p_codigo text, p_preco_fixo numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_c text := COALESCE(NULLIF(btrim(p_condicao),''),'normal');
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF NOT EXISTS (SELECT 1 FROM public.erp_tabela_preco_item WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref) THEN
    RAISE EXCEPTION 'Serviço não está na tabela'; END IF;
  IF btrim(coalesce(p_codigo,'')) = '' THEN
    DELETE FROM public.erp_tabela_preco_codigo WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref AND condicao = v_c;
  ELSE
    UPDATE public.erp_tabela_preco_codigo SET codigo_externo = btrim(p_codigo), preco_fixo = p_preco_fixo
     WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref AND condicao = v_c;
    IF NOT FOUND THEN
      INSERT INTO public.erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo, preco_fixo)
      VALUES (v_company, p_tabela_id, p_servico_ref, v_c, btrim(p_codigo), p_preco_fixo);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_faixa_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_faixa_excluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_condicao_salvar(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_codigo_salvar(uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_faixa_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_faixa_excluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_condicao_salvar(uuid, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_codigo_salvar(uuid, text, text, text, numeric) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('hub.tabela_preco.editar', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 330, 'Editar contrato',
  'Abra para cadastrar faixas de quantidade, condições (noturno, sábado…) e o código do item no cliente.', 'Mantém o contrato do cliente no sistema, sem planilha paralela.', 'Uretano 6 mm, 0 a 100 m², R$ 135,00', 'Esquecer de fechar a faixa anterior: faixas do mesmo serviço não podem se sobrepor.'),
 ('hub.tabela_preco.nova_tabela', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 331, 'Nome da tabela',
  'Nome que identifica o contrato, por exemplo o cliente e o ano.', 'Aparece na lista de tabelas e no orçamento.', 'BRF — Contrato 2026', 'Usar o mesmo nome para dois contratos de vigências diferentes.'),
 ('hub.tabela_preco.faixa_servico', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 332, 'Serviço da faixa',
  'Código interno e nome do serviço, mais a unidade (m², m, un).', 'Agrupa as faixas do mesmo serviço.', 'uretano-6mm · Piso de uretano 6 mm · m²', 'Trocar a unidade entre faixas do mesmo serviço.'),
 ('hub.tabela_preco.faixa_de_ate', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 333, 'Faixa de quantidade (de / até)',
  'Início (inclui) e fim (não inclui) da faixa. Deixe o fim vazio na última faixa.', 'O cálculo escolhe a faixa pela quantidade do orçamento.', '0 até 100; 100 até 500', 'Fim igual ao início da próxima faixa deixa buraco ou sobreposição.'),
 ('hub.tabela_preco.faixa_preco', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 334, 'Preço base da faixa',
  'Preço por unidade no regime normal (dia útil).', 'Base sobre a qual o adicional de cada condição é aplicado.', 'R$ 118,00 por m²', 'Colocar o preço total em vez do preço por unidade.'),
 ('hub.tabela_preco.cond_cadastro', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 335, 'Condição e adicional (%)',
  'Nome da condição e o percentual somado ao preço base.', 'Gera a coluna da condição no contrato (noturno +20%, sábado +50%, domingo/feriado +100%).', 'sabado · 50', 'Digitar 1,5 em vez de 50 para +50%.'),
 ('hub.tabela_preco.codigo_cadastro', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 336, 'Código no cliente',
  'Código do item no sistema do cliente para essa condição. Vazio remove o código.', 'Sai no extrato da medição nos códigos do cliente.', 'SAP 4500123', 'Cadastrar código para serviço que não está na tabela.')
ON CONFLICT (chave) DO NOTHING;
