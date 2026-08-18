-- ============================================================================
-- Migration: audit_skip_ultima_sync_churn
-- Objetivo : parar de auditar UPDATE cujo unico diff e campo de infra (ultima_sync).
-- Natureza : ADITIVA. CREATE OR REPLACE preserva os 17 triggers que usam a funcao.
--            Nenhuma linha de dado e tocada. Auditoria de mudanca real intacta.
--
-- Diagnostico (auditado): audit_log_global = 15 GB / 7,16 M linhas, so 3,7 meses. Surto de agosto = 3,99 M
-- linhas, 99,7% UPDATE, 400/400 updates de erp_pagar mexem SO em ultima_sync (carimbo dos jobs de sync
-- Omie/Pluggy a cada 5 min). O gatilho generico fn_audit_log_trigger grava valor_anterior+valor_novo
-- inteiros por carimbo. Fix: pular UPDATE cujo unico diff (ignorando ultima_sync) e vazio.
-- Corpo abaixo = reconstrucao FIEL da funcao atual (verificada via pg_get_functiondef) + 1 guarda no topo.
-- Escopo: apenas ESTANCAR. Poda das ~4 M linhas ja gravadas + pg_repack = Lever 2 (PR separado).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_audit_log_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_company_id UUID;
  v_registro_id TEXT;
  v_valor_anterior JSONB;
  v_valor_novo JSONB;
  -- ADITIVO: campos de infraestrutura cujo diff ISOLADO nao gera auditoria.
  -- Extensivel: adicionar aqui se surgir outro campo-carimbo de sync.
  v_ignore CONSTANT text[] := ARRAY['ultima_sync'];
BEGIN
  -- ADITIVO (fix disco): pular UPDATE cujo unico diff sao campos ignorados.
  -- Tambem cobre no-op updates. Mudanca real continua auditada normalmente.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - v_ignore) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_ignore)
  THEN
    RETURN NEW;
  END IF;

  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_company_id := (to_jsonb(OLD)->>'company_id')::UUID;
      v_registro_id := (to_jsonb(OLD)->>'id')::TEXT;
      v_valor_anterior := to_jsonb(OLD);
      v_valor_novo := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      v_company_id := (to_jsonb(NEW)->>'company_id')::UUID;
      v_registro_id := (to_jsonb(NEW)->>'id')::TEXT;
      v_valor_anterior := to_jsonb(OLD);
      v_valor_novo := to_jsonb(NEW);
    ELSE
      v_company_id := (to_jsonb(NEW)->>'company_id')::UUID;
      v_registro_id := (to_jsonb(NEW)->>'id')::TEXT;
      v_valor_anterior := NULL;
      v_valor_novo := to_jsonb(NEW);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
    v_registro_id := NULL;
  END;

  BEGIN
    INSERT INTO audit_log_global (
      company_id, user_id, user_email, tabela, registro_id,
      acao, valor_anterior, valor_novo, created_at
    ) VALUES (
      v_company_id, v_user_id, v_user_email, TG_TABLE_NAME, v_registro_id,
      TG_OP, v_valor_anterior, v_valor_novo, NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit log falhou para % %: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
