-- EHS · Máquinas (M1 · NR-12/NR-13) · RD-98 pilar 4 (exclusão rastreável)
-- Gap apontado pelo auditor_pdca_1 (25/11, DEMO EHS b0700000-...-00b):
--   fn_ehs_maquina_inativar faz soft-delete correto (ativo=false) porém NÃO registra
--   QUEM inativou (sem coluna de autor) NEM grava audit_log_global. A RD-98 exige
--   "soft-delete + quem excluiu + audit_log". Replica o padrão de soft-delete rastreável
--   já usado no núcleo (ref. agency_comissao: deleted_por + audit_log_global).
-- Aditivo e idempotente. Não altera dado de cliente. Escopo por company_id (guarda
-- fn_compliance_assert mantida). CREATE OR REPLACE de função existente = sensível (RD-94.1).
-- Code: code-desenvolvedor-3

-- 1) Colunas de rastro da inativação (aditivas, idempotentes)
ALTER TABLE public.compliance_maquina ADD COLUMN IF NOT EXISTS inativado_por uuid;
ALTER TABLE public.compliance_maquina ADD COLUMN IF NOT EXISTS inativado_em timestamptz;

COMMENT ON COLUMN public.compliance_maquina.inativado_por IS 'auth.uid() de quem inativou a máquina (RD-98 pilar 4 — exclusão rastreável)';
COMMENT ON COLUMN public.compliance_maquina.inativado_em  IS 'momento da inativação da máquina (RD-98 pilar 4 — exclusão rastreável)';

-- 2) fn_ehs_maquina_inativar: grava autor/data + trilha em audit_log_global.
--    Mantém a guarda de empresa, o soft-delete (ativo=false) e o erro 'maquina_invalida'
--    quando o id não pertence à empresa (backward-compat com a assinatura e o contrato atuais).
CREATE OR REPLACE FUNCTION public.fn_ehs_maquina_inativar(p_company_id uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_antes jsonb;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);

  SELECT jsonb_build_object(
           'nome', nome, 'identificacao', identificacao, 'tipo', tipo,
           'nr_aplicavel', nr_aplicavel, 'situacao', situacao, 'ativo', ativo)
    INTO v_antes
    FROM public.compliance_maquina
   WHERE id = p_id AND company_id = p_company_id;

  IF v_antes IS NULL THEN
    RAISE EXCEPTION 'maquina_invalida';
  END IF;

  UPDATE public.compliance_maquina
     SET ativo         = false,
         atualizado_em = now(),
         inativado_por = v_uid,
         inativado_em  = now()
   WHERE id = p_id AND company_id = p_company_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'compliance_maquina', p_id::text, 'ehs_maquina_inativar',
     v_antes, jsonb_build_object('ativo', false));
END $function$;
