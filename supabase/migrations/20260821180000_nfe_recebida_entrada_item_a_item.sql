-- Fiscal/NFe Recebida · #11b: entrada item-a-item + estoque. Fronteira GE (fiscal/estoque · Pilar 1).
--
-- Premissa corrigida (RD-38/RD-26): a base JÁ existe e é reusada, não reconstruída:
--   • grid de itens da nota  → fn_nfe_item_depara_sugerir + componente ItensNfeRecebida (abrir nota
--     item-a-item, conferir descrição/NCM/CFOP/qtd/valor);
--   • vínculo do item ao produto do cadastro → fn_nfe_item_vincular (sugestão + confirmação manual);
--   • entrada respeitando o flag por item → fn_nfe_recebida_dar_entrada_estoque, que já movimenta SÓ
--     os itens com entra_estoque=true e produto vinculado, e resolve o LOCAL único via
--     fn_estoque_local_principal (erp_estoque_locais). Multi-local NÃO se constrói: a KGF usa 1 só
--     (701 movimentações, 1 local distinto) — RD-26, não criar o que não se usa.
--   • gerar a pagar → fn_nfe_recebida_gerar_pagar (helper interno, sem gate; por isso não é concedido).
--
-- Faltavam só DUAS coisas pro #11b:
--   1) o operador PODER sobrescrever entra_estoque por item (hoje só deriva do CFOP no vínculo);
--   2) "enviar pro financeiro" de forma INDEPENDENTE da entrada de estoque, com gate próprio
--      (o gerar_pagar não tem gate — precisa de um wrapper gateado pra ser chamável da tela).

-- 1) Override do flag "movimenta estoque" por item (gated). Bloqueia se o item já movimentou
--    estoque — não se reverte movimentação por um toggle (Pilar 1: estoque correto).
CREATE OR REPLACE FUNCTION public.fn_nfe_item_set_entra_estoque(p_item_id uuid, p_entra boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_movido boolean;
BEGIN
  SELECT n.company_id, COALESCE(i.estoque_movimentado, false)
    INTO v_company, v_movido
    FROM erp_nfe_recebidas_itens i
    JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item nao encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao'); END IF;
  IF v_movido THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item ja deu entrada no estoque; nao da pra alterar');
  END IF;

  UPDATE erp_nfe_recebidas_itens SET entra_estoque = p_entra WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'entra_estoque', p_entra);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_item_set_entra_estoque(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_set_entra_estoque(uuid, boolean) TO authenticated;

-- 2) Enviar pro financeiro, gateado e independente da entrada de estoque (o operador decide).
--    Wrapper fino: valida acesso à empresa e delega ao helper gerar_pagar (que é idempotente:
--    não duplica se lancado_pagar já é true).
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_enviar_financeiro(p_nfe_recebida_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nota nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao'); END IF;
  RETURN fn_nfe_recebida_gerar_pagar(p_nfe_recebida_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebida_enviar_financeiro(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_enviar_financeiro(uuid) TO authenticated;
