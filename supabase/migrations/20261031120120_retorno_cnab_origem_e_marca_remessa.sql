-- Chamado #4909 (Gean) — 2 detalhes do teste da Jordana:
-- 1) as baixas do retorno CNAB gravavam origem='trigger_guarda' (o guarda de valor_pago inseria antes da RPC);
--    agora o guarda deriva 'retorno_cnab' quando a forma é 'cnab' (mesma regra de fn_pagar_baixar_pagamento).
-- 2) a importação do .RET (fn_remessa_retorno_conciliar_auto) nunca marcava a remessa como retorno importado;
--    nova fn_remessa_retorno_marcar, chamada pela tela depois de confirmar, preenche retorno_importado_em/status.
-- Aditiva: nenhum dado existente é alterado.

CREATE OR REPLACE FUNCTION public.fn_pagar_valor_pago_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_soma  numeric;
  v_delta numeric;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_pagar_baixa b
    WHERE b.pagar_id = NEW.id AND b.deleted_at IS NULL;
  v_delta := round(COALESCE(NEW.valor_pago,0) - v_soma, 2);
  IF v_delta <> 0 THEN
    INSERT INTO public.erp_pagar_baixa (pagar_id, company_id, valor, data, forma, origem, criado_por, criado_em)
    VALUES (NEW.id, NEW.company_id, v_delta, COALESCE(NEW.data_pagamento, CURRENT_DATE), NEW.forma_pagamento,
            CASE WHEN lower(COALESCE(NEW.forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'trigger_guarda' END,
            auth.uid(), now());
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_marcar(p_company_id uuid, p_item_ids uuid[], p_arquivo_nome text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE erp_remessa_pagamento r
     SET retorno_importado_em = now(),
         retorno_arquivo_nome = COALESCE(NULLIF(p_arquivo_nome,''), r.retorno_arquivo_nome),
         status = CASE WHEN EXISTS (SELECT 1 FROM erp_remessa_pagamento_item i
                                     WHERE i.remessa_id = r.id AND i.removido_em IS NULL AND i.status_item <> 'pago')
                       THEN 'retorno_parcial' ELSE 'concluido' END,
         itens_nao_reconhecidos = (SELECT count(*) FROM erp_remessa_pagamento_item i
                                    WHERE i.remessa_id = r.id AND i.status_item = 'nao_reconhecido')
   WHERE r.company_id = p_company_id AND r.status <> 'cancelado'
     AND r.id IN (SELECT i.remessa_id FROM erp_remessa_pagamento_item i WHERE i.id = ANY(COALESCE(p_item_ids,'{}')));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'remessas_marcadas', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.fn_remessa_retorno_marcar(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_remessa_retorno_marcar(uuid, uuid[], text) TO authenticated, service_role;
