-- SPEC OD-3 · Odonto — Assinatura da evolução clínica (integridade CFO/LGPD).
-- RD-56/RD-41. HONESTIDADE (RD-38): o spec pedia "reusar erp_os_assinatura / epi_assinatura /
-- fn_epi_assinatura_hash" — mas NÃO existe motor de hash na base (epi_assinatura é feature planejada
-- sem tabela/RPC; erp_os_assinatura guarda imagem base64 travada em OS; pgcrypto nem estava ligado).
-- Então construímos o mínimo correto AQUI, numa única RPC (reusável depois por anamnese/documentos,
-- que já vivem em erp_odonto_prontuario.tipo). Identidade = auth.uid() (a barra real de toda a casa;
-- não há infra de PIN/senha pra reusar — um PIN seria requisito novo, não "reuso").

-- pgcrypto p/ digest() server-side (hash não forjável no cliente). Supabase: schema 'extensions'.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Colunas de integridade da assinatura (nomes no estilo da casa: text simples).
ALTER TABLE public.erp_odonto_prontuario
  ADD COLUMN IF NOT EXISTS assinatura_hash text,
  ADD COLUMN IF NOT EXISTS assinatura_metodo text;

-- Assinar uma evolução criada NÃO-assinada (p_assinar=false). O trigger de imutabilidade só bloqueia
-- UPDATE quando OLD.assinado — como a linha nasce false, este UPDATE (false→true) é permitido; depois
-- fica imutável. SECURITY DEFINER: a RLS do prontuário é SELECT+INSERT (sem UPDATE), então a assinatura
-- passa por aqui. Contrato do hash CONGELADO (ordem dos campos, separador '|', casts) p/ verificação futura.
CREATE OR REPLACE FUNCTION public.fn_odonto_prontuario_assinar(
  p_company_id uuid, p_prontuario_id uuid, p_metodo text DEFAULT 'senha_app')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_texto text; v_assinado boolean; v_hash text; v_now timestamptz := now(); v_uid uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  SELECT texto, assinado, assinatura_hash INTO v_texto, v_assinado, v_hash
    FROM erp_odonto_prontuario WHERE id = p_prontuario_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'evolução não encontrada'); END IF;
  IF v_assinado THEN  -- idempotente: já assinada, devolve o hash existente
    RETURN jsonb_build_object('ok', true, 'id', p_prontuario_id, 'ja_assinada', true, 'assinatura_hash', v_hash); END IF;
  -- hash = sha256( texto | timestamp_assinatura | signatário ) — reproduzível p/ auditar depois
  v_hash := encode(extensions.digest(
    coalesce(v_texto,'') || '|' || v_now::text || '|' || coalesce(v_uid::text,''), 'sha256'), 'hex');
  UPDATE erp_odonto_prontuario
    SET assinado = true, assinado_em = v_now, assinado_por = v_uid,
        assinatura_hash = v_hash, assinatura_metodo = coalesce(nullif(btrim(p_metodo),''), 'senha_app')
    WHERE id = p_prontuario_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'id', p_prontuario_id, 'assinatura_hash', v_hash, 'assinado_em', v_now);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_prontuario_assinar(uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_prontuario_assinar(uuid,uuid,text) TO authenticated;
