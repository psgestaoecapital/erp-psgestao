-- Hub · Gestão de Obras · Contratação da obra (H1 · HBF-5.3 · slice 1 — fundação)
-- Liga um contrato (erp_contratos, tabela da GE) à obra do Hub e registra a origem do documento,
-- com a TRAVA de divergência de valor por empresa + aceite explícito quando a divergência passa da
-- tolerância. Tudo ADITIVO e retrocompatível: colunas novas opcionais, config com default, RPC nova.
--
-- Escopo desta fatia (decisão provada no dado, RD-38): erp_contratos.proposta_id NÃO aponta para
-- erp_orcamentos (0 de 8 contratos com proposta casam em erp_orcamentos; não há erp_propostas), então
-- "aprovação cria a obra a partir da proposta" fica para uma fatia seguinte com a fonte de itens
-- definida pelo Eng. Chefe. Aqui entregamos o VÍNCULO contrato↔obra (ambos já existentes — a obra
-- nasce do orçamento por fn_obra_criar_de_orcamento) + a trava de valor, que é o núcleo de segurança
-- do item (1) do plano.

-- 1) Colunas aditivas em erp_contratos ---------------------------------------------------------------
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.projetos_obras(id) ON DELETE SET NULL;

ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS origem_documento text;

-- origem do documento: modelo próprio da empresa × modelo imposto pela contratante.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_contratos_origem_documento_chk'
  ) THEN
    ALTER TABLE public.erp_contratos
      ADD CONSTRAINT erp_contratos_origem_documento_chk
      CHECK (origem_documento IS NULL OR origem_documento IN ('modelo_proprio','da_contratante'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_contratos_obra
  ON public.erp_contratos(obra_id) WHERE obra_id IS NOT NULL;

-- 2) Tolerância de divergência de valor por empresa (projetos_modulo_config) -------------------------
-- Default 5%: diferença entre o valor do contrato e o valor previsto da obra acima disso exige aceite.
ALTER TABLE public.projetos_modulo_config
  ADD COLUMN IF NOT EXISTS contrato_tolerancia_valor_pct numeric NOT NULL DEFAULT 5;

-- 3) RPC: vincular contrato à obra com a trava de divergência + aceite explícito ---------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_vincular_obra(
  p_contrato_id uuid,
  p_obra_id uuid,
  p_origem_documento text DEFAULT NULL,
  p_aceite_divergencia boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato public.erp_contratos%ROWTYPE;
  v_obra     public.projetos_obras%ROWTYPE;
  v_tol      numeric;
  v_val_c    numeric;
  v_val_o    numeric;
  v_div      numeric := 0;
BEGIN
  IF p_origem_documento IS NOT NULL AND p_origem_documento NOT IN ('modelo_proprio','da_contratante') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_documento inválida');
  END IF;

  SELECT * INTO v_contrato FROM public.erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado'); END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;

  -- Mesma empresa nas duas pontas (não liga contrato de uma empresa a obra de outra).
  IF v_contrato.company_id IS DISTINCT FROM v_obra.company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato e obra são de empresas diferentes');
  END IF;

  -- Guarda de empresa: a empresa tem de ser do usuário (sem usuário = serviço/cron passa).
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_contrato.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- Trava de divergência: compara o valor do contrato com o valor previsto da obra.
  v_val_c := COALESCE(NULLIF(v_contrato.valor_atual, 0), NULLIF(v_contrato.valor_mensal, 0), 0);
  v_val_o := COALESCE(v_obra.valor_previsto, 0);
  v_tol   := COALESCE((SELECT contrato_tolerancia_valor_pct FROM public.projetos_modulo_config
                        WHERE company_id = v_contrato.company_id), 5);

  -- Só dá para comparar quando os dois valores existem; divergência simétrica sobre o maior valor.
  IF v_val_c > 0 AND v_val_o > 0 THEN
    v_div := round(abs(v_val_c - v_val_o) / greatest(v_val_c, v_val_o) * 100, 2);
    IF v_div > v_tol AND NOT p_aceite_divergencia THEN
      RETURN jsonb_build_object(
        'ok', false, 'requer_aceite', true,
        'divergencia_pct', v_div, 'tolerancia_pct', v_tol,
        'valor_contrato', v_val_c, 'valor_obra', v_val_o,
        'erro', format('Divergência de %s%% entre contrato (R$ %s) e obra (R$ %s) acima da tolerância de %s%%. Confirme o aceite para vincular.',
                        v_div, v_val_c, v_val_o, v_tol));
    END IF;
  END IF;

  UPDATE public.erp_contratos
     SET obra_id = p_obra_id,
         origem_documento = COALESCE(p_origem_documento, origem_documento, 'modelo_proprio'),
         updated_at = now()
   WHERE id = p_contrato_id;

  RETURN jsonb_build_object(
    'ok', true, 'contrato_id', p_contrato_id, 'obra_id', p_obra_id,
    'divergencia_pct', v_div, 'tolerancia_pct', v_tol,
    'valor_contrato', v_val_c, 'valor_obra', v_val_o,
    'aceite_registrado', (v_div > v_tol AND p_aceite_divergencia));
END; $function$;

-- Isolamento multi-tenant: a função é SECURITY DEFINER e escreve em erp_contratos; a guarda interna
-- passa quando auth.uid() é nulo (serviço/cron), então anon NÃO pode executar. Revoga PUBLIC/anon.
REVOKE ALL ON FUNCTION public.fn_contrato_vincular_obra(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_vincular_obra(uuid, uuid, text, boolean) TO authenticated, service_role;
