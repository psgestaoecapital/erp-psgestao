-- Hub · Gestão de Obras · Subempreiteiros (Blueprint §16 H7 · camada de dados — ESCRITA)
-- Aditivo: RPCs guardadas de gravação sobre as tabelas do slice 1 (20261104180348), para a tela (aba
-- Subempreiteiros na obra) ter o caminho de criar/editar/excluir. SEM movimento financeiro aqui — a ponte
-- medição→[→GE] erp_pagar (retenção/INSS/ISS) continua sendo o slice 2 (reusa a GE, não recria financeiro).
-- Guarda por company_id (espelha fn_obra_subempreiteiro_contrato_listar): obra e fornecedor têm de ser da
-- empresa do usuário. Soft-delete rastreável (RD-98 p4). valor do item é coluna gerada (não gravada).

-- 1) Salvar (criar ou editar) o contrato do subempreiteiro COM seus itens --------------------------------
-- Payload jsonb: { contrato_id?, obra_id, fornecedor_id, numero?, objeto?, valor_total?, retencao_pct?,
--                  data_inicio?, data_fim_prevista?, status?, observacoes?, itens:[{descricao, unidade?,
--                  quantidade?, preco_unitario?, ordem?}] }
-- Itens: estratégia de substituição (soft-delete dos atuais + insere os enviados) — mantém histórico.
-- valor_total: soma dos itens quando houver itens; senão o valor informado.
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_contrato_salvar(p_contrato jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_contrato_id uuid := NULLIF(p_contrato->>'contrato_id','')::uuid;
  v_obra_id     uuid := NULLIF(p_contrato->>'obra_id','')::uuid;
  v_fornecedor  uuid := NULLIF(p_contrato->>'fornecedor_id','')::uuid;
  v_obra        public.projetos_obras%ROWTYPE;
  v_company     uuid;
  v_forn_company uuid;
  v_status      text := COALESCE(NULLIF(p_contrato->>'status',''), 'rascunho');
  v_retencao    numeric := COALESCE(NULLIF(p_contrato->>'retencao_pct','')::numeric, 0);
  v_itens       jsonb := COALESCE(p_contrato->'itens', '[]'::jsonb);
  v_soma_itens  numeric;
  v_valor_total numeric;
BEGIN
  -- Em edição, a obra vem do contrato existente (não confia em obra_id do payload)
  IF v_contrato_id IS NOT NULL THEN
    SELECT obra_id INTO v_obra_id FROM public.obra_subempreiteiro_contrato
     WHERE id = v_contrato_id AND excluido_em IS NULL;
    IF v_obra_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
    END IF;
  END IF;

  IF v_obra_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra é obrigatória');
  END IF;
  IF v_fornecedor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Fornecedor (subempreiteiro) é obrigatório');
  END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = v_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  v_company := v_obra.company_id;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- O fornecedor tem de ser da MESMA empresa da obra (sem vínculo cruzado entre empresas)
  SELECT company_id INTO v_forn_company FROM public.erp_fornecedores WHERE id = v_fornecedor;
  IF v_forn_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado');
  END IF;
  IF v_forn_company <> v_company THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Fornecedor não pertence à empresa da obra');
  END IF;

  IF v_status NOT IN ('rascunho','ativo','concluido','cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status inválido');
  END IF;
  IF v_retencao < 0 OR v_retencao > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Retenção deve estar entre 0 e 100%');
  END IF;

  -- valor_total: soma dos itens quando houver; senão o informado
  SELECT COALESCE(SUM((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric), 0)
    INTO v_soma_itens
  FROM jsonb_array_elements(v_itens) i;
  v_valor_total := CASE WHEN jsonb_array_length(v_itens) > 0
                        THEN v_soma_itens
                        ELSE COALESCE(NULLIF(p_contrato->>'valor_total','')::numeric, 0) END;

  IF v_contrato_id IS NULL THEN
    INSERT INTO public.obra_subempreiteiro_contrato
      (company_id, obra_id, fornecedor_id, numero, objeto, valor_total, retencao_pct,
       data_inicio, data_fim_prevista, status, observacoes, criado_por)
    VALUES
      (v_company, v_obra_id, v_fornecedor,
       NULLIF(p_contrato->>'numero',''), NULLIF(p_contrato->>'objeto',''),
       v_valor_total, v_retencao,
       NULLIF(p_contrato->>'data_inicio','')::date, NULLIF(p_contrato->>'data_fim_prevista','')::date,
       v_status, NULLIF(p_contrato->>'observacoes',''), auth.uid())
    RETURNING id INTO v_contrato_id;
  ELSE
    UPDATE public.obra_subempreiteiro_contrato SET
      fornecedor_id = v_fornecedor,
      numero        = NULLIF(p_contrato->>'numero',''),
      objeto        = NULLIF(p_contrato->>'objeto',''),
      valor_total   = v_valor_total,
      retencao_pct  = v_retencao,
      data_inicio       = NULLIF(p_contrato->>'data_inicio','')::date,
      data_fim_prevista = NULLIF(p_contrato->>'data_fim_prevista','')::date,
      status        = v_status,
      observacoes   = NULLIF(p_contrato->>'observacoes',''),
      atualizado_em = now()
    WHERE id = v_contrato_id AND company_id = v_company AND excluido_em IS NULL;
  END IF;

  -- Itens: substituição rastreável (soft-delete dos atuais + insere os enviados)
  UPDATE public.obra_subempreiteiro_contrato_item
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE contrato_id = v_contrato_id AND excluido_em IS NULL;

  INSERT INTO public.obra_subempreiteiro_contrato_item
    (company_id, contrato_id, descricao, unidade, quantidade, preco_unitario, ordem)
  SELECT v_company, v_contrato_id,
         COALESCE(NULLIF(i->>'descricao',''), '(sem descrição)'),
         NULLIF(i->>'unidade',''),
         COALESCE((i->>'quantidade')::numeric, 0),
         COALESCE((i->>'preco_unitario')::numeric, 0),
         COALESCE((i->>'ordem')::int, (ord.n - 1))
  FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS ord(i, n)
  WHERE COALESCE(NULLIF(i->>'descricao',''), '') <> '';

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_contrato_id, 'valor_total', v_valor_total);
END; $f$;

-- 2) Excluir (soft-delete rastreável) o contrato e seus itens --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_contrato_excluir(p_contrato_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_company uuid;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão');
  END IF;

  SELECT company_id INTO v_company FROM public.obra_subempreiteiro_contrato
   WHERE id = p_contrato_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado ou já excluído');
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  UPDATE public.obra_subempreiteiro_contrato_item
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE contrato_id = p_contrato_id AND excluido_em IS NULL;

  UPDATE public.obra_subempreiteiro_contrato
     SET excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo),
         atualizado_em = now()
   WHERE id = p_contrato_id;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_contrato_salvar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_contrato_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_contrato_salvar(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_contrato_excluir(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_obra_subempreiteiro_contrato_salvar(jsonb) IS
  'Blueprint §16 H7: cria/edita o contrato do subempreiteiro e seus itens (substituição rastreável). Guarda por company_id (obra e fornecedor da mesma empresa). Sem movimento financeiro (slice 2 = medição→erp_pagar).';
COMMENT ON FUNCTION public.fn_obra_subempreiteiro_contrato_excluir(uuid, text) IS
  'Blueprint §16 H7: exclusão rastreável (RD-98 p4) do contrato do subempreiteiro e seus itens (motivo obrigatório). Guarda por company_id.';
