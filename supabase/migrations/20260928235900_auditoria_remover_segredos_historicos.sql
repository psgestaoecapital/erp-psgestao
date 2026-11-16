-- CEO 28/09 (decisão 2): as chaves que ficaram gravadas no HISTÓRICO do registro de auditoria saem — só os valores,
-- trocados pelo texto "[removido]". Nenhuma linha de auditoria é apagada; tabela, ação, data, usuário e os demais
-- campos ficam como estavam.
-- Exceção à RD-54 (auditoria é só INSERT), autorizada pelo CEO para este caso: a trava é desligada SÓ dentro desta
-- transação e religada no fim; a guarda final exige a trava ligada.
-- Alvo medido em 28/09: 7.738 linhas — companies 7.684 (omie_app_key/secret em 6 empresas; nibo_api_key/secret em 1)
-- + erp_fiscal_provider_config 54 (api_key_encrypted). Desde a PR E (#1899) o gatilho de auditoria já grava
-- "[protegido]" no lugar do segredo, então linha nova não volta a ter chave.

-- regra de "campo de segredo" = a mesma do fn_audit_redigir (PR E)
CREATE OR REPLACE FUNCTION public.fn_audit_campo_segredo(p_chave text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT p_chave ~* '(secret|token|senha|password|api_key|app_key|private_key|chave_privada|pfx)'
     AND p_chave !~* '(_vault_id|_hash)$' AND p_chave <> 'nome_secret_vault'
$$;

-- valor de segredo ainda legível (nem vazio, nem já protegido/removido)
CREATE OR REPLACE FUNCTION public.fn_audit_tem_segredo(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_each(coalesce(p, '{}'::jsonb)) e
                 WHERE public.fn_audit_campo_segredo(e.key) AND jsonb_typeof(e.value) <> 'null'
                   AND e.value NOT IN ('""'::jsonb, '"[protegido]"'::jsonb, '"[removido]"'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.fn_audit_remover_segredos(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN p
    ELSE coalesce((SELECT jsonb_object_agg(e.key,
            CASE WHEN public.fn_audit_campo_segredo(e.key) AND jsonb_typeof(e.value) <> 'null'
                      AND e.value NOT IN ('""'::jsonb, '"[protegido]"'::jsonb, '"[removido]"'::jsonb)
                 THEN '"[removido]"'::jsonb ELSE e.value END)
          FROM jsonb_each(p) e), '{}'::jsonb) END
$$;

-- Vigia (só leitura, service_role): quantas linhas de auditoria ainda têm segredo legível, nas tabelas auditadas
-- que têm coluna de segredo. Usado pela aceitação e pode entrar no briefing.
CREATE OR REPLACE FUNCTION public.fn_audit_segredos_restantes() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH tabs AS (
    SELECT DISTINCT c.table_name FROM information_schema.columns c
    JOIN pg_trigger t ON t.tgrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
                     AND t.tgfoid = 'public.fn_audit_log_trigger'::regproc
    WHERE c.table_schema = 'public' AND public.fn_audit_campo_segredo(c.column_name)
    UNION SELECT 'companies' UNION SELECT 'companies_producao' UNION SELECT 'erp_fiscal_provider_config'
  )
  SELECT jsonb_build_object(
    'linhas_com_segredo', (SELECT count(*) FROM audit_log_global a WHERE a.tabela IN (SELECT table_name FROM tabs)
                             AND (public.fn_audit_tem_segredo(a.valor_anterior) OR public.fn_audit_tem_segredo(a.valor_novo))),
    'linhas_removido', (SELECT count(*) FROM audit_log_global a WHERE a.tabela IN (SELECT table_name FROM tabs)
                             AND (a.valor_anterior::text LIKE '%"[removido]"%' OR a.valor_novo::text LIKE '%"[removido]"%')),
    'linhas_tabelas_alvo', (SELECT count(*) FROM audit_log_global a WHERE a.tabela IN (SELECT table_name FROM tabs)),
    'trava_imutavel_ligada', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_imutavel_audit_log_global' AND tgenabled = 'O'),
    'tabelas', (SELECT jsonb_agg(table_name ORDER BY table_name) FROM tabs))
$$;
REVOKE ALL ON FUNCTION public.fn_audit_segredos_restantes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_segredos_restantes() TO service_role;

DO $do$
DECLARE v_total bigint; v_alteradas bigint; v_restam bigint; v_tabs text[];
BEGIN
  SELECT array_agg(x) INTO v_tabs FROM jsonb_array_elements_text(public.fn_audit_segredos_restantes()->'tabelas') x;
  SELECT count(*) INTO v_total FROM audit_log_global WHERE tabela = ANY (v_tabs);  -- só o alvo (índice); nada de varrer 7M linhas com a trava aberta

  ALTER TABLE public.audit_log_global DISABLE TRIGGER trg_imutavel_audit_log_global;

  UPDATE public.audit_log_global a
     SET valor_anterior = public.fn_audit_remover_segredos(a.valor_anterior),
         valor_novo     = public.fn_audit_remover_segredos(a.valor_novo)
   WHERE a.tabela = ANY (v_tabs)
     AND (public.fn_audit_tem_segredo(a.valor_anterior) OR public.fn_audit_tem_segredo(a.valor_novo));
  GET DIAGNOSTICS v_alteradas = ROW_COUNT;

  ALTER TABLE public.audit_log_global ENABLE TRIGGER trg_imutavel_audit_log_global;

  -- guardas: nenhum segredo legível; nenhuma linha apagada; trava de imutabilidade ligada de novo
  v_restam := (public.fn_audit_segredos_restantes()->>'linhas_com_segredo')::bigint;
  IF v_restam <> 0 THEN RAISE EXCEPTION 'ainda restam % linhas com segredo', v_restam; END IF;
  IF (SELECT count(*) FROM audit_log_global WHERE tabela = ANY (v_tabs)) <> v_total THEN RAISE EXCEPTION 'linha de auditoria sumiu'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_imutavel_audit_log_global' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'trava de imutabilidade da auditoria não voltou';
  END IF;
  RAISE NOTICE 'auditoria: % linhas com segredo trocado por [removido]; % linhas das tabelas-alvo, nenhuma apagada', v_alteradas, v_total;
END $do$;
