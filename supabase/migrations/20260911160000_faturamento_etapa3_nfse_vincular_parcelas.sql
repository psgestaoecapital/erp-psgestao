-- ============================================================
-- Faturamento #18 v2 · ETAPA 3 — passo 3b: vincular as PARCELAS da medição à nota + disparar efetivação
-- ============================================================
-- SPEC. Depende do passo 3b-backend (fn_nfse_efetivar_se_autorizada + colunas em erp_nfse_emitidas).
-- A tela do OTC emite via NFSeEmitirGovModal (edge function), então o gancho da efetivação é aqui:
-- fn_pedido_nfse_marcar_emitida (chamada no onEmitida) passa a receber as parcelas MARCADAS, grava-as na
-- nota, marca efetivacao_status='pendente' e TENTA efetivar já (cobre o caso de a nota voltar 'autorizada'
-- síncrona). Se voltar 'processando', a efetivação acontece quando a consulta a vê 'autorizada'
-- (timing "a" do CEO — só autorizada efetiva). Idempotente e sem efeito no legado (sem parcela_ids = como hoje).
--
-- Assinatura muda (novo parâmetro) → precisa DROP antes do CREATE. O 3º parâmetro tem DEFAULT NULL, então o
-- front que hoje chama com 2 args continua funcionando (comportamento legado: só vincula pedido_id, não efetiva).

DROP FUNCTION IF EXISTS public.fn_pedido_nfse_marcar_emitida(uuid, text);
CREATE OR REPLACE FUNCTION public.fn_pedido_nfse_marcar_emitida(
  p_pedido_id uuid, p_provider_reference text, p_parcela_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid; v_id uuid; v_efet jsonb := NULL;
BEGIN
  SELECT company_id INTO v_company FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Pedido nao encontrado'); END IF;

  UPDATE erp_nfse_emitidas
     SET pedido_id = p_pedido_id,
         parcela_ids = COALESCE(p_parcela_ids, parcela_ids),
         efetivacao_status = CASE
            WHEN p_parcela_ids IS NOT NULL AND array_length(p_parcela_ids,1) IS NOT NULL
              THEN COALESCE(efetivacao_status,'pendente')  -- não rebaixa 'ok'/'falha' já existentes
            ELSE efetivacao_status END
   WHERE provider_reference = p_provider_reference AND company_id = v_company
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nfse nao encontrada p/ ref'); END IF;

  -- tenta efetivar já (no-op se a nota ainda estiver 'processando' — só autorizada efetiva)
  IF p_parcela_ids IS NOT NULL AND array_length(p_parcela_ids,1) IS NOT NULL THEN
    v_efet := public.fn_nfse_efetivar_se_autorizada(v_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'nfse_id', v_id, 'efetivacao', v_efet);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_pedido_nfse_marcar_emitida(uuid, text, uuid[]) TO authenticated, service_role;
