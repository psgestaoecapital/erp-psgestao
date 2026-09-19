-- 🚨 Saneamento Onda 1 · Lote 2b — banco/credenciais/extrato. Inventário #1560. Contexto 6b5cad70.
-- RDs 25·38·52·65·34-V5. Funções SECURITY DEFINER abertas p/ anon. Guarda padrão pela empresa do
-- parâmetro; sem JWT (interno/sync)/service_role/admin passa; authenticated só na própria → 42501.
-- REVOKE anon/public; GRANT authenticated, service_role. Corpos reproduzidos fiéis; só a guarda.

-- ── fn_banco_teste_conexao_registrar (writer; empresa = parâmetro) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_banco_teste_conexao_registrar(p_company_id uuid, p_provider text, p_banco_codigo text, p_ambiente text, p_provider_config_id uuid, p_status text, p_cert_status text, p_cert_expira_em date, p_auth_ok boolean, p_erro text, p_detalhe jsonb, p_latencia_ms integer, p_testado_por uuid, p_testado_por_email text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  INSERT INTO public.erp_banco_teste_conexao (
    company_id, provider, banco_codigo, ambiente, provider_config_id, status,
    cert_status, cert_expira_em, auth_ok, erro, detalhe, latencia_ms, testado_por, testado_por_email
  ) VALUES (
    p_company_id, p_provider, p_banco_codigo, p_ambiente, p_provider_config_id, p_status,
    p_cert_status, p_cert_expira_em, p_auth_ok, p_erro, p_detalhe, p_latencia_ms, p_testado_por, p_testado_por_email
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ── fn_extrato_importar_sistema (writer; empresa = parâmetro) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_extrato_importar_sistema(p_company_id uuid, p_conta_bancaria_id uuid, p_provider text, p_movimentos jsonb, p_periodo_inicio date, p_periodo_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid; v_mov jsonb; v_id_ext text; v_valor numeric; v_data date; v_desc text; v_dnorm text;
  v_inseridos integer := 0; v_ignorados integer := 0; v_avisos integer := 0; v_erros integer := 0;
  v_primeiro_erro text := NULL; v_soma numeric := 0; v_possivel boolean; v_motivo text;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'company_id_ausente');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF p_movimentos IS NULL OR jsonb_typeof(p_movimentos) <> 'array' THEN
    p_movimentos := '[]'::jsonb;
  END IF;

  SELECT id INTO v_lote_id
  FROM conciliacao_lote
  WHERE company_id = p_company_id
    AND tipo = 'bancario'
    AND origem = 'api_' || COALESCE(p_provider, 'desconhecido')
    AND conta_bancaria_id = p_conta_bancaria_id
    AND status = 'em_andamento'
    AND periodo_inicio = p_periodo_inicio
    AND periodo_fim = p_periodo_fim
  ORDER BY created_at DESC LIMIT 1;

  IF v_lote_id IS NULL THEN
    INSERT INTO conciliacao_lote
      (company_id, tipo, origem, nome, periodo_inicio, periodo_fim,
       conta_bancaria_id, total_movimentos, total_valor, total_pendentes,
       status, importado_por)
    VALUES
      (p_company_id, 'bancario', 'api_' || p_provider,
       format('%s · Extrato %s–%s', UPPER(p_provider),
              to_char(p_periodo_inicio, 'DD/MM'),
              to_char(p_periodo_fim, 'DD/MM')),
       p_periodo_inicio, p_periodo_fim,
       p_conta_bancaria_id, 0, 0, 0, 'em_andamento', NULL)
    RETURNING id INTO v_lote_id;
  END IF;

  FOR v_mov IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_id_ext := NULLIF(v_mov->>'id_externo', '');
    v_valor  := COALESCE((v_mov->>'valor')::numeric, 0);
    v_desc   := COALESCE(v_mov->>'descricao', '');
    v_dnorm  := lower(btrim(v_desc));
    BEGIN
      v_data := (v_mov->>'data_transacao')::date;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      IF v_primeiro_erro IS NULL THEN v_primeiro_erro := 'data_transacao inválida'; END IF;
      CONTINUE;
    END;

    IF v_id_ext IS NOT NULL AND EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id AND id_externo = v_id_ext) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    IF EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id AND status = 'conciliado'
           AND valor = v_valor AND data_transacao = v_data
           AND lower(btrim(descricao)) = v_dnorm) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    v_possivel := EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id
           AND valor = v_valor AND data_transacao = v_data
           AND lower(btrim(descricao)) = v_dnorm
           AND (status IN ('pendente', 'ignorado') OR lote_id = v_lote_id));
    v_motivo := CASE WHEN v_possivel THEN 'possivel_duplicado' ELSE NULL END;

    BEGIN
      INSERT INTO conciliacao_movimento
        (lote_id, company_id, data_transacao, valor, descricao, descricao_normalizada,
         natureza, id_externo, documento, status, motivo_status, obs)
      VALUES
        (v_lote_id, p_company_id, v_data, v_valor, v_desc, v_dnorm,
         CASE lower(COALESCE(v_mov->>'natureza','')) WHEN 'credito' THEN 'credito'
                                                    WHEN 'debito'  THEN 'debito'
                                                    ELSE 'credito' END,
         v_id_ext,
         NULLIF(v_mov->>'documento', ''),
         'pendente',
         v_motivo,
         CASE WHEN v_possivel THEN 'Possível duplicado: mesmo valor+data+descrição de outro lançamento — confira antes de conciliar.' ELSE NULL END);
      v_inseridos := v_inseridos + 1;
      v_soma := v_soma + v_valor;
      IF v_possivel THEN v_avisos := v_avisos + 1; END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_ignorados := v_ignorados + 1;
      WHEN OTHERS THEN
        v_erros := v_erros + 1;
        IF v_primeiro_erro IS NULL THEN v_primeiro_erro := SQLERRM; END IF;
    END;
  END LOOP;

  UPDATE conciliacao_lote
     SET total_movimentos = total_movimentos + v_inseridos,
         total_valor      = total_valor + v_soma,
         total_pendentes  = total_pendentes + v_inseridos,
         updated_at       = now()
   WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'lote_id', v_lote_id,
    'inseridos', v_inseridos,
    'ignorados_duplicados', v_ignorados,
    'possiveis_duplicados', v_avisos,
    'erros', v_erros,
    'primeiro_erro', v_primeiro_erro
  );
END $function$;

-- ── fn_banco_campos_faltantes (leitura; empresa = parâmetro) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_banco_campos_faltantes(p_company_id uuid, p_provider text, p_ambiente text DEFAULT 'producao'::text)
 RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_campos jsonb; v_cfg record; v_falta text[] := ARRAY[]::text[];
  c jsonb; v_id text; v_label text; v_ok boolean;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  SELECT campos INTO v_campos FROM public.erp_banco_manifesto WHERE provider = p_provider;
  IF v_campos IS NULL THEN RETURN v_falta; END IF;

  SELECT * INTO v_cfg FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id AND provider = p_provider AND ambiente = p_ambiente
   ORDER BY updated_at DESC LIMIT 1;

  FOR c IN SELECT * FROM jsonb_array_elements(v_campos) LOOP
    v_id    := c->>'id';
    v_label := COALESCE(c->>'label', v_id);
    v_ok := CASE v_id
      WHEN 'cooperativa'         THEN COALESCE(NULLIF(btrim(v_cfg.cooperativa),''),'')          <> ''
      WHEN 'posto'               THEN COALESCE(NULLIF(btrim(v_cfg.posto),''),'')                <> ''
      WHEN 'codigo_beneficiario' THEN COALESCE(NULLIF(btrim(v_cfg.codigo_beneficiario),''),'')  <> ''
      WHEN 'conta'               THEN COALESCE(NULLIF(btrim(v_cfg.conta),''),'')                <> ''
      WHEN 'convenio'            THEN COALESCE(NULLIF(btrim(v_cfg.convenio),''),'')             <> ''
      WHEN 'carteira'            THEN COALESCE(NULLIF(btrim(v_cfg.carteira),''),'')             <> ''
      WHEN 'agencia'             THEN COALESCE(NULLIF(btrim(v_cfg.agencia),''),'')              <> ''
      WHEN 'client_id'           THEN COALESCE(NULLIF(btrim(v_cfg.client_id),''),'')            <> ''
      WHEN 'api_key'             THEN v_cfg.api_key_vault_id       IS NOT NULL
      WHEN 'codigo_acesso'       THEN v_cfg.client_secret_vault_id IS NOT NULL
      WHEN 'client_secret'       THEN v_cfg.client_secret_vault_id IS NOT NULL
      WHEN 'cert'                THEN v_cfg.cert_vault_id          IS NOT NULL
      WHEN 'certpw'              THEN v_cfg.cert_senha_vault_id    IS NOT NULL
      ELSE true
    END;
    IF v_cfg IS NULL THEN v_ok := false; END IF;
    IF NOT v_ok THEN v_falta := array_append(v_falta, v_label); END IF;
  END LOOP;

  RETURN v_falta;
END; $function$;

-- ── fn_banco_fontes_copiaveis (leitura CROSS-TENANT — só PS-admin/admin/interno) ──────────────────
-- Lista empresas com config de banco copiável (nome + contadores). É cross-tenant por natureza (copiar
-- config de OUTRA empresa), então só PS_ADMIN/admin/interno. Convertida de SQL→plpgsql p/ a guarda;
-- assinatura/retorno inalterados; corpo (o SELECT) reproduzido fiel.
CREATE OR REPLACE FUNCTION public.fn_banco_fontes_copiaveis(p_provider text)
 RETURNS TABLE(company_id uuid, empresa text, provider text, banco_codigo text, boletos integer, syncs_ok integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()
          OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Apenas PS_ADMIN/admin pode listar configs de outras empresas' USING errcode='42501';
  END IF;
  RETURN QUERY
  SELECT f.company_id,
         coalesce(c.razao_social, c.nome_fantasia, left(f.company_id::text,8)),
         f.provider, f.banco_codigo,
         (SELECT count(*)::int FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL),
         (SELECT count(*)::int FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok')
  FROM erp_banco_provider_config f
  LEFT JOIN companies c ON c.id=f.company_id
  WHERE f.provider = p_provider AND f.ativo = true
    AND ( EXISTS(SELECT 1 FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL)
       OR EXISTS(SELECT 1 FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok') )
  GROUP BY f.company_id, c.razao_social, c.nome_fantasia, f.provider, f.banco_codigo;
END; $function$;

-- ── ACL ───────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_banco_teste_conexao_registrar(uuid,text,text,text,uuid,text,text,date,boolean,text,jsonb,integer,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_banco_teste_conexao_registrar(uuid,text,text,text,uuid,text,text,date,boolean,text,jsonb,integer,uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_extrato_importar_sistema(uuid,uuid,text,jsonb,date,date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_extrato_importar_sistema(uuid,uuid,text,jsonb,date,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_banco_campos_faltantes(uuid,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_banco_campos_faltantes(uuid,text,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_banco_fontes_copiaveis(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_banco_fontes_copiaveis(text) TO authenticated, service_role;
-- fn_banco_salvar_credencial: já guarda por user_companies + auth.uid() (anon não escreve). Só higiene de ACL.
REVOKE EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text) TO authenticated, service_role;
