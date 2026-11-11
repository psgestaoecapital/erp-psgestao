-- P2/Pdois · Contrato · Chamado contexto 2a3909d9 (CEO na P2 11/11) · Code: rodrigo-code
--
-- PR 2 — ANEXO DO CONTRATO vira CONFIGURÁVEL por empresa.
-- Hoje "Ativar" (fn_contrato_mudar_status p_status='ativo') exige anexo do contrato
-- (erro anexo_contrato_obrigatorio). Passa a ser um parâmetro por empresa:
-- "exigir contrato anexado para ativar". PADRÃO = true (como hoje) para NÃO mudar nenhum
-- outro cliente (RD-97). Na P2 (grupo 9d8ad6fb): desligado, a pedido do CEO.
--
-- Aditiva e idempotente. Tabela nova com RLS por company_id e REVOKE anon (sem policy
-- permissiva). A função é reproduzida IDÊNTICA, com a ÚNICA mudança de envolver a checagem
-- do anexo num IF que lê o parâmetro (default true por COALESCE quando não há linha).
-- Não toca dado de cliente, baixa, parcela, status nem valor — só a exigência do anexo.

-- 1) Parâmetro por empresa ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_contratos_config (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  exigir_contrato_anexado boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
COMMENT ON TABLE public.erp_contratos_config IS 'Parâmetros de contrato por empresa (GE). exigir_contrato_anexado: se "Ativar" exige anexo do contrato (padrão true).';

ALTER TABLE public.erp_contratos_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_contratos_config_rls ON public.erp_contratos_config;
CREATE POLICY erp_contratos_config_rls ON public.erp_contratos_config
  FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

REVOKE ALL ON public.erp_contratos_config FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_contratos_config TO authenticated;
GRANT ALL ON public.erp_contratos_config TO service_role;

-- 2) Função de mudança de status lê o parâmetro (reprodução idêntica + IF do anexo) -------
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_exige_anexo boolean;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_info' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  IF p_status = 'ativo' THEN
    -- #2a3909d9: a exigência do anexo é configurável por empresa (padrão true = como antes).
    v_exige_anexo := COALESCE((SELECT exigir_contrato_anexado FROM erp_contratos_config WHERE company_id = v_c.company_id), true);
    IF v_exige_anexo THEN
      SELECT count(*) INTO v_n_arq FROM erp_contratos_arquivos WHERE contrato_id = p_contrato_id AND tipo IN ('contrato','contrato_assinado');
      IF v_n_arq < 1 THEN RETURN jsonb_build_object('ok',false,'erro','anexo_contrato_obrigatorio'); END IF;
    END IF;
    SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
    IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;
  END IF;

  UPDATE erp_contratos SET status = p_status, updated_at = now() WHERE id = p_contrato_id;
  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, now());

  IF p_status = 'ativo' THEN v_ger := fn_contrato_gerar_parcelas(p_contrato_id); END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger);
END;
$function$;

-- 3) P2 (grupo 9d8ad6fb): anexo deixa de ser obrigatório para ativar (pedido do CEO) -------
-- ON CONFLICT DO NOTHING: não sobrescreve configuração já existente de ninguém.
INSERT INTO public.erp_contratos_config (company_id, exigir_contrato_anexado)
VALUES
  ('36b69d77-b4ea-414b-8519-2ff6621c8de7', false),  -- Pdois/Prigol (P2)
  ('b2b96eef-0ad9-4588-85c1-a4e9f2cd7490', false)   -- Proplay Produtora (P2)
ON CONFLICT (company_id) DO NOTHING;
