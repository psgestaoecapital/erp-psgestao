-- =============================================================
-- FEAT-OS-ONDA4-O43-ASSINATURA-v1 · Onda 4.3 da trilha OS
-- =============================================================
-- Assinatura do cliente (generico).
-- Canvas (front) -> dataURL · carimbo de data/hora pelo SERVIDOR (now()).
-- E PII: protegida por RLS os_all · retida junto da OS.
--
-- Lei 14.063 cobre assinatura eletronica simples + timestamp confiavel.
--
-- Mudancas:
--   A1) erp_os.assinatura_cliente: varchar(200) -> text (cabe dataURL PNG)
--   A2) fn_os_assinar(p_os_id, p_assinatura_base64) -> jsonb
--       Valida tamanho minimo · grava base64 + now() em assinatura_data
--   A3) fn_os_remover_assinatura(p_os_id) -> jsonb
--       Limpa assinatura + data (refazer)
--
-- Migration aplicada via MCP em 2026-06-11.
-- =============================================================

ALTER TABLE erp_os ALTER COLUMN assinatura_cliente TYPE text;

CREATE OR REPLACE FUNCTION public.fn_os_assinar(p_os_id uuid, p_assinatura_base64 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_os erp_os%ROWTYPE;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada');
  END IF;
  IF p_assinatura_base64 IS NULL OR length(p_assinatura_base64) < 50 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Assinatura vazia ou invalida');
  END IF;
  UPDATE erp_os SET
    assinatura_cliente = p_assinatura_base64,
    assinatura_data    = now(),
    updated_at         = now()
  WHERE id = p_os_id RETURNING * INTO v_os;
  RETURN jsonb_build_object('ok', true, 'os_id', v_os.id, 'assinatura_data', v_os.assinatura_data);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_os_remover_assinatura(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_os erp_os%ROWTYPE;
BEGIN
  UPDATE erp_os SET assinatura_cliente = NULL, assinatura_data = NULL, updated_at = now()
  WHERE id = p_os_id RETURNING * INTO v_os;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'os_id', v_os.id);
END; $$;

GRANT EXECUTE ON FUNCTION public.fn_os_assinar(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_os_remover_assinatura(uuid)   TO authenticated;
