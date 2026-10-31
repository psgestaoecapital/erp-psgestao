-- Mão de obra da Indústria (tarefa eng_chefe 52cdf48a) — EXCLUSÃO RASTREÁVEL do salário base.
-- Hoje a tela de produtividade apaga o salário base com um DELETE físico direto na tabela
-- (src/app/dashboard/produtividade/page.tsx), sem guarda de empresa e sem rastro — some o histórico
-- e não fica registro de quem apagou (fere RD-98 pilar 4 e é dado sensível LGPD/salário).
-- Esta PR acrescenta o caminho validado de exclusão, na mesma família de fn_prod_salario_salvar:
--   * prod_salario_base ganha excluido_em / excluido_por (soft-delete; NUNCA DELETE físico);
--   * fn_prod_salario_excluir SECURITY DEFINER com a MESMA guarda (company_id IN get_user_company_ids()
--     OR is_admin()) e rastro em audit_log_global (valor_anterior/valor_novo);
--   * encerra a vigência aberta (vigencia_fim) ao excluir, para o salário excluído sair das leituras
--     de salário vigente (que filtram vigencia_fim IS NULL) sem apagar a linha.
-- ADITIVA: 2 colunas novas (idempotentes) + 1 função nova. Nenhuma tabela/policy/grant existente é
-- alterada. A troca da chamada na UI (DELETE direto -> esta RPC) vai em PR seguinte. REVOKE anon.

-- 1) Soft-delete rastreável (aditivo, idempotente)
ALTER TABLE public.prod_salario_base ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.prod_salario_base ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Exclusão guardada e rastreável
CREATE OR REPLACE FUNCTION public.fn_prod_salario_excluir(p_id uuid, p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.prod_salario_base%ROWTYPE;
  v_uid uuid := COALESCE(auth.uid(), p_user);
BEGIN
  SELECT * INTO v_row FROM prod_salario_base WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'salario_nao_encontrado'); END IF;
  IF v_row.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_excluido'); END IF;
  IF NOT (v_row.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE prod_salario_base
     SET excluido_em  = now(),
         excluido_por = COALESCE(p_user, v_uid),
         vigencia_fim = COALESCE(vigencia_fim, CURRENT_DATE)
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao,
                                valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
          'prod_salario_base', v_row.id::text, 'salario_excluir',
          jsonb_build_object('cargo_id', v_row.cargo_id, 'funcionario_id', v_row.funcionario_id,
                             'valor', v_row.valor, 'fonte', v_row.fonte,
                             'vigencia_inicio', v_row.vigencia_inicio, 'vigencia_fim', v_row.vigencia_fim),
          jsonb_build_object('excluido_em', now(), 'excluido_por', COALESCE(p_user, v_uid)));

  RETURN jsonb_build_object('ok', true, 'id', v_row.id);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_prod_salario_excluir(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_prod_salario_excluir(uuid, uuid) TO authenticated, service_role;
