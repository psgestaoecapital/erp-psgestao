-- #4917 (jordana-code 27/10, pedido da Jordana pelo Canal PS) — item 2: a baixa/alteração de título não passa pelo
-- outbox quando a empresa não tem integração com ENVIO ativo.
-- Antes: toda gravação em erp_pagar/erp_receber chamava fn_outbox_enfileirar, que (sem provider, ou em read_only/paused)
-- gravava uma linha 'cancelado' de auditoria em erp_outbox_sync (~141 mil linhas, 275 MB; 20.823 só na Comércio DEMO em
-- 3 dias) e fazia a conciliação agrupada estourar o statement_timeout.
-- Depois: o gatilho sai ANTES de qualquer consulta quando não há provider ativo com sync_mode de envio. Quem envia
-- (sync_mode diferente de read_only/paused, hoje só a Gean em shadow_mode) segue exatamente como antes. A LEITURA do Omie
-- (R.R, M.M, Tryo Acabamentos, Tryo Gesso em read_only) não passa por este gatilho e não muda.
-- fn_outbox_enfileirar fica intacta (o gatilho é o único chamador).

CREATE OR REPLACE FUNCTION public.fn_outbox_envio_ativo(p_company_id uuid, p_provider text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- mesma guarda de fn_outbox_enfileirar: a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- mesma regra de fn_outbox_enfileirar: sem config ativa = 'paused'; read_only/paused não enviam
  RETURN EXISTS (
    SELECT 1 FROM public.erp_provider_config
     WHERE company_id = p_company_id
       AND provider = p_provider
       AND ativo = true
       AND sync_mode IS NOT NULL
       AND sync_mode NOT IN ('read_only','paused')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_outbox_envio_ativo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_outbox_envio_ativo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_trg_outbox_pagar_receber()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_provider text := 'omie';  -- futuro: detectar baseado em ref_externa_sistema
  v_operacao text;
  v_payload jsonb;
  v_entity_table text;
  v_remote_id text;
BEGIN
  -- #4917: empresa sem integração com envio ativo não passa pelo outbox (nem grava linha 'cancelado')
  IF NOT public.fn_outbox_envio_ativo(COALESCE(NEW.company_id, OLD.company_id), v_provider) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Detectar tabela
  v_entity_table := TG_TABLE_NAME;
  
  -- Pegar codigo_lancamento_omie do mapping
  SELECT entity_remote_id INTO v_remote_id
  FROM erp_entity_mapping
  WHERE entity_table = v_entity_table
    AND entity_local_id = NEW.id
    AND provider = v_provider
  LIMIT 1;
  
  -- Decidir operacao baseado em mudanca
  IF TG_OP = 'INSERT' THEN
    -- Novo titulo criado localmente: precisa incluir no Omie
    -- (mas se ja tem ref_externa_sistema='OMIE', veio do Omie - skip)
    IF NEW.ref_externa_sistema = 'OMIE' THEN
      RETURN NEW;
    END IF;
    
    v_operacao := CASE WHEN v_entity_table = 'erp_pagar' THEN 'pagar.incluir' ELSE 'receber.incluir' END;
    v_payload := to_jsonb(NEW);
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detectar baixa: status mudou para pago/recebido
    IF OLD.status != 'pago' AND NEW.status = 'pago' AND v_entity_table = 'erp_pagar' THEN
      v_operacao := 'pagar.baixar';
      v_payload := jsonb_build_object(
        'codigo_lancamento_omie', v_remote_id,
        'codigo_lancamento_integracao', NEW.id::text,
        'data_pagamento', NEW.data_pagamento,
        'valor_pago', NEW.valor_pago,
        'desconto', NEW.desconto,
        'juros', NEW.juros,
        'multa', NEW.multa,
        'forma_pagamento', NEW.forma_pagamento,
        'conta_bancaria', NEW.conta_bancaria,
        'observacoes', NEW.observacoes
      );
    ELSIF OLD.status != 'recebido' AND NEW.status = 'recebido' AND v_entity_table = 'erp_receber' THEN
      v_operacao := 'receber.baixar';
      v_payload := jsonb_build_object(
        'codigo_lancamento_omie', v_remote_id,
        'codigo_lancamento_integracao', NEW.id::text,
        'data_recebimento', NEW.data_pagamento,
        'valor_recebido', NEW.valor_pago,
        'desconto', NEW.desconto,
        'juros', NEW.juros,
        'multa', NEW.multa,
        'forma_recebimento', NEW.forma_pagamento,
        'conta_bancaria', NEW.conta_bancaria,
        'observacoes', NEW.observacoes
      );
    -- Detectar estorno
    ELSIF OLD.status IN ('pago','recebido') AND NEW.status NOT IN ('pago','recebido') THEN
      v_operacao := CASE WHEN v_entity_table='erp_pagar' THEN 'pagar.estornar' ELSE 'receber.estornar' END;
      v_payload := jsonb_build_object(
        'codigo_lancamento_omie', v_remote_id,
        'motivo', 'Estorno solicitado pelo PS Gestao'
      );
    -- Detectar alteracao geral (qualquer outro UPDATE relevante)
    ELSIF (
      OLD.valor IS DISTINCT FROM NEW.valor OR
      OLD.data_vencimento IS DISTINCT FROM NEW.data_vencimento OR
      OLD.descricao IS DISTINCT FROM NEW.descricao OR
      OLD.observacoes IS DISTINCT FROM NEW.observacoes OR
      OLD.categoria IS DISTINCT FROM NEW.categoria
    ) THEN
      v_operacao := CASE WHEN v_entity_table='erp_pagar' THEN 'pagar.alterar' ELSE 'receber.alterar' END;
      v_payload := jsonb_build_object(
        'codigo_lancamento_omie', v_remote_id,
        'codigo_lancamento_integracao', NEW.id::text,
        'valor_documento', NEW.valor,
        'data_vencimento', NEW.data_vencimento,
        'observacao', NEW.observacoes,
        'numero_documento', NEW.numero_documento
      );
    ELSE
      -- Mudanca insignificante (timestamps, etc) - nao enfileira
      RETURN NEW;
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    -- Excluir no Omie tambem
    IF v_remote_id IS NULL THEN RETURN OLD; END IF;
    v_operacao := CASE WHEN v_entity_table='erp_pagar' THEN 'pagar.excluir' ELSE 'receber.excluir' END;
    v_payload := jsonb_build_object('codigo_lancamento_omie', v_remote_id);
  END IF;
  
  -- Enfileirar (a funcao decide se envia ou nao baseado em sync_mode)
  IF v_operacao IS NOT NULL AND v_payload IS NOT NULL THEN
    PERFORM fn_outbox_enfileirar(
      p_company_id := COALESCE(NEW.company_id, OLD.company_id),
      p_provider := v_provider,
      p_operacao := v_operacao,
      p_entity_table := v_entity_table,
      p_entity_local_id := COALESCE(NEW.id, OLD.id),
      p_payload_request := v_payload,
      p_origem_action := TG_OP || '-' || TG_TABLE_NAME,
      p_user_id := NULL  -- trigger nao tem auth.uid() em todas situacoes
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;
