-- LOTE C · Renegociação / Acerto (consolidação com rastreabilidade). Aterrado (RD-26): status ganha
-- 'renegociado'; REUSA erp_receber.observacoes (plural, já existe) — NÃO cria coluna duplicada (RD-52);
-- boleto = título erp_receber normal (entra na remessa CNAB). Pilar 1: vive na GE, consolida (não duplica).

-- 1.1 Tabelas novas (tenant)
CREATE TABLE IF NOT EXISTS public.erp_renegociacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  cliente_id    uuid REFERENCES public.erp_clientes(id),
  conta_bancaria_id uuid REFERENCES public.erp_banco_contas(id),
  data_acerto   date NOT NULL DEFAULT current_date,
  valor_origem  numeric(14,2) NOT NULL DEFAULT 0,
  valor_gerado  numeric(14,2) NOT NULL DEFAULT 0,
  ajuste        numeric(14,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'confirmada',
  observacao    text,
  criado_por    uuid, criado_em timestamptz DEFAULT now(),
  cancelado_em  timestamptz
);
CREATE TABLE IF NOT EXISTS public.erp_renegociacao_origem (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  renegociacao_id   uuid NOT NULL REFERENCES public.erp_renegociacao(id) ON DELETE CASCADE,
  receber_origem_id uuid NOT NULL REFERENCES public.erp_receber(id),
  valor             numeric(14,2) NOT NULL,
  UNIQUE (receber_origem_id)   -- um título só entra em UM acerto
);

-- 1.2 Aditivo em erp_receber: só renegociacao_id (observacoes já existe → reuso).
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS renegociacao_id uuid REFERENCES public.erp_renegociacao(id);
-- status: adiciona 'renegociado' ao CHECK existente
ALTER TABLE public.erp_receber DROP CONSTRAINT IF EXISTS erp_receber_status_check;
ALTER TABLE public.erp_receber ADD CONSTRAINT erp_receber_status_check
  CHECK ((status)::text = ANY (ARRAY['aberto','pago','parcial','vencido','cancelado','renegociado']::text[]));

-- 1.3 RLS (padrão validado)
ALTER TABLE public.erp_renegociacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_renegociacao_origem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reneg_tenant ON public.erp_renegociacao;
CREATE POLICY reneg_tenant ON public.erp_renegociacao FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS reneg_origem_tenant ON public.erp_renegociacao_origem;
CREATE POLICY reneg_origem_tenant ON public.erp_renegociacao_origem FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

-- 2) RPCs
-- lista títulos elegíveis (aberto/vencido, sem acerto) do cliente/conta
CREATE OR REPLACE FUNCTION public.fn_renegociacao_titulos_abertos(p_company uuid, p_cliente uuid DEFAULT NULL, p_conta uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'descricao', r.descricao, 'valor', r.valor, 'data_vencimento', r.data_vencimento,
    'status', r.status, 'numero_documento', r.numero_documento, 'cliente_nome', r.cliente_nome
  ) ORDER BY r.data_vencimento), '[]'::jsonb)
  FROM public.erp_receber r
  WHERE (p_company IN (SELECT get_user_company_ids()) OR public.is_admin())
    AND r.company_id = p_company AND r.deleted_at IS NULL
    AND r.status IN ('aberto','vencido') AND r.renegociacao_id IS NULL
    AND (p_cliente IS NULL OR r.cliente_id = p_cliente)
    AND (p_conta IS NULL OR r.conta_bancaria_id = p_conta);
$function$;
REVOKE ALL ON FUNCTION public.fn_renegociacao_titulos_abertos(uuid,uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_renegociacao_titulos_abertos(uuid,uuid,uuid) TO authenticated;

-- cria o acerto (transacional, tudo-ou-nada)
CREATE OR REPLACE FUNCTION public.fn_renegociacao_criar(
  p_company uuid, p_cliente uuid, p_conta uuid, p_origem_ids uuid[], p_boletos jsonb, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  v_reneg uuid; v_origem numeric := 0; v_gerado numeric := 0; v_ajuste numeric; v_n_eleg int;
  v_cli_nome text; v_mes text := to_char(current_date,'MM/YYYY'); v_ids uuid[] := '{}'; b jsonb; v_new uuid; i int := 0;
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF p_origem_ids IS NULL OR array_length(p_origem_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','sem_origens'); END IF;
  IF p_boletos IS NULL OR jsonb_array_length(p_boletos)=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','sem_boletos'); END IF;

  -- valida elegibilidade de TODAS as origens (empresa + cliente + aberto/vencido + sem acerto)
  SELECT count(*), COALESCE(sum(valor),0) INTO v_n_eleg, v_origem FROM public.erp_receber
   WHERE id = ANY(p_origem_ids) AND company_id = p_company AND deleted_at IS NULL
     AND status IN ('aberto','vencido') AND renegociacao_id IS NULL
     AND (p_cliente IS NULL OR cliente_id = p_cliente);
  IF v_n_eleg <> array_length(p_origem_ids,1) THEN
    RAISE EXCEPTION 'Uma ou mais origens não são elegíveis (empresa/cliente/status/já em acerto).'; END IF;

  SELECT COALESCE(sum((x->>'valor')::numeric),0) INTO v_gerado FROM jsonb_array_elements(p_boletos) x;
  v_ajuste := round(v_gerado - v_origem, 2);
  IF abs(v_ajuste) > 0.01 AND COALESCE(btrim(p_observacao),'') = '' THEN
    RAISE EXCEPTION 'Ajuste de R$ % exige um motivo (observação).', to_char(v_ajuste,'FM999999990.00'); END IF;

  SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli_nome FROM public.erp_clientes WHERE id = p_cliente;
  v_cli_nome := COALESCE(v_cli_nome, 'cliente');  -- p_cliente nulo/sem match não pode zerar a descrição (NOT NULL)

  INSERT INTO public.erp_renegociacao (company_id, cliente_id, conta_bancaria_id, valor_origem, valor_gerado, ajuste, status, observacao, criado_por)
  VALUES (p_company, p_cliente, p_conta, v_origem, v_gerado, v_ajuste, 'confirmada', p_observacao, auth.uid())
  RETURNING id INTO v_reneg;

  INSERT INTO public.erp_renegociacao_origem (company_id, renegociacao_id, receber_origem_id, valor)
  SELECT p_company, v_reneg, r.id, r.valor FROM public.erp_receber r WHERE r.id = ANY(p_origem_ids);

  UPDATE public.erp_receber SET status='renegociado', renegociacao_id=v_reneg,
    observacoes = COALESCE(observacoes,'') || ' [RENEGOCIADO no acerto '||left(v_reneg::text,8)||' em '||to_char(current_date,'DD/MM/YYYY')||' — ver boletos]',
    updated_at = now()
  WHERE id = ANY(p_origem_ids);

  -- cria os N boletos gerados (títulos erp_receber normais → entram na remessa CNAB)
  FOR b IN SELECT * FROM jsonb_array_elements(p_boletos) LOOP
    i := i + 1;
    INSERT INTO public.erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      conta_bancaria_id, renegociacao_id, status, observacoes)
    VALUES (p_company, p_cliente, v_cli_nome,
      'Acerto '||v_cli_nome||' · '||v_mes||' · '||i||'/'||jsonb_array_length(p_boletos),
      (b->>'valor')::numeric, (b->>'data_vencimento')::date, p_conta, v_reneg, 'aberto',
      'Acerto (renegociação '||left(v_reneg::text,8)||') — '||array_length(p_origem_ids,1)||' título(s) de origem')
    RETURNING id INTO v_new;
    v_ids := array_append(v_ids, v_new);
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'renegociacao_id', v_reneg,
    'valor_origem', v_origem, 'valor_gerado', v_gerado, 'ajuste', v_ajuste, 'gerados', to_jsonb(v_ids));
END $function$;
REVOKE ALL ON FUNCTION public.fn_renegociacao_criar(uuid,uuid,uuid,uuid[],jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_renegociacao_criar(uuid,uuid,uuid,uuid[],jsonb,text) TO authenticated;

-- cancela o acerto (bloqueia se algum gerado já pago; reverte origens)
CREATE OR REPLACE FUNCTION public.fn_renegociacao_cancelar(p_reneg_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_company uuid; v_pagos int;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_renegociacao WHERE id = p_reneg_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','sem_acesso'); END IF;

  -- gerados = renegociacao_id = X e NÃO são origens
  SELECT count(*) INTO v_pagos FROM public.erp_receber
   WHERE renegociacao_id = p_reneg_id AND status = 'pago'
     AND id NOT IN (SELECT receber_origem_id FROM public.erp_renegociacao_origem WHERE renegociacao_id = p_reneg_id);
  IF v_pagos > 0 THEN RETURN jsonb_build_object('sucesso',false,'erro','ha_boleto_pago',
    'orientacao','Há boleto gerado já PAGO — não dá pra cancelar o acerto.'); END IF;

  -- cancela os gerados (não pagos)
  UPDATE public.erp_receber SET status='cancelado', updated_at=now()
   WHERE renegociacao_id = p_reneg_id
     AND id NOT IN (SELECT receber_origem_id FROM public.erp_renegociacao_origem WHERE renegociacao_id = p_reneg_id);

  -- reverte as origens (status recalculado por vencimento) + limpa vínculo
  UPDATE public.erp_receber SET
    status = CASE WHEN data_vencimento < current_date THEN 'vencido' ELSE 'aberto' END,
    renegociacao_id = NULL,
    observacoes = COALESCE(observacoes,'') || ' [ACERTO '||left(p_reneg_id::text,8)||' CANCELADO em '||to_char(current_date,'DD/MM/YYYY')||']',
    updated_at = now()
   WHERE id IN (SELECT receber_origem_id FROM public.erp_renegociacao_origem WHERE renegociacao_id = p_reneg_id);

  UPDATE public.erp_renegociacao SET status='cancelada', cancelado_em=now() WHERE id = p_reneg_id;
  RETURN jsonb_build_object('sucesso', true, 'id', p_reneg_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_renegociacao_cancelar(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_renegociacao_cancelar(uuid) TO authenticated;

-- consulta (lista processos + totais)
CREATE OR REPLACE FUNCTION public.fn_renegociacao_consultar(p_company uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id, 'data_acerto', g.data_acerto, 'cliente_id', g.cliente_id,
    'cliente_nome', COALESCE(c.nome_fantasia, c.razao_social, '—'),
    'valor_origem', g.valor_origem, 'valor_gerado', g.valor_gerado, 'ajuste', g.ajuste,
    'status', g.status,
    'qtd_origens', (SELECT count(*) FROM public.erp_renegociacao_origem o WHERE o.renegociacao_id = g.id),
    'qtd_gerados', (SELECT count(*) FROM public.erp_receber b WHERE b.renegociacao_id = g.id
                      AND b.id NOT IN (SELECT receber_origem_id FROM public.erp_renegociacao_origem WHERE renegociacao_id = g.id))
  ) ORDER BY g.data_acerto DESC, g.criado_em DESC), '[]'::jsonb)
  FROM public.erp_renegociacao g LEFT JOIN public.erp_clientes c ON c.id = g.cliente_id
  WHERE (p_company IN (SELECT get_user_company_ids()) OR public.is_admin())
    AND g.company_id = p_company
    AND (p_filtros->>'cliente_id' IS NULL OR g.cliente_id = (p_filtros->>'cliente_id')::uuid)
    AND (p_filtros->>'status' IS NULL OR g.status = p_filtros->>'status');
$function$;
REVOKE ALL ON FUNCTION public.fn_renegociacao_consultar(uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_renegociacao_consultar(uuid,jsonb) TO authenticated;

-- 3) O trigger de status preserva estados terminais MANUAIS (senão recomputava 'renegociado' → 'aberto').
--    Mesmo mecanismo do trigger que governa o status; agora 'renegociado' é terminal como 'cancelado'.
CREATE OR REPLACE FUNCTION public.fn_trg_status_lancamento()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_liquido numeric;
BEGIN
  IF LOWER(TRIM(COALESCE(NEW.status,''))) IN ('cancelado','cancelled','canceled','renegociado','estornado') THEN
    RETURN NEW;
  END IF;
  v_liquido := COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) - COALESCE(NEW.desconto,0);
  IF COALESCE(NEW.valor_pago,0) > 0 AND COALESCE(NEW.valor_pago,0) < v_liquido - 0.01 THEN
    NEW.status := 'parcial';
  ELSE
    NEW.status := fn_calcular_status_lancamento(NEW.data_vencimento, NEW.data_pagamento, NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;
