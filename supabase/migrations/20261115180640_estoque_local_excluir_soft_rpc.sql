-- RD-98 pilar 4 (soft-delete) — Local de estoque: trocar o HARD DELETE do cliente
-- por uma RPC guardada que INATIVA o local (ativo=false), preservando as
-- movimentações já registradas (o DELETE direto deixaria `local_id` órfão).
-- Tela /dashboard/commerce/estoque (auditor_pdca_2 13/11). NÚCLEO/estoque.
--
-- Regras:
--   * guarda de empresa (fn__guarda_empresa) — nunca cross-tenant;
--   * não permite inativar o local PRINCIPAL;
--   * soft-delete (ativo=false) — idempotente (inativar de novo = ok);
--   * erro em linguagem do usuário.
-- Aditiva (função NOVA), sem tocar dado de cliente. REVOKE anon, GRANT authenticated.
--
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_estoque_local_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_local record;
BEGIN
  SELECT * INTO v_local FROM public.erp_estoque_locais WHERE id = p_id;
  IF v_local IS NULL THEN
    RAISE EXCEPTION 'Local de estoque não encontrado.';
  END IF;

  PERFORM public.fn__guarda_empresa(v_local.company_id);

  IF COALESCE(v_local.principal, false) THEN
    RAISE EXCEPTION 'Não é possível excluir o local principal. Defina outro local como principal antes.';
  END IF;

  -- Soft-delete: inativa e preserva movimentações (idempotente).
  UPDATE public.erp_estoque_locais
     SET ativo = false, updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'ativo', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_estoque_local_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_estoque_local_excluir(uuid) TO authenticated;
