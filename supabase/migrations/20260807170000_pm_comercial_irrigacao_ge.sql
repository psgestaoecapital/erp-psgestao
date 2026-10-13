-- P&M · Bloco COMERCIAL — irrigação da GE. Proposta aprovada nasce contrato recorrente em erp_contratos
-- (a engine + cron diário fatura); comissão aprovada vira erp_pagar. Reusa agency_* (nunca dropa).
-- RD-26 (colunas aditivas), RD-51 (dado real), RD-53 (não duplica financeiro — 1 fonte por título),
-- Pilar 2 (tudo filtra company_id). NOTA: contrato recorrente vive em erp_contratos (GE), não em
-- agency_contratos (legado; convergir depois sem dropar).

-- 1) Colunas aditivas (idempotência + rastro + tipo de comissão configurável)
ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS contrato_id uuid;      -- contrato GE gerado
ALTER TABLE public.agency_comissao  ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'unica'; -- unica | recorrente

-- ---------------------------------------------------------------------------
-- 2) LEAD ganho → cliente (se não houver) + proposta rascunho a partir do lead.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_ganhar(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_lead agency_leads%ROWTYPE; v_cli uuid; v_prop uuid; v_num text; v_seq int;
  v_pref text := 'PROP-' || to_char(current_date,'YYYY') || '-';
BEGIN
  SELECT * INTO v_lead FROM agency_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead não encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_cli := v_lead.cliente_id;
  IF v_cli IS NULL THEN
    INSERT INTO agency_clientes (company_id, nome, nome_fantasia, status, tipo_contrato)
    VALUES (v_lead.company_id, COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome),
            COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome), 'ativo', 'recorrente')
    RETURNING id INTO v_cli;
  END IF;

  UPDATE agency_leads SET etapa='ganho', cliente_id=v_cli, atualizado_em=now() WHERE id=p_lead_id;

  -- idempotência: reaproveita um rascunho já criado pra este cliente
  SELECT id INTO v_prop FROM agency_propostas
   WHERE company_id=v_lead.company_id AND cliente_id=v_cli AND status='rascunho'
   ORDER BY created_at DESC LIMIT 1;

  IF v_prop IS NULL THEN
    SELECT COALESCE(MAX((substring(numero from '\d+$'))::int),0)+1 INTO v_seq
      FROM agency_propostas WHERE company_id=v_lead.company_id AND numero LIKE v_pref||'%';
    v_num := v_pref || lpad(v_seq::text, 4, '0');
    INSERT INTO agency_propostas (company_id, cliente_id, numero, titulo, itens,
        valor_total, valor_final, condicao_pagamento, status, responsavel_id, observacoes)
    VALUES (v_lead.company_id, v_cli, v_num,
        'Proposta — ' || COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome),
        '[]'::jsonb, COALESCE(v_lead.valor_estimado,0), COALESCE(v_lead.valor_estimado,0),
        'Mensal', 'rascunho', v_lead.responsavel_id, 'Gerada do lead ' || v_lead.nome)
    RETURNING id INTO v_prop;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cliente_id', v_cli, 'proposta_id', v_prop);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_agency_lead_ganhar(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) PROPOSTA aprovada → contrato recorrente na GE (se fee>0) + comissão do comercial. Idempotente.
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_aprovar(
  p_proposta_id uuid,
  p_fee_mensal numeric DEFAULT NULL,
  p_dia_vencimento int DEFAULT 10,
  p_periodicidade text DEFAULT 'mensal',
  p_data_inicio date DEFAULT NULL,
  p_comissao_percentual numeric DEFAULT 0,
  p_comissao_tipo text DEFAULT 'unica',
  p_comissao_base text DEFAULT 'contrato'   -- 'contrato' (valor_final) | 'fee' (fee mensal)
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_p agency_propostas%ROWTYPE; v_cli agency_clientes%ROWTYPE;
  v_fee numeric; v_ini date; v_contrato uuid; v_num text;
  v_base numeric; v_pct numeric; v_valcom numeric; v_comissao uuid;
BEGIN
  SELECT * INTO v_p FROM agency_propostas WHERE id = p_proposta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- idempotência: já aprovada → devolve o que existe (não duplica contrato nem comissão)
  IF v_p.status = 'aprovada' THEN
    SELECT id INTO v_comissao FROM agency_comissao WHERE proposta_id=p_proposta_id ORDER BY criado_em LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'ja_aprovada', true, 'contrato_id', v_p.contrato_id, 'comissao_id', v_comissao);
  END IF;

  SELECT * INTO v_cli FROM agency_clientes WHERE id = v_p.cliente_id;
  v_fee := COALESCE(p_fee_mensal, v_p.valor_final, 0);
  v_ini := COALESCE(p_data_inicio, current_date);

  -- 3a) contrato recorrente na GE (só faz sentido com fee mensal > 0 — o cron fatura recorrente)
  IF v_fee > 0 THEN
    v_num := next_contrato_numero(v_p.company_id);
    INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj,
        cliente_email, cliente_telefone, tipo, nome, descricao, valor_mensal, valor_atual,
        data_inicio, dia_vencimento, periodicidade, status, forma_pagamento, responsavel, observacoes)
    VALUES (v_p.company_id, v_num, NULL, COALESCE(v_cli.nome_fantasia, v_cli.nome, 'Cliente'),
        v_cli.cnpj_cpf, v_cli.email, v_cli.telefone, 'agencia_pm', v_p.titulo, v_p.descricao,
        v_fee, v_fee, v_ini, COALESCE(p_dia_vencimento,10), COALESCE(p_periodicidade,'mensal'),
        'ativo', 'boleto', NULL, 'Gerado da proposta ' || COALESCE(v_p.numero, v_p.id::text))
    RETURNING id INTO v_contrato;

    IF v_p.cliente_id IS NOT NULL THEN
      UPDATE agency_clientes SET contrato_id=v_contrato, fee_mensal=v_fee, updated_at=now()
      WHERE id=v_p.cliente_id;
    END IF;
  END IF;

  -- 3b) comissão do comercial (única, por ora; base configurável)
  v_pct  := COALESCE(p_comissao_percentual, 0);
  v_base := CASE WHEN p_comissao_base='fee' THEN v_fee ELSE COALESCE(v_p.valor_final,0) END;
  v_valcom := round(v_base * v_pct / 100.0, 2);
  INSERT INTO agency_comissao (company_id, proposta_id, vendedor_id, base_valor, percentual,
      valor_comissao, competencia, status, tipo)
  VALUES (v_p.company_id, p_proposta_id, v_p.responsavel_id, v_base, v_pct, v_valcom,
      date_trunc('month', v_ini)::date, 'prevista', COALESCE(p_comissao_tipo,'unica'))
  RETURNING id INTO v_comissao;

  UPDATE agency_propostas
     SET status='aprovada', data_aprovacao=now(), contrato_id=v_contrato, updated_at=now()
   WHERE id=p_proposta_id;

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_contrato, 'contrato_numero', v_num,
    'comissao_id', v_comissao, 'valor_comissao', v_valcom, 'fee_mensal', v_fee);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, int, text, date, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) COMISSÃO aprovada → erp_pagar (a pagar no financeiro). Idempotente (não duplica lançamento).
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_aprovar(p_comissao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_c agency_comissao%ROWTYPE; v_vend text; v_prop text; v_pagar uuid;
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_comissao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  IF v_c.lancamento_id IS NOT NULL THEN  -- idempotente
    RETURN jsonb_build_object('ok', true, 'ja_lancada', true, 'pagar_id', v_c.lancamento_id);
  END IF;

  SELECT COALESCE(full_name, email) INTO v_vend FROM users WHERE id = v_c.vendedor_id;
  SELECT numero INTO v_prop FROM agency_propostas WHERE id = v_c.proposta_id;

  INSERT INTO erp_pagar (company_id, descricao, categoria, valor, data_vencimento, status,
      linha_negocio, observacoes)
  VALUES (v_c.company_id,
      'Comissão comercial' || COALESCE(' · ' || v_vend, '') || COALESCE(' · ' || v_prop, ''),
      'Comissões', COALESCE(v_c.valor_comissao,0),
      GREATEST(COALESCE(v_c.competencia, current_date), current_date), 'aberto', 'pm_comercial',
      'Comissão da proposta ' || COALESCE(v_prop, v_c.proposta_id::text))
  RETURNING id INTO v_pagar;

  UPDATE agency_comissao SET status='a_pagar', lancamento_id=v_pagar WHERE id=p_comissao_id;

  RETURN jsonb_build_object('ok', true, 'pagar_id', v_pagar, 'valor', COALESCE(v_c.valor_comissao,0));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_aprovar(uuid) TO authenticated;
