-- Cancelamento de NFS-e (pedido do André).
-- A chamada ao Focus (DELETE /v2/nfsen|nfse) acontece na API route (Node, tem HTTP);
-- esta RPC faz a PERSISTÊNCIA atômica depois que o Focus confirma: valida estado,
-- carimba cancelado_em/por + justificativa e vira status='cancelada'.
-- Só cancela nota AUTORIZADA. Justificativa obrigatória (>=15 chars, exigência do padrão).
CREATE OR REPLACE FUNCTION public.fn_nfse_cancelar(
  p_nota_id uuid,
  p_justificativa text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nota RECORD;
BEGIN
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Justificativa obrigatória (mínimo 15 caracteres).');
  END IF;

  SELECT * INTO v_nota FROM erp_nfse_emitidas WHERE id = p_nota_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFS-e não encontrada.');
  END IF;

  IF v_nota.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok', true, 'ja_cancelada', true, 'nota_id', p_nota_id);
  END IF;

  IF v_nota.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Só é possível cancelar uma NFS-e AUTORIZADA. Status atual: ' || COALESCE(v_nota.status,'?') || '.');
  END IF;

  UPDATE erp_nfse_emitidas
     SET status = 'cancelada',
         cancelado_em = now(),
         cancelado_por = p_user_id,
         justificativa_cancelamento = btrim(p_justificativa),
         atualizado_em = now()
   WHERE id = p_nota_id;

  RETURN jsonb_build_object('ok', true, 'nota_id', p_nota_id, 'numero', v_nota.numero);
END;
$$;
