-- NFS-e PRIMEIRO → financeiro pelo VALOR LÍQUIDO (Vender e faturar) — Etapa 1 (banco).
-- CEO 23/09: a nota vem primeiro; o financeiro nasce dela, pelo LÍQUIDO (o que a empresa
-- realmente recebe). Entrega 1: retenções INFORMADAS PELO USUÁRIO (entrega 2 sugere pela
-- configuração fiscal). Guardar na nota e no título, separadamente: bruto, cada retenção e líquido.
--
-- Fronteira desta migration (só banco): colunas de decomposição + funções idempotentes.
--   • fn_nfse_retencoes_totalizar  — pura: soma retenções e devolve líquido (para prévia da tela).
--   • fn_nfse_gerar_financeiro     — a partir de uma NFS-e AUTORIZADA cria erp_receber pelo LÍQUIDO,
--                                     vínculo bidirecional, idempotente; se a nota já tem título
--                                     (pedido já faturado), vincula sem duplicar.
--   • fn_nfse_estornar_financeiro  — cancelamento da nota: estorna o título (nunca apaga em silêncio).
--
-- Retenções: nesta entrega os VALORES vêm do usuário (parâmetros). A regra de quais se aplicam
-- (entrega 2) virá do perfil/configuração fiscal + tomador — nada fixado no código aqui.

-- ─────────────────────────── Colunas de decomposição ───────────────────────────
ALTER TABLE public.erp_nfse_emitidas
  ADD COLUMN IF NOT EXISTS valor_bruto numeric,
  ADD COLUMN IF NOT EXISTS valor_deducoes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_desconto_incondicionado numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_iss_retido numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_irrf numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_pis_ret numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_cofins_ret numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_csll_ret numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_inss_ret numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_retencoes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_liquido numeric,
  ADD COLUMN IF NOT EXISTS data_competencia date,
  ADD COLUMN IF NOT EXISTS financeiro_gerado boolean NOT NULL DEFAULT false;

-- erp_receber: decomposição da nota (o próprio 'valor' do título já é o LÍQUIDO).
-- Obs.: NÃO reutilizar erp_receber.valor_liquido (esse é repasse de cartão/adquirente, RD-65).
ALTER TABLE public.erp_receber
  ADD COLUMN IF NOT EXISTS valor_bruto_nf numeric,
  ADD COLUMN IF NOT EXISTS valor_retencoes_nf numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencoes_nf jsonb,
  ADD COLUMN IF NOT EXISTS serie_nf text;

-- ─────────────────────────── Totalizador (prévia da tela) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfse_retencoes_totalizar(
  p_valor_bruto numeric, p_deducoes numeric, p_desconto numeric,
  p_iss_retido numeric, p_irrf numeric, p_pis numeric, p_cofins numeric, p_csll numeric, p_inss numeric
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $function$
  SELECT jsonb_build_object(
    'valor_bruto', COALESCE(p_valor_bruto,0),
    'deducoes', COALESCE(p_deducoes,0),
    'desconto_incondicionado', COALESCE(p_desconto,0),
    'iss_retido', COALESCE(p_iss_retido,0),
    'irrf', COALESCE(p_irrf,0),
    'pis', COALESCE(p_pis,0),
    'cofins', COALESCE(p_cofins,0),
    'csll', COALESCE(p_csll,0),
    'inss', COALESCE(p_inss,0),
    'retencoes_total', COALESCE(p_iss_retido,0)+COALESCE(p_irrf,0)+COALESCE(p_pis,0)+COALESCE(p_cofins,0)+COALESCE(p_csll,0)+COALESCE(p_inss,0),
    'valor_liquido', GREATEST(0, COALESCE(p_valor_bruto,0)-COALESCE(p_deducoes,0)-COALESCE(p_desconto,0)
       -(COALESCE(p_iss_retido,0)+COALESCE(p_irrf,0)+COALESCE(p_pis,0)+COALESCE(p_cofins,0)+COALESCE(p_csll,0)+COALESCE(p_inss,0)))
  );
$function$;

-- ─────────────────────────── Gerar financeiro a partir da nota ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfse_gerar_financeiro(
  p_nfse_id uuid,
  p_deducoes numeric DEFAULT 0,
  p_desconto numeric DEFAULT 0,
  p_iss_retido numeric DEFAULT 0,
  p_irrf numeric DEFAULT 0,
  p_pis numeric DEFAULT 0,
  p_cofins numeric DEFAULT 0,
  p_csll numeric DEFAULT 0,
  p_inss numeric DEFAULT 0,
  p_primeiro_vencimento date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_n record; v_claims text; v_bruto numeric; v_tot jsonb; v_ret numeric; v_liq numeric;
  v_ped record; v_venc date; v_comp date; v_rid uuid; v_ids uuid[] := '{}'; v_grp uuid;
  v_np int; v_soma numeric; v_acc numeric := 0; v_parc numeric; v_cli_id uuid; v_cli_nome text;
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

  -- CASO A: nota já ligada a um título (pedido faturado pelo fluxo atual) → vincula sem duplicar
  IF v_n.erp_receber_id IS NOT NULL THEN
    UPDATE erp_receber SET
      nfse_id=p_nfse_id, numero_nf=COALESCE(numero_nf, v_n.numero), serie_nf=COALESCE(serie_nf, v_n.serie),
      valor_bruto_nf=v_bruto, valor_retencoes_nf=v_ret, retencoes_nf=v_tot, updated_at=now()
    WHERE id=v_n.erp_receber_id;
    UPDATE erp_nfse_emitidas SET financeiro_gerado=true, atualizado_em=now() WHERE id=p_nfse_id;
    RETURN jsonb_build_object('ok', true, 'modo', 'vinculado', 'receber_id', v_n.erp_receber_id,
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

-- ─────────────────────────── Estorno (cancelamento da nota) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfse_estornar_financeiro(p_nfse_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_n record; v_claims text; v_estornados int; v_pagos int;
BEGIN
  SELECT * INTO v_n FROM erp_nfse_emitidas WHERE id=p_nfse_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota_inexistente'); END IF;
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL AND v_claims <> '' THEN
    IF NOT (v_n.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_empresa');
    END IF;
  END IF;
  IF NOT v_n.financeiro_gerado THEN
    RETURN jsonb_build_object('ok', true, 'modo', 'nada_a_estornar');
  END IF;

  -- não estornar em silêncio títulos já pagos/parciais — sinaliza para decisão humana
  SELECT count(*) INTO v_pagos FROM erp_receber
    WHERE nfse_id=p_nfse_id AND company_id=v_n.company_id AND status IN ('pago','parcial');
  IF v_pagos > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'titulo_com_baixa', 'pagos', v_pagos,
      'aviso', 'Há título já recebido (total/parcial) ligado a esta nota. Trate a baixa antes de estornar.');
  END IF;

  UPDATE erp_receber SET status='cancelado', observacoes=COALESCE(observacoes,'')||' [estorno NFS-e cancelada'||COALESCE(': '||p_motivo,'')||']', updated_at=now()
    WHERE nfse_id=p_nfse_id AND company_id=v_n.company_id AND status NOT IN ('pago','parcial','cancelado');
  GET DIAGNOSTICS v_estornados = ROW_COUNT;
  UPDATE erp_nfse_emitidas SET financeiro_gerado=false, atualizado_em=now() WHERE id=p_nfse_id;

  RETURN jsonb_build_object('ok', true, 'modo', 'estornado', 'estornados', v_estornados);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfse_gerar_financeiro(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_nfse_estornar_financeiro(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_gerar_financeiro(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nfse_estornar_financeiro(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nfse_retencoes_totalizar(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated, service_role, anon;
