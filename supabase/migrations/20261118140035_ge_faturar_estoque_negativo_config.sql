-- GE · Chamado #8453 (M.m Serviços) — Faturar com estoque negativo: config por empresa.
-- NÚCLEO FINANCEIRO. Code: code-desenvolvedor-3.
--
-- Hoje: fn_faturar / fn_faturar_efetivar dão baixa direto e deixam o estoque ir NEGATIVO em silêncio
-- (enquanto a movimentação manual bloqueia). Inconsistente e sem controle por empresa.
--
-- Entrega (ADITIVA, idempotente, company-scoped, default = comportamento atual):
--   1) companies.estoque_venda_negativo  text  DEFAULT 'avisar'  CHECK (bloquear|avisar|liberar)
--   2) fn_faturar / fn_faturar_efetivar: no ponto de cada baixa de estoque, quando o saldo RESULTANTE
--      ficaria < 0:
--        - 'bloquear' -> erro claro (produto, saldo atual, baixa, saldo resultante); nota NÃO efetivada,
--                        nenhuma baixa gravada (a transação inteira faz rollback no RAISE).
--        - 'avisar' (PADRÃO) -> efetiva normal e acumula os itens negativos em 'avisos' no retorno jsonb
--                        (a UI mostra o alerta ao operador).
--        - 'liberar' -> comportamento atual (silencioso).
--      O retorno jsonb ganha 'avisos' (array) e 'estoque_negativo_modo'. Demais efeitos INALTERADOS.
--   3) RPCs company-scoped p/ a tela de Configurações ler/gravar a flag (padrão do ie_isento; a tela
--      nunca lê companies direto).
--   4) RD-95: chave de ajuda do campo.
--
-- DEFAULT 'avisar' = o chamado pediu 'avisar' como padrão; não quebra quem fatura hoje (continua
-- efetivando), só passa a devolver o aviso. Quem quiser o silêncio de antes usa 'liberar'.

-- 1) coluna de config por empresa -------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS estoque_venda_negativo text NOT NULL DEFAULT 'avisar';

-- Normaliza qualquer valor fora do domínio ANTES do CHECK (tabela pequena — companies por empresa).
UPDATE public.companies
  SET estoque_venda_negativo = 'avisar'
  WHERE estoque_venda_negativo IS NULL
     OR lower(trim(estoque_venda_negativo)) NOT IN ('bloquear','avisar','liberar');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_estoque_venda_negativo_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_estoque_venda_negativo_chk
      CHECK (estoque_venda_negativo IN ('bloquear','avisar','liberar'));
  END IF;
END $$;

-- 2a) fn_faturar_efetivar — guarda de estoque negativo por empresa -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_faturar_efetivar(p_pedido_id uuid, p_parcela_ids uuid[], p_valor_nota numeric DEFAULT NULL::numeric, p_numero_nf text DEFAULT NULL::text, p_nfse_id uuid DEFAULT NULL::uuid, p_data_emissao date DEFAULT CURRENT_DATE, p_local_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped record; v_local_id uuid; v_item record; v_bom record;
  v_qtd_antes numeric; v_custo numeric; v_qtd_baixa numeric;
  v_cmv numeric := 0; v_n_mov int := 0; v_primeira boolean;
  v_soma_sel numeric; v_tol numeric; v_frac numeric; v_par uuid;
  v_n_efet int := 0; v_restam int;
  v_neg_cfg text; v_avisos jsonb := '[]'::jsonb; v_depois numeric;  -- #8453: config estoque negativo
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;

  -- SEGURANÇA (RD-52/IDOR): mesma guarda do fn_faturar — sessão precisa ter vínculo com a empresa do
  -- pedido (ou ser admin); chamada interna sem JWT (service_role) passa.
  IF auth.role() <> 'service_role'
     AND NOT public.is_admin()
     AND v_ped.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_ped.status = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado nao pode ser faturado'; END IF;
  IF p_parcela_ids IS NULL OR array_length(p_parcela_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Nenhuma parcela marcada para efetivar'; END IF;

  -- #8453: modo de estoque negativo da empresa (default seguro = 'avisar')
  SELECT lower(COALESCE(NULLIF(trim(estoque_venda_negativo),''),'avisar')) INTO v_neg_cfg
    FROM companies WHERE id = v_ped.company_id;
  IF v_neg_cfg NOT IN ('bloquear','avisar','liberar') THEN v_neg_cfg := 'avisar'; END IF;

  SELECT COALESCE(sum(valor),0) INTO v_soma_sel
    FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id AND id = ANY(p_parcela_ids);

  -- D#2: valor da nota (quando informado) tem que bater com as parcelas marcadas
  IF p_valor_nota IS NOT NULL THEN
    v_tol := 0.01 * GREATEST(array_length(p_parcela_ids,1),1);
    IF abs(v_soma_sel - p_valor_nota) > v_tol THEN
      RAISE EXCEPTION 'As parcelas marcadas somam R$ % mas a nota é de R$ %. Marque as parcelas que batem com a nota (ou emita a nota pelo valor das parcelas).',
        to_char(v_soma_sel,'FM999999990.00'), to_char(p_valor_nota,'FM999999990.00');
    END IF;
  END IF;

  -- local de estoque (igual fn_faturar)
  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id FROM erp_estoque_locais
     WHERE company_id = v_ped.company_id AND COALESCE(principal,false)=true AND COALESCE(ativo,true)=true LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_ped.company_id, 'Estoque Principal', true, true) RETURNING id INTO v_local_id;
  END IF;

  -- primeira efetivação do pedido? (produto integral só na 1ª — D#3b)
  v_primeira := NOT EXISTS (SELECT 1 FROM erp_receber WHERE pedido_id=p_pedido_id AND deleted_at IS NULL AND status<>'previsto');
  -- fração desta nota sobre o total do pedido (serviço proporcional — D-1)
  v_frac := CASE WHEN COALESCE(v_ped.total,0) > 0 THEN v_soma_sel / v_ped.total ELSE 0 END;

  -- (a) efetiva os títulos das parcelas marcadas
  FOREACH v_par IN ARRAY p_parcela_ids LOOP
    UPDATE erp_receber SET status='aberto', data_emissao=p_data_emissao,
        data_competencia=COALESCE(data_competencia, p_data_emissao),
        numero_nf=COALESCE(p_numero_nf, numero_nf), nfse_id=COALESCE(p_nfse_id, nfse_id), updated_at=now()
      WHERE pedido_id=p_pedido_id AND pedido_parcela_id=v_par AND status='previsto' AND deleted_at IS NULL;
    IF FOUND THEN
      v_n_efet := v_n_efet + 1;
    ELSIF NOT EXISTS (SELECT 1 FROM erp_receber WHERE pedido_id=p_pedido_id AND pedido_parcela_id=v_par AND deleted_at IS NULL) THEN
      -- fail-open: sem previsto e sem título → cria 'aberto' (legado)
      INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
          status, categoria, numero_documento, descricao, forma_pagamento, conta_bancaria_id,
          pedido_id, pedido_parcela_id, numero_nf, nfse_id, created_at)
      SELECT v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, p_data_emissao, pp.vencimento, pp.valor,
          'aberto', 'Receita de vendas', COALESCE(v_ped.numero,'')||' '||pp.numero,
          'Pedido '||COALESCE(v_ped.numero,'')||' - parcela '||pp.numero, pp.forma_pagamento, pp.conta_bancaria_id,
          p_pedido_id, pp.id, p_numero_nf, p_nfse_id, now()
      FROM erp_pedidos_parcelas pp WHERE pp.id=v_par AND pp.pedido_id=p_pedido_id;
      IF FOUND THEN v_n_efet := v_n_efet + 1; END IF;
    END IF;  -- else: parcela já efetivada antes → ignora (não duplica)
  END LOOP;

  -- (b) estoque por item
  FOR v_item IN
    SELECT tipo_item, produto_id, produto_nome, servico_id, servico_descricao, COALESCE(quantidade,0)::numeric AS quantidade
    FROM erp_pedidos_itens WHERE pedido_id=p_pedido_id ORDER BY ordem NULLS LAST, id
  LOOP
    IF v_item.tipo_item='produto' AND v_item.produto_id IS NOT NULL AND v_item.quantidade>0 AND v_primeira THEN
      SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0) INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id=v_item.produto_id;
      v_depois := v_qtd_antes - v_item.quantidade;
      IF v_depois < 0 THEN  -- #8453
        IF v_neg_cfg='bloquear' THEN
          RAISE EXCEPTION 'Estoque insuficiente para faturar "%": saldo atual %, baixa %, saldo resultante %. Ajuste o estoque ou mude a regra de estoque negativo em Configurações › Empresa.',
            COALESCE(v_item.produto_nome,'produto'), v_qtd_antes, v_item.quantidade, v_depois USING ERRCODE='23514';
        ELSIF v_neg_cfg='avisar' THEN
          v_avisos := v_avisos || jsonb_build_object('produto_id',v_item.produto_id,'produto',v_item.produto_nome,'saldo_antes',v_qtd_antes,'baixa',v_item.quantidade,'saldo_depois',v_depois);
        END IF;
      END IF;
      INSERT INTO erp_estoque_movimentacoes (company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois, custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento)
      VALUES (v_ped.company_id, v_item.produto_id, v_local_id, 'venda', 'Faturamento pedido '||COALESCE(v_ped.numero,''),
        v_item.quantidade, v_qtd_antes, v_depois, v_custo, v_item.quantidade*v_custo,
        'pedido', v_ped.id, v_ped.numero, auth.uid(), now());
      UPDATE erp_produtos SET estoque_atual=v_depois, updated_at=now() WHERE id=v_item.produto_id;
      v_cmv := v_cmv + v_item.quantidade*v_custo; v_n_mov := v_n_mov + 1;
    ELSIF v_item.tipo_item='servico' AND v_item.servico_id IS NOT NULL AND v_frac>0 THEN
      FOR v_bom IN SELECT produto_id, produto_nome, COALESCE(quantidade_padrao,1)::numeric AS qpad
                   FROM erp_servicos_produtos WHERE servico_id=v_item.servico_id AND produto_id IS NOT NULL LOOP
        v_qtd_baixa := v_bom.qpad * v_item.quantidade * v_frac;   -- PROPORCIONAL à nota (D-1)
        IF v_qtd_baixa <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0) INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id=v_bom.produto_id;
        v_depois := v_qtd_antes - v_qtd_baixa;
        IF v_depois < 0 THEN  -- #8453
          IF v_neg_cfg='bloquear' THEN
            RAISE EXCEPTION 'Estoque insuficiente para faturar "%" (insumo de %): saldo atual %, baixa %, saldo resultante %. Ajuste o estoque ou mude a regra de estoque negativo em Configurações › Empresa.',
              COALESCE(v_bom.produto_nome,'produto'), COALESCE(v_item.servico_descricao,'servico'), v_qtd_antes, round(v_qtd_baixa,4), round(v_depois,4) USING ERRCODE='23514';
          ELSIF v_neg_cfg='avisar' THEN
            v_avisos := v_avisos || jsonb_build_object('produto_id',v_bom.produto_id,'produto',v_bom.produto_nome,'servico',v_item.servico_descricao,'saldo_antes',v_qtd_antes,'baixa',round(v_qtd_baixa,4),'saldo_depois',round(v_depois,4));
          END IF;
        END IF;
        INSERT INTO erp_estoque_movimentacoes (company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois, custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento)
        VALUES (v_ped.company_id, v_bom.produto_id, v_local_id, 'venda',
          'Faturamento pedido '||COALESCE(v_ped.numero,'')||' (BOM '||COALESCE(v_item.servico_descricao,'servico')||' · medição '||to_char(v_frac*100,'FM990.0')||'%)',
          v_qtd_baixa, v_qtd_antes, v_depois, v_custo, v_qtd_baixa*v_custo,
          'pedido', v_ped.id, v_ped.numero, auth.uid(), now());
        UPDATE erp_produtos SET estoque_atual=v_depois, updated_at=now() WHERE id=v_bom.produto_id;
        v_cmv := v_cmv + v_qtd_baixa*v_custo; v_n_mov := v_n_mov + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- (c) status do pedido
  v_restam := (SELECT count(*) FROM erp_receber WHERE pedido_id=p_pedido_id AND status='previsto' AND deleted_at IS NULL);
  UPDATE erp_pedidos SET
    status = CASE WHEN v_restam=0 THEN 'faturado' ELSE 'faturamento_parcial' END,
    data_faturamento = COALESCE(data_faturamento, now()),
    titulos_gerados = CASE WHEN v_restam=0 THEN true ELSE COALESCE(titulos_gerados,false) END,
    cmv = COALESCE(cmv,0) + v_cmv, updated_at=now()
  WHERE id=p_pedido_id;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'numero',v_ped.numero,
    'parcelas_efetivadas',v_n_efet,'fracao_nota',round(v_frac,4),'primeira_efetivacao',v_primeira,
    'cmv_desta_nota',v_cmv,'movimentos_estoque',v_n_mov,'restam_previstos',v_restam,
    'estoque_negativo_modo',v_neg_cfg,'avisos',v_avisos,  -- #8453
    'status_pedido', CASE WHEN v_restam=0 THEN 'faturado' ELSE 'faturamento_parcial' END);
END $function$;

-- 2b) fn_faturar — guarda no corpo legado (sem previsão). Quando há previsão, delega ao efetivar acima
-- (que já carrega a guarda), então o retorno dele já traz 'avisos'. --------------------------------
CREATE OR REPLACE FUNCTION public.fn_faturar(p_pedido_id uuid, p_local_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped record; v_local_id uuid; v_item record; v_bom record;
  v_qtd_antes numeric; v_custo numeric; v_qtd_baixa numeric;
  v_cmv numeric := 0; v_movs jsonb := '[]'::jsonb; v_n_mov int := 0;
  v_parc record; v_rec_ids uuid[] := ARRAY[]::uuid[]; v_rec_id uuid; v_n_parc int := 0;
  v_tot_parc int;
  v_neg_cfg text; v_avisos jsonb := '[]'::jsonb; v_depois numeric;  -- #8453
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;

  -- SEGURANÇA (RD-52/IDOR): esta função é SECURITY DEFINER e estava com EXECUTE para anon SEM guarda de
  -- empresa — qualquer um com a anon key e um pedido_id faturava pedido de QUALQUER empresa (gerava
  -- erp_receber, baixava estoque). Exige que a SESSÃO (auth.uid()) tenha vínculo com a empresa do pedido,
  -- ou seja admin. Chamada interna sem JWT (service_role) passa — auth.role() nulo/serviço não entra aqui.
  IF auth.role() <> 'service_role'
     AND NOT public.is_admin()
     AND v_ped.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- ETAPA3: se o pedido já tem PREVISÃO, faturar = EFETIVAR todas as parcelas (não duplica títulos).
  IF EXISTS (SELECT 1 FROM erp_receber WHERE pedido_id=p_pedido_id AND status='previsto' AND deleted_at IS NULL) THEN
    RETURN public.fn_faturar_efetivar(
      p_pedido_id,
      ARRAY(SELECT id FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id ORDER BY numero),
      NULL, NULL, NULL, CURRENT_DATE, p_local_id);
  END IF;

  -- ===== corpo legado (pedido SEM previsão) — guarda de estoque negativo (#8453) =====
  IF v_ped.status = 'faturado' OR COALESCE(v_ped.titulos_gerados,false) THEN
    RAISE EXCEPTION 'Pedido % ja foi faturado', v_ped.numero;
  END IF;
  IF v_ped.status = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado nao pode ser faturado'; END IF;

  -- #8453: modo de estoque negativo da empresa (default seguro = 'avisar')
  SELECT lower(COALESCE(NULLIF(trim(estoque_venda_negativo),''),'avisar')) INTO v_neg_cfg
    FROM companies WHERE id = v_ped.company_id;
  IF v_neg_cfg NOT IN ('bloquear','avisar','liberar') THEN v_neg_cfg := 'avisar'; END IF;

  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id FROM erp_estoque_locais
    WHERE company_id = v_ped.company_id AND COALESCE(principal,false)=true AND COALESCE(ativo,true)=true LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_ped.company_id, 'Estoque Principal', true, true) RETURNING id INTO v_local_id;
  END IF;

  FOR v_item IN
    SELECT tipo_item, produto_id, produto_nome, servico_id, servico_descricao,
           COALESCE(quantidade,0)::numeric AS quantidade
    FROM erp_pedidos_itens WHERE pedido_id = p_pedido_id ORDER BY ordem NULLS LAST, id
  LOOP
    IF v_item.tipo_item = 'produto' AND v_item.produto_id IS NOT NULL AND v_item.quantidade > 0 THEN
      SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
        INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_item.produto_id;
      v_depois := v_qtd_antes - v_item.quantidade;
      IF v_depois < 0 THEN  -- #8453
        IF v_neg_cfg='bloquear' THEN
          RAISE EXCEPTION 'Estoque insuficiente para faturar "%": saldo atual %, baixa %, saldo resultante %. Ajuste o estoque ou mude a regra de estoque negativo em Configurações › Empresa.',
            COALESCE(v_item.produto_nome,'produto'), v_qtd_antes, v_item.quantidade, v_depois USING ERRCODE='23514';
        ELSIF v_neg_cfg='avisar' THEN
          v_avisos := v_avisos || jsonb_build_object('produto_id',v_item.produto_id,'produto',v_item.produto_nome,'saldo_antes',v_qtd_antes,'baixa',v_item.quantidade,'saldo_depois',v_depois);
        END IF;
      END IF;
      INSERT INTO erp_estoque_movimentacoes (
        company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
        custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento
      ) VALUES (
        v_ped.company_id, v_item.produto_id, v_local_id, 'venda',
        'Faturamento pedido ' || COALESCE(v_ped.numero,''),
        v_item.quantidade, v_qtd_antes, v_depois,
        v_custo, v_item.quantidade * v_custo, 'pedido', v_ped.id, v_ped.numero, auth.uid(), now()
      );
      UPDATE erp_produtos SET estoque_atual = v_depois, updated_at = now()
        WHERE id = v_item.produto_id;
      v_cmv := v_cmv + v_item.quantidade * v_custo; v_n_mov := v_n_mov + 1;
      v_movs := v_movs || jsonb_build_object('origem','produto','produto_id',v_item.produto_id,'nome',v_item.produto_nome,'qtd',v_item.quantidade,'antes',v_qtd_antes,'depois',v_depois,'custo',v_custo);

    ELSIF v_item.tipo_item = 'servico' AND v_item.servico_id IS NOT NULL THEN
      FOR v_bom IN
        SELECT produto_id, produto_nome, COALESCE(quantidade_padrao,1)::numeric AS qpad
        FROM erp_servicos_produtos WHERE servico_id = v_item.servico_id AND produto_id IS NOT NULL
      LOOP
        v_qtd_baixa := v_bom.qpad * v_item.quantidade;
        IF v_qtd_baixa <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
          INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_bom.produto_id;
        v_depois := v_qtd_antes - v_qtd_baixa;
        IF v_depois < 0 THEN  -- #8453
          IF v_neg_cfg='bloquear' THEN
            RAISE EXCEPTION 'Estoque insuficiente para faturar "%" (insumo de %): saldo atual %, baixa %, saldo resultante %. Ajuste o estoque ou mude a regra de estoque negativo em Configurações › Empresa.',
              COALESCE(v_bom.produto_nome,'produto'), COALESCE(v_item.servico_descricao,'servico'), v_qtd_antes, round(v_qtd_baixa,4), round(v_depois,4) USING ERRCODE='23514';
          ELSIF v_neg_cfg='avisar' THEN
            v_avisos := v_avisos || jsonb_build_object('produto_id',v_bom.produto_id,'produto',v_bom.produto_nome,'servico',v_item.servico_descricao,'saldo_antes',v_qtd_antes,'baixa',round(v_qtd_baixa,4),'saldo_depois',round(v_depois,4));
          END IF;
        END IF;
        INSERT INTO erp_estoque_movimentacoes (
          company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
          custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento
        ) VALUES (
          v_ped.company_id, v_bom.produto_id, v_local_id, 'venda',
          'Faturamento pedido ' || COALESCE(v_ped.numero,'') || ' (BOM ' || COALESCE(v_item.servico_descricao,'servico') || ')',
          v_qtd_baixa, v_qtd_antes, v_depois,
          v_custo, v_qtd_baixa * v_custo, 'pedido', v_ped.id, v_ped.numero, auth.uid(), now()
        );
        UPDATE erp_produtos SET estoque_atual = v_depois, updated_at = now()
          WHERE id = v_bom.produto_id;
        v_cmv := v_cmv + v_qtd_baixa * v_custo; v_n_mov := v_n_mov + 1;
        v_movs := v_movs || jsonb_build_object('origem','bom_servico','servico_id',v_item.servico_id,'produto_id',v_bom.produto_id,'nome',v_bom.produto_nome,'qtd',v_qtd_baixa,'antes',v_qtd_antes,'depois',v_depois,'custo',v_custo);
      END LOOP;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_tot_parc FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;
  IF v_tot_parc > 0 THEN
    -- FIX-FATURAR-PEDIDO-ID-v1: seleciona também o id da parcela e grava pedido_id + pedido_parcela_id.
    FOR v_parc IN SELECT id AS parcela_id, numero, valor, vencimento, forma_pagamento, conta_bancaria_id
                  FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id ORDER BY numero
    LOOP
      INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
        valor, status, categoria, numero_documento, descricao, forma_pagamento, conta_bancaria_id,
        pedido_id, pedido_parcela_id, created_at)
      VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE, v_parc.vencimento,
        v_parc.valor, 'aberto', 'Receita de vendas',
        COALESCE(v_ped.numero,'') || ' ' || v_parc.numero || '/' || v_tot_parc,
        'Pedido ' || COALESCE(v_ped.numero,'') || ' - parcela ' || v_parc.numero || '/' || v_tot_parc,
        v_parc.forma_pagamento, v_parc.conta_bancaria_id,
        p_pedido_id, v_parc.parcela_id, now())
      RETURNING id INTO v_rec_id;
      v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := v_n_parc + 1;
    END LOOP;
  ELSE
    -- FIX-FATURAR-PEDIDO-ID-v1: título único também carimba o pedido_id.
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, pedido_id, created_at)
    VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE,
      COALESCE(v_ped.primeiro_vencimento, CURRENT_DATE), v_ped.total, 'aberto', 'Receita de vendas',
      v_ped.numero, 'Pedido ' || COALESCE(v_ped.numero,''), p_pedido_id, now())
    RETURNING id INTO v_rec_id;
    v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := 1;
  END IF;

  UPDATE erp_pedidos SET status='faturado', data_faturamento=now(), titulos_gerados=true, cmv=v_cmv, updated_at=now()
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'numero',v_ped.numero,
    'cmv',v_cmv,'qtd_movimentos_estoque',v_n_mov,'qtd_titulos_receber',v_n_parc,
    'estoque_negativo_modo',v_neg_cfg,'avisos',v_avisos,  -- #8453
    'receber_ids',to_jsonb(v_rec_ids),'movimentos',v_movs);
END;
$function$;

-- 3) RPCs company-scoped p/ a tela de Configurações (padrão do ie_isento; a tela nunca lê companies) --
CREATE OR REPLACE FUNCTION public.fn_empresa_obter_estoque_negativo(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN 'avisar';
  END IF;
  RETURN lower(COALESCE(NULLIF(trim((SELECT c.estoque_venda_negativo FROM public.companies c WHERE c.id = p_company_id)),''),'avisar'));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_empresa_salvar_estoque_negativo(p_company_id uuid, p_modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_modo text;
BEGIN
  -- company-scoped (mesmo padrão do ie_isento): só edita config de empresa que a sessão possui.
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  v_modo := lower(COALESCE(NULLIF(trim(p_modo),''),'avisar'));
  IF v_modo NOT IN ('bloquear','avisar','liberar') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'modo_invalido');
  END IF;
  UPDATE public.companies SET estoque_venda_negativo = v_modo, updated_at = now()
    WHERE id = p_company_id;
  RETURN jsonb_build_object('sucesso', true, 'modo', v_modo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_empresa_obter_estoque_negativo(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_empresa_salvar_estoque_negativo(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_obter_estoque_negativo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_empresa_salvar_estoque_negativo(uuid, text) TO authenticated;

-- 4) RD-95: chave de ajuda do campo de config ------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, versao, status, vertical)
VALUES (
  'empresa.estoque.venda_negativo',
  '/dashboard/configuracoes/empresa',
  'Faturamento e estoque',
  'Faturar com estoque negativo',
  'Escolha o que o sistema faz quando faturar uma venda deixaria o saldo do produto abaixo de zero: Bloquear, Avisar ou Liberar.',
  'Controla a baixa de estoque no faturamento. Bloquear impede a nota e mostra o produto, o saldo atual e o saldo resultante. Avisar (padrão) fatura e lista os itens que ficaram negativos para você regularizar. Liberar fatura em silêncio.',
  'Avisar — a nota sai e o sistema avisa que "Caneta Azul" ficou com saldo -3, para você lançar a entrada que faltou.',
  'Deixar em "Liberar" e perder a conferência: o estoque fica negativo sem ninguém notar a compra/entrada que faltou lançar.',
  50, 1, 'publicado', 'geral'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  status = EXCLUDED.status, atualizado_em = now();
