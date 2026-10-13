-- #35 (FC Pisos · Jordana) — faturar por MEDIÇÃO: escolher parcelas do pedido, emitir UMA NFS-e pela soma e
-- decidir se o financeiro nasce na autorização. O backend de medição existe desde #1380-#1386
-- (fn_faturar_efetivar por parcelas, fn_nfse_efetivar_se_autorizada, colunas parcela_ids/efetivacao_status),
-- mas NINGUÉM o chamava (auditoria 18/09, contexto f4c2e76a). Esta migration liga as pontas:
--
--  (1) fn_nfse_medicao_validar — ANTES de emitir: parcelas do pedido/empresa, ainda previstas, sem outra nota
--      ativa (autorizada/processando) sobre elas, e soma = valor da nota. Nunca emitir nota que não fecha.
--  (2) fn_nfse_medicao_vincular — DEPOIS de registrar a nota: grava pedido_id + parcela_ids +
--      efetivacao_status ('pendente' = gerar o financeiro na autorização · 'nao_gerar' = deixar previsto).
--      Nota que já volta AUTORIZADA (síncrona) efetiva na hora.
--  (3) gatilho trg_nfse_medicao_efetivar — nota que vira AUTORIZADA depois (processando → autorizada, pelo
--      webhook ou pela consulta) com efetivacao_status='pendente' → fn_nfse_efetivar_se_autorizada.
--  (4) fn_nfse_gerar_financeiro — nota de medição: efetiva as parcelas DELA (se ficaram previstas) e o
--      re-preço pelo líquido (CASO A) toca SÓ os títulos dessas parcelas, nunca o pedido inteiro.
-- Nada disso roda sobre dado existente: 0 notas com parcela_ids hoje (efeito só em emissões novas).

-- (0) novo estado: 'nao_gerar' = nota de medição emitida SEM gerar o financeiro (parcelas seguem previstas até
--     o "Gerar financeiro desta nota"). Os demais estados seguem como estavam.
ALTER TABLE public.erp_nfse_emitidas DROP CONSTRAINT IF EXISTS erp_nfse_emitidas_efetivacao_status_chk;
ALTER TABLE public.erp_nfse_emitidas ADD CONSTRAINT erp_nfse_emitidas_efetivacao_status_chk
  CHECK (efetivacao_status IS NULL OR efetivacao_status IN ('pendente','ok','falha','nao_aplicavel','nao_gerar'));

-- (1) validação antes de emitir ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfse_medicao_validar(
  p_company_id uuid, p_pedido_id uuid, p_parcela_ids uuid[], p_valor numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ped record; v_n int; v_soma numeric; v_ocupadas text; v_efetivadas text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT id, company_id, status, numero INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped.id IS NULL OR v_ped.company_id <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido não encontrado nesta empresa.');
  END IF;
  IF v_ped.status = 'cancelado' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Pedido cancelado.'); END IF;
  IF p_parcela_ids IS NULL OR array_length(p_parcela_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Marque ao menos uma parcela (medição).');
  END IF;
  SELECT count(*), COALESCE(sum(valor),0) INTO v_n, v_soma
    FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id AND id = ANY(p_parcela_ids);
  IF v_n <> array_length(p_parcela_ids,1) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Parcela que não é deste pedido.');
  END IF;
  -- já faturada (título deixou de ser 'previsto')?
  SELECT string_agg(pp.numero::text, ', ' ORDER BY pp.numero) INTO v_efetivadas
    FROM erp_pedidos_parcelas pp
   WHERE pp.id = ANY(p_parcela_ids)
     AND EXISTS (SELECT 1 FROM erp_receber r WHERE r.pedido_parcela_id = pp.id AND r.deleted_at IS NULL AND r.status <> 'previsto');
  IF v_efetivadas IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Parcela(s) já faturada(s): ' || v_efetivadas || '.');
  END IF;
  -- outra nota ativa já cobre alguma dessas parcelas?
  SELECT string_agg(COALESCE(n.numero, 'em processamento'), ', ') INTO v_ocupadas
    FROM erp_nfse_emitidas n
   WHERE n.company_id = p_company_id AND n.status IN ('autorizada','processando')
     AND n.parcela_ids && p_parcela_ids;
  IF v_ocupadas IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Já existe NFS-e para essa(s) parcela(s): ' || v_ocupadas || '. Não reemita.');
  END IF;
  IF p_valor IS NULL OR abs(v_soma - p_valor) > 0.01 * array_length(p_parcela_ids,1) THEN
    RETURN jsonb_build_object('ok', false, 'erro', format('As parcelas marcadas somam R$ %s e a nota é de R$ %s.',
      to_char(v_soma,'FM999999990.00'), to_char(COALESCE(p_valor,0),'FM999999990.00')));
  END IF;
  RETURN jsonb_build_object('ok', true, 'soma', v_soma, 'parcelas', v_n);
END $function$;

-- (2) vínculo depois de registrar ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfse_medicao_vincular(
  p_nfse_id uuid, p_pedido_id uuid, p_parcela_ids uuid[], p_gerar_financeiro boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n record; v_ef jsonb;
BEGIN
  SELECT id, company_id, status INTO v_n FROM erp_nfse_emitidas WHERE id = p_nfse_id;
  IF v_n.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota não encontrada'); END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND v_n.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_pedidos WHERE id = p_pedido_id AND company_id = v_n.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pedido de outra empresa');
  END IF;
  UPDATE erp_nfse_emitidas
     SET pedido_id = p_pedido_id, parcela_ids = p_parcela_ids,
         efetivacao_status = CASE WHEN COALESCE(p_gerar_financeiro, true) THEN 'pendente' ELSE 'nao_gerar' END,
         atualizado_em = now()
   WHERE id = p_nfse_id;
  -- autorização síncrona: o gatilho (3) só pega a TRANSIÇÃO de status; a nota que já nasceu autorizada efetiva aqui
  IF v_n.status = 'autorizada' AND COALESCE(p_gerar_financeiro, true) THEN
    v_ef := public.fn_nfse_efetivar_se_autorizada(p_nfse_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'efetivacao', v_ef);
END $function$;

-- (3) autorização posterior efetiva as parcelas ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_nfse_medicao_efetivar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'autorizada' AND OLD.status IS DISTINCT FROM 'autorizada'
     AND NEW.efetivacao_status = 'pendente'
     AND NEW.parcela_ids IS NOT NULL AND array_length(NEW.parcela_ids,1) IS NOT NULL THEN
    -- fn_nfse_efetivar_se_autorizada nunca derruba a transação: falha vira efetivacao_status='falha' visível.
    PERFORM public.fn_nfse_efetivar_se_autorizada(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_nfse_medicao_efetivar ON public.erp_nfse_emitidas;
CREATE TRIGGER trg_nfse_medicao_efetivar
AFTER UPDATE OF status ON public.erp_nfse_emitidas
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_nfse_medicao_efetivar();

-- (4) gerar financeiro de nota de medição: só as parcelas dela ----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfse_gerar_financeiro(
  p_nfse_id uuid, p_deducoes numeric DEFAULT 0, p_desconto numeric DEFAULT 0,
  p_iss_retido numeric DEFAULT 0, p_irrf numeric DEFAULT 0, p_pis numeric DEFAULT 0,
  p_cofins numeric DEFAULT 0, p_csll numeric DEFAULT 0, p_inss numeric DEFAULT 0,
  p_primeiro_vencimento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_n record; v_claims text; v_bruto numeric; v_tot jsonb; v_ret numeric; v_liq numeric;
  v_ped record; v_venc date; v_comp date; v_rid uuid; v_ids uuid[] := '{}'; v_grp uuid;
  v_np int; v_soma numeric; v_acc numeric := 0; v_parc numeric; v_cli_id uuid; v_cli_nome text;
  -- CASO A (re-preço líquido):
  v_tem_titulo boolean; v_repriced int := 0; v_skipped jsonb := '[]'::jsonb;
  v_ret_share numeric; v_liq_titulo numeric; v_elegivel boolean;
BEGIN
  SELECT * INTO v_n FROM erp_nfse_emitidas WHERE id = p_nfse_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota_inexistente'); END IF;

  -- guarda por empresa (jwt vazio = servidor/cron confiável; senão, membro ou admin)
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL AND v_claims <> '' THEN
    IF NOT (v_n.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_empresa');
    END IF;
  END IF;

  IF v_n.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nota_nao_autorizada', 'status', v_n.status);
  END IF;
  -- idempotência (guarda 5 do roteiro): não gerar duas vezes
  IF v_n.financeiro_gerado THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'financeiro_ja_gerado', 'receber_id', v_n.erp_receber_id);
  END IF;

  -- #35 MEDIÇÃO: nota de parcelas escolhidas do pedido. Se a emissão foi "sem gerar o financeiro", as
  -- parcelas seguem 'previsto' — efetiva AGORA (previsto → aberto) só as desta nota, antes do re-preço.
  IF v_n.parcela_ids IS NOT NULL AND array_length(v_n.parcela_ids,1) IS NOT NULL
     AND COALESCE(v_n.efetivacao_status,'') <> 'ok' THEN
    UPDATE erp_nfse_emitidas SET efetivacao_status='pendente', atualizado_em=now() WHERE id=p_nfse_id;
    DECLARE v_ef jsonb; BEGIN
      v_ef := public.fn_nfse_efetivar_se_autorizada(p_nfse_id);
      IF COALESCE((v_ef->>'ok')::boolean, false) IS NOT TRUE THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'medicao_nao_efetivada', 'detalhe', v_ef);
      END IF;
    END;
  END IF;

  v_bruto := COALESCE(v_n.valor_bruto, v_n.valor_servicos, 0);
  v_tot := fn_nfse_retencoes_totalizar(v_bruto, p_deducoes, p_desconto, p_iss_retido, p_irrf, p_pis, p_cofins, p_csll, p_inss);
  v_ret := (v_tot->>'retencoes_total')::numeric;
  v_liq := (v_tot->>'valor_liquido')::numeric;
  v_comp := COALESCE(v_n.data_competencia, v_n.data_emissao::date, CURRENT_DATE);

  -- grava a decomposição na NOTA (informada pelo usuário nesta entrega)
  UPDATE erp_nfse_emitidas SET
    valor_bruto=v_bruto, valor_deducoes=COALESCE(p_deducoes,0), valor_desconto_incondicionado=COALESCE(p_desconto,0),
    valor_iss_retido=COALESCE(p_iss_retido,0), valor_irrf=COALESCE(p_irrf,0), valor_pis_ret=COALESCE(p_pis,0),
    valor_cofins_ret=COALESCE(p_cofins,0), valor_csll_ret=COALESCE(p_csll,0), valor_inss_ret=COALESCE(p_inss,0),
    valor_retencoes=v_ret, valor_liquido=v_liq, data_competencia=v_comp, atualizado_em=now()
  WHERE id=p_nfse_id;

  -- CASO A: já existe título para esta nota/pedido (faturado pelo fluxo OTC pelo BRUTO) → re-precifica pelo
  -- LÍQUIDO os elegíveis, sem duplicar. Dispara por erp_receber_id OU por pedido com título (anti-duplicata).
  v_tem_titulo := v_n.erp_receber_id IS NOT NULL
    OR (v_n.pedido_id IS NOT NULL AND EXISTS (SELECT 1 FROM erp_receber WHERE pedido_id=v_n.pedido_id AND deleted_at IS NULL));
  IF v_tem_titulo THEN
    DECLARE r record; BEGIN
      FOR r IN
        SELECT * FROM erp_receber
        WHERE deleted_at IS NULL
          AND ( (v_n.pedido_id IS NOT NULL AND pedido_id=v_n.pedido_id)
                OR (v_n.erp_receber_id IS NOT NULL AND id=v_n.erp_receber_id) )
          -- #35 MEDIÇÃO: só os títulos das parcelas DESTA nota (as outras medições têm a sua própria nota)
          AND (v_n.parcela_ids IS NULL OR array_length(v_n.parcela_ids,1) IS NULL OR pedido_parcela_id = ANY(v_n.parcela_ids))
        ORDER BY parcela NULLS FIRST, data_vencimento, id
      LOOP
        -- retenção/líquido proporcional ao BRUTO deste título sobre o BRUTO da nota
        v_ret_share := CASE WHEN v_bruto > 0 THEN round(v_ret * (r.valor / v_bruto), 2) ELSE 0 END;
        v_liq_titulo := round(r.valor - v_ret_share, 2);
        v_elegivel := r.status IN ('aberto','previsto','vencido')
          AND NOT EXISTS (SELECT 1 FROM erp_receber_baixa b WHERE b.receber_id=r.id AND b.deleted_at IS NULL);

        IF v_elegivel THEN
          UPDATE erp_receber SET
            nfse_id=p_nfse_id, numero_nf=COALESCE(numero_nf, v_n.numero), serie_nf=COALESCE(serie_nf, v_n.serie),
            valor_bruto_nf=r.valor, valor_retencoes_nf=v_ret_share, retencoes_nf=v_tot,
            valor        = CASE WHEN v_ret > 0 THEN v_liq_titulo ELSE valor END,
            valor_liquido= CASE WHEN v_ret > 0 THEN v_liq_titulo ELSE COALESCE(valor_liquido, r.valor) END,
            descricao    = CASE WHEN v_ret > 0
                             THEN left(COALESCE(descricao,'') || ' · valor ajustado p/ líquido da NFS-e nº ' || COALESCE(v_n.numero,'s/n'), 500)
                             ELSE descricao END,
            updated_at=now()
          WHERE id=r.id;
          v_repriced := v_repriced + 1;
        ELSE
          -- título com baixa/pagamento (ou status não-elegível): NÃO altera valor — só vincula à nota p/ rastreio.
          UPDATE erp_receber SET
            nfse_id=COALESCE(nfse_id, p_nfse_id), numero_nf=COALESCE(numero_nf, v_n.numero), serie_nf=COALESCE(serie_nf, v_n.serie),
            updated_at=now()
          WHERE id=r.id;
          v_skipped := v_skipped || jsonb_build_object(
            'receber_id', r.id, 'valor', r.valor, 'status', r.status,
            'motivo', 'título com baixa/pagamento — não re-precificado (protege a conciliação); ajuste manual se necessário');
        END IF;
        v_ids := array_append(v_ids, r.id);
      END LOOP;
    END;

    UPDATE erp_nfse_emitidas SET erp_receber_id=COALESCE(erp_receber_id, v_ids[1]), financeiro_gerado=true, atualizado_em=now() WHERE id=p_nfse_id;
    RETURN jsonb_build_object('ok', true, 'modo', 'reprecificado', 'receber_ids', to_jsonb(v_ids),
      'titulos_reprecificados', v_repriced, 'titulos_nao_alterados', v_skipped,
      'valor_bruto', v_bruto, 'valor_retencoes', v_ret, 'valor_liquido', v_liq);
  END IF;

  -- dados do cliente/pedido
  IF v_n.pedido_id IS NOT NULL THEN
    SELECT * INTO v_ped FROM erp_pedidos WHERE id=v_n.pedido_id;
    v_cli_id := v_ped.cliente_id; v_cli_nome := v_ped.cliente_nome;
  END IF;
  v_cli_nome := COALESCE(v_cli_nome, v_n.tomador_razao_social);

  -- CASO B: gerar título(s) pelo LÍQUIDO. Parcelamento: parcelas do pedido, senão à vista.
  v_grp := gen_random_uuid();
  IF v_n.pedido_id IS NOT NULL THEN
    SELECT count(*), COALESCE(sum(valor),0) INTO v_np, v_soma FROM erp_pedidos_parcelas WHERE pedido_id=v_n.pedido_id;
  ELSE
    v_np := 0;
  END IF;

  IF v_np > 0 AND v_soma > 0 THEN
    -- distribui o líquido proporcional ao valor de cada parcela (ajuste de arredondamento na última)
    DECLARE r record; v_i int := 0; BEGIN
      FOR r IN SELECT * FROM erp_pedidos_parcelas WHERE pedido_id=v_n.pedido_id ORDER BY numero, vencimento, id LOOP
        v_i := v_i + 1;
        IF v_i = v_np THEN v_parc := round(v_liq - v_acc, 2);
        ELSE v_parc := round(v_liq * (r.valor / v_soma), 2); v_acc := v_acc + v_parc; END IF;
        INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, data_competencia,
          valor, status, categoria, numero_documento, descricao, parcela, parcela_grupo_id,
          nfse_id, numero_nf, serie_nf, valor_bruto_nf, valor_retencoes_nf, retencoes_nf, pedido_id, pedido_parcela_id, created_at)
        VALUES (v_n.company_id, v_cli_id, v_cli_nome, v_comp, r.vencimento, v_comp,
          v_parc, 'aberto', 'Receita de serviços', 'NFSE '||COALESCE(v_n.numero,'s/n'),
          COALESCE(v_n.descricao_servico,'Serviço faturado por NFS-e'), v_i||'/'||v_np, v_grp,
          p_nfse_id, v_n.numero, v_n.serie, round(v_bruto*(r.valor/v_soma),2), round(v_ret*(r.valor/v_soma),2), v_tot,
          v_n.pedido_id, r.id, now())
        RETURNING id INTO v_rid;
        v_ids := array_append(v_ids, v_rid);
      END LOOP;
    END;
  ELSE
    v_venc := COALESCE(p_primeiro_vencimento, v_comp + 30);
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, data_competencia,
      valor, status, categoria, numero_documento, descricao, parcela,
      nfse_id, numero_nf, serie_nf, valor_bruto_nf, valor_retencoes_nf, retencoes_nf, pedido_id, created_at)
    VALUES (v_n.company_id, v_cli_id, v_cli_nome, v_comp, v_venc, v_comp,
      v_liq, 'aberto', 'Receita de serviços', 'NFSE '||COALESCE(v_n.numero,'s/n'),
      COALESCE(v_n.descricao_servico,'Serviço faturado por NFS-e'), '1/1',
      p_nfse_id, v_n.numero, v_n.serie, v_bruto, v_ret, v_tot, v_n.pedido_id, now())
    RETURNING id INTO v_rid;
    v_ids := array_append(v_ids, v_rid);
  END IF;

  -- vínculo bidirecional + marca idempotência
  UPDATE erp_nfse_emitidas SET erp_receber_id=v_ids[1], financeiro_gerado=true, atualizado_em=now() WHERE id=p_nfse_id;

  RETURN jsonb_build_object('ok', true, 'modo', 'gerado', 'receber_ids', to_jsonb(v_ids),
    'parcelas', COALESCE(NULLIF(v_np,0),1), 'valor_bruto', v_bruto, 'valor_retencoes', v_ret, 'valor_liquido', v_liq);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfse_medicao_validar(uuid, uuid, uuid[], numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_medicao_validar(uuid, uuid, uuid[], numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_nfse_medicao_vincular(uuid, uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_medicao_vincular(uuid, uuid, uuid[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_trg_nfse_medicao_efetivar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_nfse_gerar_financeiro(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_gerar_financeiro(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date) TO authenticated, service_role;
