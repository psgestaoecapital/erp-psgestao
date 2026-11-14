-- PDCA commerce · /dashboard/commerce/estoque (aud8 14/11, nota 95) — GAP ÚNICO do SELO: RD-98 p4.
-- A exclusão de Local (fn_estoque_local_excluir) faz soft-delete (inativa, preserva movimentações),
-- mas NÃO gravava em audit_log — exclusão sem rastro fere RD-98 pilar 4.
-- Fix: registra em audit_log_global (quem, quando, local_id, estado anterior), no padrão das demais
-- exclusões guardadas (ex.: obra_custo_excluir, comissao_*). Nada mais muda: mesma trava de local
-- principal, mesma guarda de empresa, mesmo soft-delete idempotente.
-- Aditiva/idempotente (CREATE OR REPLACE). Não apaga nem altera dado de cliente além do soft-delete já existente.

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

  -- RD-98 p4: exclusão rastreável — registra quem excluiu, quando e o estado anterior.
  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_local.company_id, auth.uid(), auth.jwt() ->> 'email', 'erp_estoque_locais', p_id::text, 'estoque_local_excluir',
          jsonb_build_object('nome', v_local.nome, 'principal', COALESCE(v_local.principal, false), 'ativo', COALESCE(v_local.ativo, true)),
          jsonb_build_object('ativo', false));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'ativo', false);
END;
$function$;
