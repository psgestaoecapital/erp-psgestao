-- PEDIDO 1 (CEO/Rodrigo · Vender e Faturar) — "NFS-e primeiro → financeiro pelo LÍQUIDO", MESMO critério
-- que a FC Pisos (#1712-#1716). A fórmula de líquido já é única (fn_nfse_retencoes_totalizar), usada pelo
-- CASO B e pela tela da FC. O gap era só o CASO A: quando o pedido JÁ tinha título (faturado pelo fluxo OTC
-- pelo BRUTO), o fn_nfse_gerar_financeiro apenas vinculava e carimbava valor_bruto_nf/valor_retencoes_nf/
-- retencoes_nf, mas mantinha `valor` = BRUTO. Resultado: a previsão de caixa mentia (o tomador recolhe a
-- retenção, ela não chega na conta). Duas telas, dois comportamentos para a mesma coisa.
--
-- Correção ADITIVA (Opção A do CEO): o CASO A passa a RE-PRECIFICAR o(s) título(s) do pedido para o LÍQUIDO
-- quando a nota tem retenção, distribuindo proporcional ao bruto de cada título, e preenchendo os 3 campos
-- de rastreabilidade. Regras decididas pelo CEO:
--   • só re-precifica título ELEGÍVEL: status IN ('aberto','previsto','vencido') E SEM baixa em erp_receber_baixa.
--     Título com baixa/pagamento NÃO é tocado (a baixa tem crédito bancário conciliado por trás — mexer
--     desfaz a conciliação do saneamento de ontem);
--   • os títulos NÃO alterados voltam no retorno (titulos_nao_alterados), com motivo — o operador decide,
--     nada some em silêncio;
--   • o título re-precificado ganha na descrição "valor ajustado p/ líquido da NFS-e nº X" (rastreabilidade);
--   • SEM retenção → comportamento inalterado (só carimba/vincula, valor intacto) — o caso mais comum.
-- Anti-duplicata: o CASO A agora dispara também quando o PEDIDO já tem título (não só quando a nota tem
-- erp_receber_id), então um pedido faturado NUNCA cai no CASO B (que criaria títulos novos = recebível dobrado).
--
-- Resto da função (guardas, idempotência, decomposição na nota, CASO B, à vista) reproduzido IDÊNTICO.

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

-- Guardas (check-fn-guards): SECURITY DEFINER fechada ao anon. (Autoria não vem de p_user — regra 2 N/A.)
REVOKE ALL ON FUNCTION public.fn_nfse_gerar_financeiro(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_gerar_financeiro(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date) TO authenticated, service_role;
