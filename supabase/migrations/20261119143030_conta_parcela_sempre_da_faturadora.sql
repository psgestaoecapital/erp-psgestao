-- Conta de recebimento do Contrato de Fee NUNCA de outra empresa (SPEC Eng. Chefe, RD-41 · SENSÍVEL).
--
-- Diagnóstico (RD-38): a impressão do FI (fn_contrato_fee_impressao) mostra fielmente a conta SALVA na parcela;
-- o problema é que as parcelas foram salvas com a conta da empresa de ORIGEM (ex.: CTR-2026-0016/0015: 3 e 6
-- parcelas apontando conta da Pdois, não da faturadora Proplay). O #5332 corrigiu o EDITOR a seguir a
-- faturadora, mas o BANCO não tinha guarda: aceitava salvar/gerar conta de qualquer empresa, e
-- fn_contrato_gerar_parcelas criava o título a receber na faturadora COPIANDO a conta da parcela (cross-empresa).
--
-- Regra única (blindagem): a conta_bancaria_id da parcela/título SEMPRE pertence à faturadora do contrato
--   = COALESCE(empresa_faturadora_id, company_id). Nenhum dado de cliente é alterado (RD-30): só guarda.
-- Editar (salvar/gerar plano) → REJEITA conta de outra empresa (o usuário corrige na hora). Gerar título →
-- FALHA o lote se a parcela tem conta de outra empresa (decisão CEO 17/11: não gerar título cross-empresa).
-- One-off no fim: zera a conta inválida das parcelas AINDA NÃO geradas (o financeiro re-seleciona a da faturadora).

-- ============================================================================================================
-- §3.1 · fn_contrato_parcelas_salvar — fail-closed: valida ANTES do DELETE (não apaga o plano num payload ruim)
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_salvar(p_contrato_id uuid, p_parcelas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_item jsonb; v_n int := 0; v_fat uuid;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_c.status = 'ativo' THEN RETURN jsonb_build_object('ok',false,'erro','contrato_ativo_nao_edita_plano'); END IF;
  IF p_parcelas IS NULL OR jsonb_typeof(p_parcelas) <> 'array' THEN RETURN jsonb_build_object('ok',false,'erro','parcelas_invalidas'); END IF;

  v_fat := COALESCE(v_c.empresa_faturadora_id, v_c.company_id);
  -- Blindagem: toda conta informada tem de ser da FATURADORA. Valida ANTES do DELETE.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NULLIF(v_item->>'conta_bancaria_id','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM erp_banco_contas WHERE id = (v_item->>'conta_bancaria_id')::uuid AND company_id = v_fat) THEN
      RETURN jsonb_build_object('ok',false,'erro','conta_de_outra_empresa');
    END IF;
  END LOOP;

  DELETE FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    INSERT INTO erp_contrato_parcelas (contrato_id, company_id, numero, vencimento, valor, conta_bancaria_id, forma_pagamento, pagador_cliente_id)
    VALUES (p_contrato_id, v_c.company_id, v_n,
      (v_item->>'vencimento')::date, COALESCE((v_item->>'valor')::numeric,0),
      NULLIF(v_item->>'conta_bancaria_id','')::uuid, NULLIF(v_item->>'forma_pagamento',''),
      COALESCE(NULLIF(v_item->>'pagador_cliente_id','')::uuid, v_c.cliente_id));
  END LOOP;
  -- 3.5: cabeçalho acompanha o plano. Só numero_parcelas; valor fica a cargo do CEO.
  UPDATE erp_contratos SET numero_parcelas = v_n, updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok', true, 'parcelas', v_n);
END;
$function$;

-- ============================================================================================================
-- §3.2 · fn_contrato_parcelas_gerar ("Automáticas") — default pela FATURADORA + rejeita p_conta_id de outra
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_gerar(p_contrato_id uuid, p_primeiro_vencimento date, p_n integer, p_valor numeric, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_i int; v_conta uuid; v_fat uuid;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_c.status = 'ativo' THEN RETURN jsonb_build_object('ok',false,'erro','contrato_ativo_nao_edita_plano'); END IF;
  IF p_n IS NULL OR p_n < 1 THEN RETURN jsonb_build_object('ok',false,'erro','n_parcelas_invalido'); END IF;

  v_fat := COALESCE(v_c.empresa_faturadora_id, v_c.company_id);
  -- Conta informada tem de ser da FATURADORA; senão, default = conta PRINCIPAL da FATURADORA (não mais da origem).
  IF p_conta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas WHERE id = p_conta_id AND company_id = v_fat) THEN
    RETURN jsonb_build_object('ok',false,'erro','conta_de_outra_empresa');
  END IF;
  v_conta := COALESCE(p_conta_id, (SELECT id FROM erp_banco_contas WHERE company_id = v_fat AND ativo AND COALESCE(principal,false) ORDER BY created_at LIMIT 1));

  DELETE FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;  -- só chega aqui se não-ativo
  FOR v_i IN 1..p_n LOOP
    INSERT INTO erp_contrato_parcelas (contrato_id, company_id, numero, vencimento, valor, conta_bancaria_id, forma_pagamento, pagador_cliente_id)
    VALUES (p_contrato_id, v_c.company_id, v_i,
      (p_primeiro_vencimento + ((v_i-1) || ' month')::interval)::date, COALESCE(p_valor,0), v_conta, v_c.forma_pagamento, v_c.cliente_id);
  END LOOP;
  UPDATE erp_contratos SET valor_mensal = COALESCE(p_valor, valor_mensal), valor_atual = COALESCE(p_valor, valor_atual), updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok', true, 'parcelas', p_n, 'conta_bancaria_id', v_conta);
END;
$function$;

-- ============================================================================================================
-- §3.3 · fn_contrato_gerar_parcelas (gera o título a receber) — NUNCA gera título com conta cross-empresa.
--        Decisão CEO 17/11: FALHAR (RAISE parcela_conta_outra_empresa) — aborta o lote, força corrigir o plano.
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_parcelas(p_contrato_id uuid, p_ignorar_status boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record; v_p record; v_ref text; v_receber_id uuid; v_gerados int := 0; v_pulados int := 0; v_total numeric := 0;
  v_empresa_fat uuid;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado'); END IF;
  -- guarda de empresa (005d9881): sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> '' AND auth.role() <> 'service_role'
     AND v_contrato.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501'; END IF;
  -- trava de status: só exige 'ativo' quando NÃO é geração antecipada (p_ignorar_status).
  IF NOT p_ignorar_status AND v_contrato.status != 'ativo' THEN RETURN jsonb_build_object('success', false, 'error', format('contrato %s nao esta ativo', v_contrato.status)); END IF;

  v_empresa_fat := COALESCE(v_contrato.empresa_faturadora_id, v_contrato.company_id);

  FOR v_p IN SELECT * FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id ORDER BY numero LOOP
    v_ref := format('contrato:%s:parcela:%s', p_contrato_id, v_p.numero);
    -- idempotência: parcela já com título vivo (não deletado) → pula.
    IF v_p.receber_id IS NOT NULL AND EXISTS (SELECT 1 FROM erp_receber WHERE id = v_p.receber_id AND deleted_at IS NULL) THEN
      v_pulados := v_pulados + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM erp_receber WHERE ref_externa_sistema = 'contrato_parcela' AND ref_externa_id = v_ref AND deleted_at IS NULL) THEN
      v_pulados := v_pulados + 1; CONTINUE; END IF;

    -- Blindagem cross-empresa (decisão CEO 17/11 · FALHAR): o título nasce na FATURADORA e NUNCA aponta conta de
    -- outra empresa. Se a parcela tem conta que não é da faturadora, ABORTA o lote (força corrigir o plano antes
    -- de gerar título). Conta nula é aceita (o financeiro define depois).
    IF v_p.conta_bancaria_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM erp_banco_contas WHERE id = v_p.conta_bancaria_id AND company_id = v_empresa_fat) THEN
      RAISE EXCEPTION 'parcela_conta_outra_empresa' USING ERRCODE = '23514';
    END IF;

    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, status, forma_pagamento,
      conta_bancaria_id, linha_negocio, observacoes, recorrente, parcela,
      ref_externa_id, ref_externa_sistema, contrato_id
    ) VALUES (
      v_empresa_fat, v_contrato.cliente_id, v_contrato.cliente_nome,
      format('%s - Parcela %s/%s', v_contrato.nome, v_p.numero, (SELECT count(*) FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id)),
      'Receita Recorrente', v_p.valor,
      CURRENT_DATE, v_p.vencimento, date_trunc('month', v_p.vencimento)::date, 'aberto', v_p.forma_pagamento,
      v_p.conta_bancaria_id, v_contrato.tipo, format('Fee do contrato %s (parcela %s)', v_contrato.numero, v_p.numero),
      true, v_p.numero::text, v_ref, 'contrato_parcela', p_contrato_id
    ) RETURNING id INTO v_receber_id;

    UPDATE erp_contrato_parcelas SET receber_id = v_receber_id, updated_at = now() WHERE id = v_p.id;
    v_gerados := v_gerados + 1; v_total := v_total + COALESCE(v_p.valor,0);
  END LOOP;

  IF v_gerados > 0 THEN
    UPDATE erp_contratos SET ultimo_titulo_gerado_em = CURRENT_DATE,
      sem_contas_receber = false,
      total_titulos_gerados = COALESCE(total_titulos_gerados,0) + v_gerados,
      total_faturado = COALESCE(total_faturado,0) + v_total, updated_at = now()
    WHERE id = p_contrato_id;
    INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, created_at)
    VALUES (p_contrato_id, v_contrato.company_id, 'parcelas_geradas',
      format('%s parcela(s) gerada(s) em contas a receber (R$ %s)', v_gerados, to_char(v_total,'FM999999990.00')),
      jsonb_build_object('gerados', v_gerados, 'pulados', v_pulados, 'total', v_total, 'empresa_faturadora', v_empresa_fat), now());
  END IF;

  RETURN jsonb_build_object('success', true, 'gerados', v_gerados, 'pulados', v_pulados, 'total', v_total);
END;
$function$;

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço (CREATE OR REPLACE preserva, re-afirma).
REVOKE ALL ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_contrato_parcelas_gerar(uuid, date, integer, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_contrato_gerar_parcelas(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_parcelas_gerar(uuid, date, integer, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_gerar_parcelas(uuid, boolean) TO authenticated, service_role;

-- Correção dos DADOS já errados (one-off, genérica — autorizada pelo CEO 17/11). Zera a conta inválida (de
-- empresa <> faturadora) das parcelas AINDA NÃO geradas (receber_id IS NULL); o financeiro re-seleciona a conta
-- correta da faturadora na tela. NÃO adivinha conta e NÃO toca título já gerado. Genérico: pega CTR-2026-0015,
-- -0016 e quaisquer outros. Idempotente (re-rodar não muda nada). Não altera dado de cliente.
UPDATE public.erp_contrato_parcelas p
   SET conta_bancaria_id = NULL, updated_at = now()
  FROM public.erp_contratos c, public.erp_banco_contas bc
 WHERE p.contrato_id = c.id
   AND bc.id = p.conta_bancaria_id
   AND p.receber_id IS NULL
   AND bc.company_id IS DISTINCT FROM COALESCE(c.empresa_faturadora_id, c.company_id);
