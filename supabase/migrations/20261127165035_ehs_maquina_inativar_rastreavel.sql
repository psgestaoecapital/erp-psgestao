-- RD-98 pilar 4 (exclusão rastreável) para EHS · Máquinas (M1 NR-12/NR-13).
-- Gap da auditoria de jornada (auditor_pdca_1, 25/11): fn_ehs_maquina_inativar faz soft-delete
-- (ativo=false) mas NÃO registra QUEM inativou nem grava audit_log_global. Replica o padrão do
-- fn_agency_servico_excluir (#5988, M10-M14). Aditivo: só acrescenta colunas e trilha; não apaga
-- nem altera dado de cliente, não muda RBAC/financeiro/fiscal.

-- 1) Colunas de rastreio (aditivas, idempotentes)
ALTER TABLE public.compliance_maquina ADD COLUMN IF NOT EXISTS inativado_por uuid;
ALTER TABLE public.compliance_maquina ADD COLUMN IF NOT EXISTS inativado_em timestamptz;

-- 2) Inativar passa a gravar quem/quando + audit_log_global (soft-delete rastreável)
CREATE OR REPLACE FUNCTION public.fn_ehs_maquina_inativar(p_company_id uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();           -- lê o autor ANTES do assert
  v_m   public.compliance_maquina%ROWTYPE;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);

  SELECT * INTO v_m FROM public.compliance_maquina
   WHERE id = p_id AND company_id = p_company_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'maquina_invalida'; END IF;

  UPDATE public.compliance_maquina
     SET ativo = false, atualizado_em = now(), inativado_por = v_uid, inativado_em = now()
   WHERE id = p_id AND company_id = p_company_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid), 'compliance_maquina', p_id::text,
          'maquina_inativada',
          jsonb_build_object('nome', v_m.nome, 'identificacao', v_m.identificacao, 'tipo', v_m.tipo, 'ativo', v_m.ativo),
          jsonb_build_object('ativo', false, 'inativado_por', v_uid, 'inativado_em', now()));
END $function$;

-- Guarda de ACL (gate check:fn-guards): reafirma a ACL viva (sem anon/public), sem mudar comportamento.
REVOKE ALL ON FUNCTION public.fn_ehs_maquina_inativar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_maquina_inativar(uuid, uuid) TO authenticated, service_role;
