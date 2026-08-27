-- SPEC F2.7 · LIGAR OPORTUNIDADE ↔ ORÇAMENTO · Hub de Projetos.
-- O elo comercial estava vazio (12/13 oportunidades sem orçamento). Esta migração cria a ponte:
-- da oportunidade nasce o orçamento já vinculado; o card mostra o orçamento real; o take-off também vincula.
-- Auditado 27/08 (RD-44/45): erp_orcamentos tem vendedor_id/vendedor_nome e NÃO tem oportunidade_id
-- (o vínculo mora em erp_crm_oportunidade.orcamento_id); numero via trigger tg_orcamento_set_numero.

-- ENTREGA 1 · cria (ou devolve) o orçamento da oportunidade, herdando cliente/vendedor. Idempotente.
CREATE OR REPLACE FUNCTION public.fn_oportunidade_gerar_orcamento(p_oportunidade_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_op record; v_orc_id uuid; v_numero text; v_nome text; v_validade int;
BEGIN
  SELECT * INTO v_op FROM erp_crm_oportunidade WHERE id = p_oportunidade_id;
  IF v_op.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'oportunidade_nao_encontrada'); END IF;
  IF v_op.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- idempotente: já existe orçamento vinculado (e não órfão) → devolve o mesmo
  IF v_op.orcamento_id IS NOT NULL THEN
    SELECT id, numero INTO v_orc_id, v_numero FROM erp_orcamentos WHERE id = v_op.orcamento_id;
    IF v_orc_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc_id, 'numero', v_numero, 'ja_existia', true);
    END IF;
  END IF;
  IF v_op.cliente_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_cliente',
      'mensagem', 'Informe o cliente da oportunidade antes de gerar o orçamento.');
  END IF;
  SELECT COALESCE(nome_fantasia, razao_social) INTO v_nome FROM erp_clientes WHERE id = v_op.cliente_id;
  SELECT COALESCE(validade_proposta_dias, 30) INTO v_validade FROM projetos_modulo_config WHERE company_id = v_op.company_id;
  v_validade := COALESCE(v_validade, 30);
  INSERT INTO erp_orcamentos (company_id, cliente_id, cliente_nome, status, data_emissao, data_validade,
    vendedor_id, vendedor_nome, observacoes_internas, created_by)
  VALUES (v_op.company_id, v_op.cliente_id, v_nome, 'rascunho', CURRENT_DATE, CURRENT_DATE + v_validade,
    v_op.responsavel_id, v_op.responsavel_nome, 'Gerado da oportunidade: ' || COALESCE(v_op.titulo,''), auth.uid())
  RETURNING id, numero INTO v_orc_id, v_numero;
  UPDATE erp_crm_oportunidade SET orcamento_id = v_orc_id, updated_at = now() WHERE id = p_oportunidade_id;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc_id, 'numero', v_numero, 'ja_existia', false);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_oportunidade_gerar_orcamento(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oportunidade_gerar_orcamento(uuid) TO authenticated;

-- ENTREGA 2a · mapa oportunidade→orçamento (o card mostra o orçamento real, sem N consultas)
CREATE OR REPLACE FUNCTION public.fn_crm_orcamento_do_card(p_company_id uuid)
RETURNS TABLE (oportunidade_id uuid, orcamento_id uuid, numero text, status text, total numeric, itens int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT o.id, r.id, r.numero, r.status, COALESCE(r.total,0),
         (SELECT count(*)::int FROM erp_orcamentos_itens i WHERE i.orcamento_id = r.id)
    FROM erp_crm_oportunidade o
    JOIN erp_orcamentos r ON r.id = o.orcamento_id
   WHERE o.company_id = p_company_id
     AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.fn_crm_orcamento_do_card(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_orcamento_do_card(uuid) TO authenticated;

-- ENTREGA 4 · o take-off também vincula à oportunidade (novo 4º parâmetro, opcional).
-- DROP+CREATE porque a assinatura muda (evita overload ambíguo com a versão de 3 args).
DROP FUNCTION IF EXISTS public.fn_takeoff_criar_orcamento(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.fn_takeoff_criar_orcamento(
  p_company_id uuid, p_planta_id uuid, p_cliente_id uuid DEFAULT NULL, p_oportunidade_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_planta record; v_orc_id uuid; v_numero text; v_cli_id uuid; v_cli_nome text; v_validade int; v_qtd int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_planta FROM erp_obra_planta WHERE id=p_planta_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'planta_nao_encontrada'); END IF;
  SELECT count(*) INTO v_qtd FROM erp_obra_planta_ambiente
   WHERE planta_id=p_planta_id AND company_id=p_company_id AND confirmado=true AND servico_id IS NOT NULL;
  IF v_qtd = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_ambiente_pronto',
      'mensagem', 'Confirme os ambientes e escolha o serviço de cada um antes de gerar o orçamento.'); END IF;
  v_cli_id := COALESCE(p_cliente_id, v_planta.cliente_id);
  v_cli_nome := v_planta.cliente_nome;
  IF v_cli_nome IS NULL AND v_cli_id IS NOT NULL THEN
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli_nome FROM erp_clientes WHERE id=v_cli_id; END IF;
  SELECT COALESCE(validade_proposta_dias, 30) INTO v_validade FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_validade := COALESCE(v_validade, 30);
  INSERT INTO erp_orcamentos (company_id, cliente_id, cliente_nome, status,
      data_emissao, data_validade, observacoes_internas, created_by)
  VALUES (p_company_id, v_cli_id, v_cli_nome, 'rascunho',
      CURRENT_DATE, CURRENT_DATE + v_validade, 'Gerado do take-off: ' || COALESCE(v_planta.nome,'planta'), auth.uid())
  RETURNING id, numero INTO v_orc_id, v_numero;
  PERFORM public.fn_takeoff_gerar_orcamento(p_company_id, p_planta_id, v_orc_id);
  UPDATE erp_obra_planta SET orcamento_id=v_orc_id, updated_at=now() WHERE id=p_planta_id AND company_id=p_company_id;
  -- F2.7 · vincula à oportunidade quando veio de uma (só se ela ainda não tem orçamento — não sobrescreve)
  IF p_oportunidade_id IS NOT NULL THEN
    UPDATE erp_crm_oportunidade SET orcamento_id=v_orc_id, updated_at=now()
     WHERE id=p_oportunidade_id AND company_id=p_company_id AND orcamento_id IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc_id, 'numero', v_numero,
    'itens', (SELECT count(*) FROM erp_orcamentos_itens WHERE orcamento_id=v_orc_id));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_takeoff_criar_orcamento(uuid,uuid,uuid,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_criar_orcamento(uuid,uuid,uuid,uuid) TO authenticated;
