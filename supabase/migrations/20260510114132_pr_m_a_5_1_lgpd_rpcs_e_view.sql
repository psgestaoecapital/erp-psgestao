-- PR M.A.5.1 (cont): 5 RPCs LGPD + view + auto-popular inventario PII

-- RPC 1: registrar consentimento
CREATE OR REPLACE FUNCTION public.fn_lgpd_registrar_consentimento(
  p_user_id uuid,
  p_user_email text,
  p_finalidade_id text,
  p_consentido boolean,
  p_versao_termos text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_consent_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lgpd_finalidades_tratamento WHERE id = p_finalidade_id AND ativo = true) THEN
    RAISE EXCEPTION 'Finalidade % nao existe', p_finalidade_id;
  END IF;

  INSERT INTO lgpd_consentimentos_granulares (
    user_id, user_email, finalidade_id, consentido, versao_termos, ip, user_agent
  ) VALUES (
    p_user_id, p_user_email, p_finalidade_id, p_consentido, p_versao_termos, p_ip, p_user_agent
  ) RETURNING id INTO v_consent_id;

  RETURN v_consent_id;
END $func$;

-- RPC 2: revogar consentimento
CREATE OR REPLACE FUNCTION public.fn_lgpd_revogar_consentimento(
  p_user_id uuid, p_finalidade_id text, p_motivo text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE v_revogados integer;
BEGIN
  UPDATE lgpd_consentimentos_granulares
  SET data_revogacao = NOW(), motivo_revogacao = p_motivo
  WHERE user_id = p_user_id AND finalidade_id = p_finalidade_id
    AND data_revogacao IS NULL AND consentido = true;

  GET DIAGNOSTICS v_revogados = ROW_COUNT;
  RETURN v_revogados;
END $func$;

-- RPC 3: export dados (Art. 18 II + V)
CREATE OR REPLACE FUNCTION public.fn_lgpd_export_dados(
  p_user_id uuid, p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_resultado jsonb;
  v_user_data jsonb;
  v_consent_data jsonb;
  v_solicitacoes jsonb;
BEGIN
  SELECT to_jsonb(u.*) INTO v_user_data FROM auth.users u WHERE u.id = p_user_id;
  SELECT jsonb_agg(to_jsonb(c.*)) INTO v_consent_data
    FROM lgpd_consentimentos_granulares c WHERE c.user_id = p_user_id;
  SELECT jsonb_agg(to_jsonb(s.*)) INTO v_solicitacoes
    FROM lgpd_solicitacoes_titular s WHERE s.user_id = p_user_id;

  v_resultado := jsonb_build_object(
    'gerado_em', NOW(),
    'titular', v_user_data,
    'consentimentos', COALESCE(v_consent_data, '[]'::jsonb),
    'solicitacoes_anteriores', COALESCE(v_solicitacoes, '[]'::jsonb),
    'aviso', 'Export de dados pessoais (LGPD Art. 18 II e V). Para dados de uso operacional (lancamentos, DRE), abra solicitacao especifica de portabilidade.'
  );

  INSERT INTO lgpd_solicitacoes_titular (
    user_id, user_email, tipo_solicitacao, status, detalhes, data_conclusao
  ) VALUES (
    p_user_id, COALESCE(p_user_email, v_user_data->>'email'),
    'acesso_dados', 'concluida',
    jsonb_build_object('metodo', 'fn_lgpd_export_dados', 'gerado_em', NOW()),
    NOW()
  );

  RETURN v_resultado;
END $func$;

-- RPC 4: anonimizar dados (Art. 18 IV)
CREATE OR REPLACE FUNCTION public.fn_lgpd_anonimizar_dados(
  p_user_id uuid, p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_email_original text;
  v_solicitacao_id uuid;
BEGIN
  SELECT email INTO v_email_original FROM auth.users WHERE id = p_user_id;

  IF v_email_original IS NULL THEN
    RAISE EXCEPTION 'Usuario % nao encontrado', p_user_id;
  END IF;

  INSERT INTO lgpd_solicitacoes_titular (
    user_id, user_email, tipo_solicitacao, status, detalhes
  ) VALUES (
    p_user_id, v_email_original, 'anonimizacao', 'em_analise',
    jsonb_build_object('motivo', p_motivo, 'iniciado_em', NOW())
  ) RETURNING id INTO v_solicitacao_id;

  RETURN jsonb_build_object(
    'solicitacao_id', v_solicitacao_id,
    'status', 'em_analise',
    'aviso', 'Solicitacao registrada. DPO analisara e executara em ate 15 dias. Alguns dados podem ser retidos por obrigacao legal (Art. 16 LGPD).'
  );
END $func$;

-- RPC 5: dashboard DPO
CREATE OR REPLACE FUNCTION public.fn_lgpd_listar_solicitacoes_pendentes()
RETURNS TABLE (
  solicitacao_id uuid,
  user_email text,
  tipo_solicitacao text,
  status text,
  data_recebimento timestamptz,
  data_prazo_legal timestamptz,
  dias_restantes integer,
  urgencia text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.user_email, s.tipo_solicitacao, s.status,
    s.data_recebimento, s.data_prazo_legal,
    EXTRACT(DAY FROM (s.data_prazo_legal - NOW()))::integer,
    CASE
      WHEN s.data_prazo_legal < NOW() THEN 'VENCIDO'
      WHEN s.data_prazo_legal < NOW() + INTERVAL '3 days' THEN 'CRITICO'
      WHEN s.data_prazo_legal < NOW() + INTERVAL '7 days' THEN 'ATENCAO'
      ELSE 'NORMAL'
    END
  FROM lgpd_solicitacoes_titular s
  WHERE s.status IN ('recebida', 'em_analise', 'aguardando_titular')
  ORDER BY s.data_prazo_legal ASC;
END $func$;

-- View v_lgpd_status_compliance
DROP VIEW IF EXISTS public.v_lgpd_status_compliance CASCADE;
CREATE VIEW public.v_lgpd_status_compliance AS
SELECT 'bases_legais' AS componente, COUNT(*)::text AS total,
  CASE WHEN COUNT(*) >= 10 THEN 'completo' ELSE 'incompleto' END AS status
FROM lgpd_bases_legais WHERE ativo = true
UNION ALL
SELECT 'finalidades_catalogadas', COUNT(*)::text,
  CASE WHEN COUNT(*) >= 5 THEN 'completo' ELSE 'incompleto' END
FROM lgpd_finalidades_tratamento WHERE ativo = true
UNION ALL
SELECT 'consentimentos_granulares_ativos', COUNT(*)::text, 'operacional'
FROM lgpd_consentimentos_granulares WHERE data_revogacao IS NULL AND consentido = true
UNION ALL
SELECT 'solicitacoes_pendentes', COUNT(*)::text,
  CASE WHEN COUNT(*) FILTER (WHERE data_prazo_legal < NOW()) > 0
    THEN 'CRITICO_VENCIDO' ELSE 'no_prazo' END
FROM lgpd_solicitacoes_titular
WHERE status IN ('recebida', 'em_analise', 'aguardando_titular')
UNION ALL
SELECT 'inventario_pii_mapeado', COUNT(*)::text,
  CASE WHEN COUNT(*) >= 50 THEN 'completo'
       WHEN COUNT(*) >= 10 THEN 'parcial'
       ELSE 'inicial' END
FROM lgpd_inventario_dados;

-- Auto-popular inventario PII (varredura automatica das colunas)
INSERT INTO public.lgpd_inventario_dados (tabela, coluna, classificacao, observacao)
SELECT DISTINCT
  c.table_name,
  c.column_name,
  CASE
    WHEN c.column_name ILIKE '%cpf%' OR c.column_name ILIKE '%cnpj%'
      OR c.column_name ILIKE '%rg%' OR c.column_name ILIKE '%passport%'
      THEN 'pii_documento'
    WHEN c.column_name ILIKE '%senha%' OR c.column_name ILIKE '%password%'
      OR c.column_name ILIKE '%token%' OR c.column_name ILIKE '%hash%'
      THEN 'pii_credenciais'
    WHEN c.column_name ILIKE '%endereco%' OR c.column_name ILIKE '%cep%'
      OR c.column_name ILIKE '%cidade%' OR c.column_name ILIKE '%estado%'
      THEN 'pii_endereco'
    WHEN c.column_name ILIKE '%conta%' AND c.column_name ILIKE '%banc%'
      OR c.column_name ILIKE '%cartao%' OR c.column_name ILIKE '%agencia%'
      OR c.column_name ILIKE '%pix%'
      THEN 'pii_financeiro'
    WHEN c.column_name ILIKE '%saude%' OR c.column_name ILIKE '%biometr%'
      OR c.column_name ILIKE '%religi%' OR c.column_name ILIKE '%politic%'
      OR c.column_name ILIKE '%orient%'
      THEN 'pii_sensivel'
    WHEN c.column_name ILIKE '%email%' OR c.column_name ILIKE '%nome%'
      OR c.column_name ILIKE '%telefone%' OR c.column_name ILIKE '%phone%'
      OR c.column_name ILIKE '%nascimento%'
      THEN 'pii_basico'
    ELSE 'metadado'
  END AS classificacao,
  'Auto-classificado por fn_lgpd_auto_inventario PR M.A.5.1' AS observacao
FROM information_schema.columns c
JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = c.table_schema
WHERE c.table_schema = 'public'
  AND (
    c.column_name ILIKE '%cpf%' OR c.column_name ILIKE '%cnpj%'
    OR c.column_name ILIKE '%email%' OR c.column_name ILIKE '%phone%'
    OR c.column_name ILIKE '%telefone%' OR c.column_name ILIKE '%nome%'
    OR c.column_name ILIKE '%endereco%' OR c.column_name ILIKE '%nascimento%'
    OR c.column_name ILIKE '%rg%' OR c.column_name ILIKE '%cep%'
    OR c.column_name ILIKE '%senha%' OR c.column_name ILIKE '%token%'
    OR c.column_name ILIKE '%hash%' OR c.column_name ILIKE '%cartao%'
    OR c.column_name ILIKE '%pix%' OR c.column_name ILIKE '%passport%'
    OR c.column_name ILIKE '%saude%' OR c.column_name ILIKE '%biometr%'
  )
  AND t.tablename NOT LIKE '_admin_%'
  AND t.tablename NOT LIKE '_backup%'
ON CONFLICT (tabela, coluna) DO NOTHING;
