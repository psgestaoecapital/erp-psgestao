-- ============================================================
-- ONDA 9 · ajuste: concluir OS NAO gera conta a pagar automatica (veto do CEO)
-- Regra da Onda 5: previsto nao vira dinheiro sem acao do usuario. E vencimento =
-- data de conclusao faria o titulo nascer VENCIDO no financeiro da GE.
-- Entao: concluir cria so o veic_custo (custo no chassi, gerar_pagar=false). Lancar a
-- conta a pagar vira uma acao separada, deliberada, pedindo fornecedor + vencimento.
-- ============================================================

-- 1 · concluir OS: cria o custo SEM titulo (gerar_pagar=false)
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_concluir(p_os_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_comp uuid; v_existing uuid; v_valor numeric;
  v_res jsonb; v_custo_id uuid;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id AND excluida = false;
  IF v_os.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;
  IF v_os.veic_veiculo_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_preparacao'); END IF;

  v_comp := public.fn_veic_acesso(v_os.veic_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- idempotencia: OS ja tem custo vinculado
  SELECT id INTO v_existing FROM veic_custo WHERE os_id = p_os_id AND deleted_at IS NULL LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'custo_id', v_existing, 'os_id', p_os_id, 'numero', v_os.numero);
  END IF;

  v_valor := COALESCE(NULLIF(v_os.total, 0),
                      COALESCE(v_os.valor_servico,0) + COALESCE(v_os.valor_materiais,0) + COALESCE(v_os.valor_deslocamento,0));

  -- OS sem valor: conclui, mas nao inventa dinheiro (nenhum custo criado)
  IF v_valor IS NULL OR v_valor <= 0 THEN
    UPDATE erp_os SET status='entregue', data_conclusao=COALESCE(data_conclusao, CURRENT_DATE), updated_at=now()
      WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'custo_id', NULL, 'valor', 0, 'sem_custo', true, 'os_id', p_os_id, 'numero', v_os.numero);
  END IF;

  -- cria o custo via a RPC oficial, SEM titulo (gerar_pagar=false). A conta a pagar e acao separada.
  -- entra_base_fiscal NAO decidido aqui (regra fiscal, D2b travado no contador): herda o default.
  v_res := public.fn_veic_custo_salvar(
    v_os.veic_veiculo_id,
    jsonb_build_object(
      'categoria', 'preparacao',
      'descricao', 'OS ' || v_os.numero || ' — ' || left(COALESCE(v_os.descricao_servico, 'preparacao'), 180),
      'valor', v_valor::text,
      'data_custo', COALESCE(v_os.data_conclusao, CURRENT_DATE)::text,
      'documento', v_os.numero
    ),
    false,   -- gerar_pagar=false: previsto nao vira dinheiro sem acao do usuario (Onda 5)
    NULL,    -- sem vencimento
    p_user);

  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_custo_id := (v_res->>'custo_id')::uuid;

  -- carimba a origem (indice unico ux_veic_custo_os e a rede de seguranca)
  UPDATE veic_custo SET os_id = p_os_id WHERE id = v_custo_id;

  UPDATE erp_os SET status='entregue', data_conclusao=COALESCE(data_conclusao, CURRENT_DATE), updated_at=now()
    WHERE id = p_os_id;

  -- custo criado, mas SEM conta a pagar: sinaliza pra tela oferecer "Lancar conta a pagar"
  RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'custo_id', v_custo_id,
    'pagar_id', NULL, 'sem_pagar', true, 'valor', v_valor, 'os_id', p_os_id, 'numero', v_os.numero);
END $function$;

-- 2 · lancar conta a pagar para um custo JA existente (acao separada, deliberada).
--     Nao cria custo novo (isso e fn_veic_custo_salvar); anexa o erp_pagar ao custo e carimba pagar_id.
--     Idempotente: custo que ja tem pagar_id devolve ja_lancado:true.
CREATE OR REPLACE FUNCTION public.fn_veic_custo_gerar_pagar(p_custo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_comp uuid; v_modelo text; v_placa text; v_venc date;
  v_forn_id uuid; v_forn_nome text; v_pagar_id uuid;
BEGIN
  SELECT id, company_id, veiculo_id, categoria, valor, descricao, data_custo,
         fornecedor_id, fornecedor_nome, pagar_id, deleted_at
    INTO v_c FROM veic_custo WHERE id = p_custo_id;
  IF v_c.id IS NULL OR v_c.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'custo_nao_encontrado'); END IF;

  v_comp := public.fn_veic_acesso(v_c.veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- idempotencia: custo ja tem titulo
  IF v_c.pagar_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'pagar_id', v_c.pagar_id, 'custo_id', p_custo_id); END IF;

  -- vencimento e obrigatorio para o titulo (mesma regra de fn_veic_custo_salvar)
  BEGIN v_venc := NULLIF(btrim(p_dados->>'vencimento'),'')::date; EXCEPTION WHEN others THEN v_venc := NULL; END;
  IF v_venc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo', 'campo', 'vencimento'); END IF;

  -- fornecedor: usa o informado; senao herda o do custo
  v_forn_id   := COALESCE(NULLIF(p_dados->>'fornecedor_id','')::uuid, v_c.fornecedor_id);
  v_forn_nome := COALESCE(NULLIF(btrim(p_dados->>'fornecedor_nome'),''), v_c.fornecedor_nome);

  SELECT modelo, placa INTO v_modelo, v_placa FROM veic_veiculo WHERE id = v_c.veiculo_id;

  INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                         fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
  VALUES (v_c.company_id, v_c.valor,
          COALESCE(v_c.categoria,'custo') || ' — ' || COALESCE(v_modelo,'') || ' ' || COALESCE(v_placa,'')
            || COALESCE(' — ' || NULLIF(btrim(v_c.descricao),''), ''),
          v_venc, COALESCE(v_c.data_custo, CURRENT_DATE), v_c.categoria,
          v_forn_id, v_forn_nome, 'revenda_veiculos', v_c.id::text)
  RETURNING id INTO v_pagar_id;

  UPDATE veic_custo
     SET pagar_id = v_pagar_id,
         fornecedor_id = v_forn_id,
         fornecedor_nome = v_forn_nome
   WHERE id = p_custo_id;

  INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, v_c.veiculo_id, 'pagar', 'LANCOU conta a pagar do custo (' || COALESCE(v_c.categoria,'custo') || ') R$ ' || v_c.valor::text, p_user,
          jsonb_build_object('custo_id', p_custo_id, 'pagar_id', v_pagar_id, 'vencimento', v_venc));

  RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'pagar_id', v_pagar_id, 'custo_id', p_custo_id);
END $function$;
