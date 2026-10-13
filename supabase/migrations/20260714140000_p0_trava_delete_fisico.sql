-- P0 #6 · PR-A · A TRAVA — bloqueia DELETE físico de documento financeiro e de FOLHA
-- ============================================================================
-- Achado ao caçar o RD-41: telas apagam FISICAMENTE do banco (ex.: api/financeiro
-- DELETE cru, sem guarda/auditoria). Título e salário são DOCUMENTO — delete físico
-- não pode existir. Esta é a camada A (a trava), sem migração de dados, sem UI.
--
-- CORREÇÃO (RD-44) importante do diagnóstico:
--  • erp_receber/erp_pagar/erp_lancamentos TÊM audit trigger (audit_log_global grava a
--    linha inteira em valor_anterior) → os ~18k deletes de mai–jul são RECUPERÁVEIS.
--  • folha_competencia/folha_verba (SALÁRIO) NÃO têm nenhum trigger de auditoria →
--    se apagados, somem SEM rastro. Por isso o salário vem PRIMEIRO e leva bloqueio DURO.
--
-- Escopo desta PR-A (o urgente + o comprovadamente sem-legítimo-delete):
--   folha_competencia, folha_verba   → salário (LGPD + trabalhista), sem escape prático
--   erp_receber, erp_pagar           → o DELETE cru (api/financeiro) morre; a RPC auditada
--                                      (fn_*_excluir, já com guarda pago/conciliado) segue viva.
-- FORA desta PR (flag p/ PR-A.2): erp_lancamentos (9.129 deletes ~= re-importação),
--   erp_movimentacoes, erp_pedidos*, família ind_* — bloquear cego quebra ingestão/edição.
--   Precisam do path de re-import mapeado antes. Não se bloqueia o que a ingestão usa sem prova.
-- ============================================================================

-- Escape hatch deliberado (manutenção): só quem faz set_config('app.permitir_delete_fisico','on')
-- na própria transação consegue deletar. Raw DELETE do PostgREST/UI nunca seta isso → bloqueado.
CREATE OR REPLACE FUNCTION fn_bloqueia_delete_fisico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.permitir_delete_fisico', true), '') <> 'on' THEN
    RAISE EXCEPTION 'DELETE físico bloqueado em % — documento financeiro/folha não se apaga (RD-30). registro=%',
      TG_TABLE_NAME, OLD.id
      USING HINT = 'Use a exclusão auditada (fn_*_excluir) ou soft-delete por status. Hard delete só em manutenção deliberada via set_config(app.permitir_delete_fisico,on,true).';
  END IF;
  RETURN OLD;
END $$;

-- SALÁRIO — bloqueio duro (nenhuma RPC abre o escape aqui)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON folha_competencia;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON folha_competencia
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON folha_verba;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON folha_verba
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

-- FINANCEIRO — mata o DELETE cru; a RPC auditada abre o escape na própria transação
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_receber;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_receber
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_pagar;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_pagar
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

-- ── As RPCs auditadas abrem o escape (transação-local) antes do DELETE ───────
-- Reproduzem fiel a versão viva + PERFORM set_config(...,'on',true) e reset depois.
CREATE OR REPLACE FUNCTION public.fn_receber_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_registro jsonb;
  v_status text; v_conciliado boolean; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.conciliado, r.company_id
    INTO v_registro, v_status, v_conciliado, v_company_id
  FROM public.erp_receber r WHERE r.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_receber');

  PERFORM set_config('app.permitir_delete_fisico', 'on', true);   -- escape auditado
  DELETE FROM public.erp_receber WHERE id = p_id;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);  -- fecha logo em seguida

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pagar_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_registro jsonb;
  v_status text; v_conciliado boolean; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(p.*), p.status, p.conciliado, p.company_id
    INTO v_registro, v_status, v_conciliado, v_company_id
  FROM public.erp_pagar p WHERE p.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_pagar');

  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM public.erp_pagar WHERE id = p_id;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;
