-- =============================================================
-- fiscal-carta-correcao-nfe-v1
-- =============================================================
-- Tabela erp_nfe_eventos (reusada por carta_correcao + cancelamento)
-- + RPC fn_emitir_carta_correcao
-- + RPC fn_registrar_resultado_evento_nfe
--
-- Pilar 2: RLS espelhada de erp_nfe_emitidas (tenant isolation por
-- company_id em user_companies + service_role bypass).
--
-- Regras SEFAZ:
--   - correcao entre 15 e 1000 caracteres
--   - status NFe = 'autorizada'
--   - sequencia 1..20 (limite legal)
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.erp_nfe_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_id uuid NOT NULL REFERENCES public.erp_nfe_emitidas(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('carta_correcao','cancelamento')),
  sequencia int NOT NULL DEFAULT 1,
  correcao text,
  justificativa text,
  status text NOT NULL DEFAULT 'processando'
    CHECK (status IN ('processando','registrado','rejeitado')),
  protocolo text,
  motivo_rejeicao text,
  provider_raw jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_nfe_eventos_nfe ON public.erp_nfe_eventos(nfe_id);
CREATE INDEX IF NOT EXISTS idx_erp_nfe_eventos_company ON public.erp_nfe_eventos(company_id);

ALTER TABLE public.erp_nfe_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nfe_eventos_service_role ON public.erp_nfe_eventos;
CREATE POLICY nfe_eventos_service_role ON public.erp_nfe_eventos
  FOR ALL TO public USING (true);

DROP POLICY IF EXISTS nfe_eventos_tenant_isolation ON public.erp_nfe_eventos;
CREATE POLICY nfe_eventos_tenant_isolation ON public.erp_nfe_eventos
  FOR ALL TO public USING (
    company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.fn_emitir_carta_correcao(
  p_nfe_id uuid,
  p_correcao text,
  p_operador_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_nfe RECORD;
  v_correcao text;
  v_sequencia int;
  v_evento_id uuid;
BEGIN
  IF p_nfe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nfe_id obrigatorio');
  END IF;
  v_correcao := btrim(COALESCE(p_correcao, ''));
  IF length(v_correcao) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Correcao exige minimo 15 caracteres (regra SEFAZ)');
  END IF;
  IF length(v_correcao) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Correcao excede 1000 caracteres (regra SEFAZ)');
  END IF;

  SELECT * INTO v_nfe FROM erp_nfe_emitidas WHERE id = p_nfe_id;
  IF v_nfe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao encontrada');
  END IF;
  IF v_nfe.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao esta autorizada (status atual: '||v_nfe.status||')');
  END IF;

  SELECT COALESCE(MAX(sequencia), 0) + 1 INTO v_sequencia
  FROM erp_nfe_eventos
  WHERE nfe_id = p_nfe_id AND tipo = 'carta_correcao'
    AND status IN ('processando','registrado');

  IF v_sequencia > 20 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Limite legal de 20 CC-e por NFe atingido');
  END IF;

  INSERT INTO erp_nfe_eventos (
    nfe_id, company_id, tipo, sequencia, correcao,
    status, criado_por
  ) VALUES (
    p_nfe_id, v_nfe.company_id, 'carta_correcao', v_sequencia, v_correcao,
    'processando', p_operador_id
  ) RETURNING id INTO v_evento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'evento_id', v_evento_id,
    'sequencia', v_sequencia,
    'status', 'processando'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_emitir_carta_correcao(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_registrar_resultado_evento_nfe(
  p_evento_id uuid,
  p_status text,
  p_protocolo text DEFAULT NULL,
  p_motivo_rejeicao text DEFAULT NULL,
  p_provider_raw jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_status NOT IN ('registrado','rejeitado','processando') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status invalido');
  END IF;
  UPDATE erp_nfe_eventos
  SET status = p_status,
      protocolo = COALESCE(p_protocolo, protocolo),
      motivo_rejeicao = COALESCE(p_motivo_rejeicao, motivo_rejeicao),
      provider_raw = COALESCE(p_provider_raw, provider_raw)
  WHERE id = p_evento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Evento nao encontrado');
  END IF;
  RETURN jsonb_build_object('ok', true, 'evento_id', p_evento_id, 'status', p_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_registrar_resultado_evento_nfe(uuid, text, text, text, jsonb) TO authenticated;
