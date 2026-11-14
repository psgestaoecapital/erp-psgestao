-- RD-98 p4 — EXCLUSÃO RASTREÁVEL de item de orçamento (/dashboard/hub/orcamento-itens)
-- Hoje fn_orcamento_item_excluir faz DELETE FÍSICO (pg_get_functiondef 01/11), sem soft-delete
-- e sem audit_log_global. A RD-98 p4 exige exclusão reversível + rastro.
--
-- Esta migration (ADITIVA):
--  1) adiciona excluido_em/excluido_por em erp_orcamentos_itens (soft-delete);
--  2) o recálculo do total (trigger) passa a somar só itens vivos;
--  3) a listagem (fn_orcamento_item_listar) filtra excluido_em IS NULL;
--  4) fn_orcamento_item_excluir vira soft-delete (UPDATE) + INSERT em audit_log_global
--     (mantém o histórico em erp_orcamento_historico);
--  5) todos os leitores de ITENS ATIVOS (conversão em pedido/obra, contagens no CRM,
--     verificação fiscal de obra) passam a filtrar excluido_em IS NULL, para que um item
--     excluído nunca seja copiado para pedido/obra nem contado como vivo.
-- Multi-tenant preservado (as funções mantêm as guardas existentes). RD-52: arquivo+PR.

-- 1) colunas de soft-delete (aditivas, idempotentes)
ALTER TABLE public.erp_orcamentos_itens
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE INDEX IF NOT EXISTS idx_orc_itens_vivos
  ON public.erp_orcamentos_itens (orcamento_id) WHERE excluido_em IS NULL;

-- 2) recálculo do total: só itens vivos
CREATE OR REPLACE FUNCTION public.recalc_orcamento_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orcamento_id UUID;
  v_subtotal DECIMAL(14,2);
  v_desconto_pct DECIMAL(5,2);
  v_desconto_val DECIMAL(14,2);
  v_acrescimo DECIMAL(14,2);
  v_frete DECIMAL(14,2);
  v_total DECIMAL(14,2);
BEGIN
  v_orcamento_id := COALESCE(NEW.orcamento_id, OLD.orcamento_id);

  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal
  FROM erp_orcamentos_itens
  WHERE orcamento_id = v_orcamento_id AND excluido_em IS NULL;

  SELECT desconto_percentual, desconto_valor, acrescimo_valor, frete_valor
  INTO v_desconto_pct, v_desconto_val, v_acrescimo, v_frete
  FROM erp_orcamentos WHERE id = v_orcamento_id;

  v_total := v_subtotal
           - COALESCE(v_subtotal * v_desconto_pct / 100, 0)
           - COALESCE(v_desconto_val, 0)
           + COALESCE(v_acrescimo, 0)
           + COALESCE(v_frete, 0);

  UPDATE erp_orcamentos
  SET subtotal = v_subtotal, total = GREATEST(v_total, 0)
  WHERE id = v_orcamento_id;

  RETURN NEW;
END; $function$;

-- 3) listagem de itens: filtra excluídos
CREATE OR REPLACE FUNCTION public.fn_orcamento_item_listar(p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_cong timestamptz; v_status text; v_itens jsonb; v_sub numeric; v_total numeric;
BEGIN
  SELECT company_id, escopo_congelado_em, status, subtotal, total INTO v_company, v_cong, v_status, v_sub, v_total
  FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este orçamento'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.ordem, i.created_at), '[]'::jsonb) INTO v_itens
  FROM erp_orcamentos_itens i WHERE i.orcamento_id = p_orcamento_id AND i.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'itens', v_itens, 'subtotal', v_sub, 'total', v_total, 'status', v_status,
    'congelado', v_cong IS NOT NULL, 'editavel', v_cong IS NULL AND v_status IN ('rascunho','revisao','enviado','visualizado'));
END; $function$;

-- 4) exclusão rastreável: soft-delete + audit_log_global (mantém o histórico)
CREATE OR REPLACE FUNCTION public.fn_orcamento_item_excluir(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r erp_orcamentos_itens%ROWTYPE; g jsonb; v_total numeric; v_nome text; v_email text;
BEGIN
  SELECT * INTO r FROM erp_orcamentos_itens WHERE id = p_item_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado'); END IF;
  -- idempotente: já excluído não re-audita
  IF r.excluido_em IS NOT NULL THEN
    SELECT total INTO v_total FROM erp_orcamentos WHERE id = r.orcamento_id;
    RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0), 'ja_excluido', true);
  END IF;
  g := fn_orcamento_item_guarda(r.orcamento_id);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  PERFORM public.fn__guarda_empresa(r.company_id);

  UPDATE erp_orcamentos_itens
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE id = p_item_id AND excluido_em IS NULL;  -- dispara recalc_orcamento_total (só itens vivos)

  SELECT total INTO v_total FROM erp_orcamentos WHERE id = r.orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email), email INTO v_nome, v_email
  FROM auth.users WHERE id = auth.uid();

  INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (r.orcamento_id, r.company_id, 'item_excluido', COALESCE(r.produto_nome,''), auth.uid(), v_nome,
          jsonb_build_object('item_id', p_item_id, 'subtotal_item', r.subtotal, 'total_depois', v_total));

  INSERT INTO audit_log_global(company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (r.company_id, auth.uid(), v_email, 'erp_orcamentos_itens', p_item_id::text, 'EXCLUIU',
          to_jsonb(r), jsonb_build_object('excluido_em', now(), 'excluido_por', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0));
END; $function$;

-- 5) leitores de itens ATIVOS passam a ignorar excluídos -----------------------------------

-- 5a) conversão em pedido (legada)
CREATE OR REPLACE FUNCTION public.converter_orcamento_pedido(p_orcamento_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pedido_id UUID;
  v_orc RECORD;
  v_numero VARCHAR;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orcamento nao encontrado'; END IF;
  IF v_orc.status = 'convertido' THEN RAISE EXCEPTION 'Orcamento ja foi convertido'; END IF;
  -- idempotencia (duplo-clique): nunca cria 2o Pedido pro mesmo orcamento
  IF v_orc.pedido_id IS NOT NULL THEN RAISE EXCEPTION 'Orcamento ja convertido (pedido %)', v_orc.pedido_id; END IF;

  v_numero := next_pedido_numero(v_orc.company_id);

  INSERT INTO erp_pedidos (
    company_id, numero, orcamento_origem_id,
    cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    data_pedido, data_prevista_entrega,
    status, vendedor_id, vendedor_nome, comissao_percentual,
    condicao_pagamento, forma_pagamento, prazo_entrega_dias,
    frete_tipo, frete_valor,
    subtotal, desconto_percentual, desconto_valor, acrescimo_valor, total,
    observacoes, created_by
  ) VALUES (
    v_orc.company_id, v_numero, v_orc.id,
    v_orc.cliente_id, v_orc.cliente_nome, v_orc.cliente_cnpj, v_orc.cliente_email, v_orc.cliente_telefone,
    CURRENT_DATE, CURRENT_DATE + COALESCE(v_orc.prazo_entrega_dias, 0),
    'aberto', v_orc.vendedor_id, v_orc.vendedor_nome, v_orc.comissao_percentual,
    v_orc.condicao_pagamento, v_orc.forma_pagamento, v_orc.prazo_entrega_dias,
    v_orc.frete_tipo, v_orc.frete_valor,
    v_orc.subtotal, v_orc.desconto_percentual, v_orc.desconto_valor, v_orc.acrescimo_valor, v_orc.total,
    v_orc.observacoes, p_user_id
  ) RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens WHERE orcamento_id = p_orcamento_id AND excluido_em IS NULL ORDER BY ordem;

  UPDATE erp_orcamentos SET
    status = 'convertido',
    pedido_id = v_pedido_id,
    convertido_em = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id)
  VALUES (p_orcamento_id, v_orc.company_id, 'convertido_pedido', 'Convertido em pedido ' || v_numero, p_user_id);

  RETURN v_pedido_id;
END; $function$;

-- 5b) conversão em pedido (atual)
CREATE OR REPLACE FUNCTION public.fn_converter_orcamento_em_pedido(p_orcamento_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_id uuid;
  v_orc record;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_base text;
  v_numero text;
  v_sufixo text;
  v_n int := 1;
  v_ativo text;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF v_orc IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;
  IF NOT (v_interno OR auth.role() = 'service_role' OR v_orc.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  -- #122: qualquer etapa aberta converte ("enviado" é opcional)
  IF v_orc.status NOT IN ('rascunho', 'enviado', 'visualizado', 'aprovado') THEN
    RAISE EXCEPTION 'Este orçamento não pode virar pedido na situação atual (%).', v_orc.status;
  END IF;
  IF v_orc.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já foi convertido em pedido.';
  END IF;

  -- #3858: nunca 2 pedidos ativos do mesmo orçamento (revertido/cancelado saíram do fluxo)
  SELECT numero INTO v_ativo FROM erp_pedidos
   WHERE orcamento_origem_id = p_orcamento_id
     AND status NOT IN ('revertido', 'cancelado')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Este orçamento já tem o pedido % em andamento.', COALESCE(v_ativo, '');
  END IF;

  -- #3858: número livre na empresa (o pedido revertido guarda o número original)
  v_base := 'PED-' || COALESCE(v_orc.numero, p_orcamento_id::text);
  v_numero := left(v_base, 20);
  WHILE EXISTS (SELECT 1 FROM erp_pedidos WHERE company_id = v_orc.company_id AND numero = v_numero) LOOP
    v_n := v_n + 1;
    IF v_n > 99 THEN
      RAISE EXCEPTION 'Não foi possível gerar o número do pedido para este orçamento.';
    END IF;
    v_sufixo := '-' || v_n;
    v_numero := left(v_base, 20 - length(v_sufixo)) || v_sufixo;
  END LOOP;

  INSERT INTO erp_pedidos (
    company_id, numero, orcamento_origem_id, cliente_id, cliente_nome,
    cliente_cnpj, cliente_email, cliente_telefone, data_pedido, status,
    vendedor_id, vendedor_nome, comissao_percentual,
    condicao_pagamento, forma_pagamento, prazo_entrega_dias,
    frete_tipo, frete_valor,
    subtotal, desconto_percentual, desconto_valor, acrescimo_valor, total,
    observacoes, observacoes_internas,
    obra_id, obra_cno, obra_logradouro, obra_numero, obra_complemento,
    obra_bairro, obra_cidade, obra_uf, obra_cep, obra_codigo_ibge,
    created_by
  )
  VALUES (
    v_orc.company_id,
    v_numero,
    v_orc.id,
    v_orc.cliente_id, v_orc.cliente_nome, v_orc.cliente_cnpj,
    v_orc.cliente_email, v_orc.cliente_telefone, CURRENT_DATE, 'aberto',
    v_orc.vendedor_id, v_orc.vendedor_nome, v_orc.comissao_percentual,
    v_orc.condicao_pagamento, v_orc.forma_pagamento, v_orc.prazo_entrega_dias,
    v_orc.frete_tipo, v_orc.frete_valor,
    v_orc.subtotal, v_orc.desconto_percentual, v_orc.desconto_valor,
    v_orc.acrescimo_valor, v_orc.total,
    v_orc.observacoes, v_orc.observacoes_internas,
    v_orc.obra_id, v_orc.obra_cno, v_orc.obra_logradouro, v_orc.obra_numero, v_orc.obra_complemento,
    v_orc.obra_bairro, v_orc.obra_cidade, v_orc.obra_uf, v_orc.obra_cep, v_orc.obra_codigo_ibge,
    auth.uid()
  )
  RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem,
    tipo_item, servico_id, servico_codigo, servico_descricao,
    produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem,
    COALESCE(tipo_item, 'produto'), servico_id, servico_codigo, servico_descricao,
    produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens
  WHERE orcamento_id = p_orcamento_id AND excluido_em IS NULL
  ORDER BY ordem ASC NULLS LAST;

  UPDATE erp_orcamentos
  SET status = 'convertido', pedido_id = v_pedido_id,
      convertido_em = NOW(), updated_at = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (
    orcamento_id, company_id, evento, detalhe, usuario_id, metadata
  ) VALUES (
    p_orcamento_id, v_orc.company_id, 'convertido_pedido',
    'Convertido no pedido ' || v_numero, auth.uid(),
    jsonb_build_object('pedido_id', v_pedido_id, 'numero', v_numero, 'status_origem', v_orc.status)
  );

  RETURN v_pedido_id;
END $function$;

-- 5c) criação de obra a partir do orçamento (copia do escopo congelado)
-- ci-sem-guarda: fn_obra_criar_de_orcamento — helper interno SEM GRANT a authenticated/anon,
-- chamado só pelo trigger tg_orcamento_gera_obra, no mesmo txn do UPDATE do próprio orçamento do
-- usuário (o company_id vem do orçamento que ele acabou de alterar). Não é RPC exposta → sem IDOR.
CREATE OR REPLACE FUNCTION public.fn_obra_criar_de_orcamento(p_orcamento_id uuid)
 RETURNS projetos_obras
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.erp_orcamentos%ROWTYPE; v_opp public.erp_crm_oportunidade%ROWTYPE;
  v_cfg public.projetos_modulo_config%ROWTYPE; v_obra public.projetos_obras%ROWTYPE;
  v_num text; v_prefixo text; v_seq integer; v_cc_id uuid;
BEGIN
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento % não encontrado', p_orcamento_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_tenant_modules_active(v_orc.company_id) m WHERE m.module_id = 'hub_obras') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE orcamento_id = p_orcamento_id;
  IF FOUND THEN RETURN v_obra; END IF;   -- idempotente: não recopia itens
  SELECT * INTO v_opp FROM public.erp_crm_oportunidade WHERE orcamento_id = p_orcamento_id LIMIT 1;
  SELECT * INTO v_cfg FROM public.projetos_modulo_config WHERE company_id = v_orc.company_id;
  v_prefixo := COALESCE(NULLIF(v_cfg.prefixo_obra,''), 'OBRA');
  v_seq := COALESCE(v_cfg.contador_obra, 0) + 1;
  v_num := v_prefixo || '-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 4, '0');
  UPDATE public.projetos_modulo_config SET contador_obra = v_seq, updated_at = now() WHERE company_id = v_orc.company_id;
  INSERT INTO public.projetos_obras (
    company_id, numero, orcamento_id, oportunidade_id, nome, cliente_id, cliente_nome,
    endereco, cidade, bairro, status, responsavel_id, responsavel_nome, valor_previsto, data_inicio, created_by
  ) VALUES (
    v_orc.company_id, v_num, v_orc.id, v_opp.id,
    COALESCE(NULLIF(v_opp.titulo,''), v_orc.cliente_nome, 'Obra ' || v_num),
    v_orc.cliente_id, v_orc.cliente_nome, v_opp.obra_endereco, v_opp.obra_cidade, v_opp.obra_bairro,
    'em_andamento', v_opp.responsavel_id, v_opp.responsavel_nome, COALESCE(v_orc.total, 0), CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_obra;

  -- D4 · centro de custo da obra (cria se não houver um com o mesmo código); usuário pode trocar depois (tela)
  SELECT id INTO v_cc_id FROM public.erp_centros_custo
   WHERE company_id = v_orc.company_id AND codigo = v_obra.numero;
  IF v_cc_id IS NULL THEN
    INSERT INTO public.erp_centros_custo (company_id, nome, codigo, responsavel, ativo)
    VALUES (v_orc.company_id, v_obra.numero || ' · ' || COALESCE(v_obra.nome, v_obra.cliente_nome, 'Obra'),
            v_obra.numero, v_obra.responsavel_nome, true)
    RETURNING id INTO v_cc_id;
  END IF;
  UPDATE public.projetos_obras SET centro_custo_id = v_cc_id WHERE id = v_obra.id;

  -- ESCOPO CONGELADO · copia os itens do orçamento (só na criação — a idempotência acima protege)
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obra_item WHERE obra_id = v_obra.id) THEN
    INSERT INTO public.projetos_obra_item (
      company_id, obra_id, orcamento_item_id, servico_id, ordem,
      descricao, unidade, quantidade_contratada, preco_unitario,
      custo_unitario_previsto, bdi_percentual, observacoes)
    SELECT i.company_id, v_obra.id, i.id, i.servico_id,
      COALESCE(i.ordem, (row_number() OVER (ORDER BY i.ordem NULLS LAST, i.created_at))::int),
      COALESCE(NULLIF(btrim(i.servico_descricao),''), NULLIF(btrim(i.produto_nome),''), NULLIF(btrim(i.produto_descricao),''), 'Item'),
      COALESCE(NULLIF(btrim(i.unidade),''), 'un'),
      COALESCE(i.quantidade, 0), COALESCE(i.preco_unitario, 0), COALESCE(i.preco_custo, 0),
      i.bdi_percentual, i.observacoes
    FROM public.erp_orcamentos_itens i WHERE i.orcamento_id = p_orcamento_id AND i.excluido_em IS NULL;
  END IF;

  -- marca o congelamento nas duas pontas + valor_previsto = soma do escopo congelado
  UPDATE public.erp_orcamentos SET escopo_congelado_em = COALESCE(escopo_congelado_em, now()) WHERE id = p_orcamento_id;
  UPDATE public.projetos_obras
     SET escopo_congelado_em = now(),
         valor_previsto = COALESCE((SELECT SUM(valor_contratado) FROM public.projetos_obra_item WHERE obra_id = v_obra.id AND excluido_em IS NULL), valor_previsto)
   WHERE id = v_obra.id;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = v_obra.id;  -- reflete centro/escopo/valor no retorno
  RETURN v_obra;
END $function$;

-- 5d) contagem de orçamentos sem itens (clientes)
CREATE OR REPLACE FUNCTION public.fn_clientes_orcamentos_sem_itens(p_company uuid)
 RETURNS TABLE(cliente_id uuid, sem_itens bigint, com_itens bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT o.cliente_id,
         count(*) FILTER (WHERE COALESCE(it.n, 0) = 0) AS sem_itens,
         count(*) FILTER (WHERE COALESCE(it.n, 0) > 0) AS com_itens
  FROM public.erp_orcamentos o
  LEFT JOIN (
    SELECT i.orcamento_id, count(*) AS n
    FROM public.erp_orcamentos_itens i
    WHERE i.company_id = p_company AND i.excluido_em IS NULL
    GROUP BY i.orcamento_id
  ) it ON it.orcamento_id = o.id
  WHERE o.company_id = p_company AND o.cliente_id IS NOT NULL
  GROUP BY o.cliente_id;
$function$;

-- 5e) contagem de itens do card de CRM
CREATE OR REPLACE FUNCTION public.fn_crm_orcamento_do_card(p_company_id uuid)
 RETURNS TABLE(oportunidade_id uuid, orcamento_id uuid, numero text, status text, total numeric, itens integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, r.id, r.numero, r.status, COALESCE(r.total,0),
         (SELECT count(*)::int FROM erp_orcamentos_itens i WHERE i.orcamento_id = r.id AND i.excluido_em IS NULL)
    FROM erp_crm_oportunidade o
    JOIN erp_orcamentos r ON r.id = o.orcamento_id
   WHERE o.company_id = p_company_id
     AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL;
$function$;

-- 5f) verificação fiscal: exige obra pelos serviços dos itens vivos
CREATE OR REPLACE FUNCTION public.fn_orcamento_exige_obra(p_orcamento_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(bool_or(public.fn_fiscal_exige_obra(o.company_id, s.codigo_servico_municipio)), false)
  FROM public.erp_orcamentos o
  JOIN public.erp_orcamentos_itens i ON i.orcamento_id = o.id
  JOIN public.erp_servicos s ON s.id = i.servico_id
  WHERE o.id = p_orcamento_id AND i.excluido_em IS NULL AND i.servico_id IS NOT NULL;
$function$;

-- check_fn_guards regra 1: fecha ao anon todas as funções SECURITY DEFINER recriadas aqui
-- (idempotente; o CREATE OR REPLACE reabriria a régua). Nenhuma delas tinha GRANT a anon.
REVOKE ALL ON FUNCTION public.fn_orcamento_item_listar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_excluir(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_converter_orcamento_em_pedido(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_obra_criar_de_orcamento(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_crm_orcamento_do_card(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_orcamento_exige_obra(uuid) FROM anon;
