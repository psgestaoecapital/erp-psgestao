-- 🚨 LGPD — RPCs de NFS-e deixam de responder sem login (anon) + guarda de empresa.
--
-- Prova (18/09 10:25 UTC): POST /rest/v1/rpc/fn_listar_nfses_emitidas só com a anon key → HTTP 200 com
-- CPF/CNPJ/valores/PDF de OUTRA empresa. Causa: SECURITY DEFINER (fura a RLS, que está certa) + EXECUTE
-- para anon + corpo sem checar o usuário. Duas correções:
--  (1) REVOKE de anon/public em TODAS as RPCs public com 'nfse' que o anon executava (GRANT só a
--      authenticated/service_role). Nenhuma é chamada por rota pública/anon (webhook e emissão usam
--      service_role; o resto é browser autenticado — auditado 18/09).
--  (2) Guarda de empresa nas que recebem p_company_id, espelhando a RLS
--      nfse_emitidas_tenant_isolation (company_id IN user_companies do auth.uid()). service_role passa.
-- Escopo restrito às RPCs de NFS-e (a varredura das ~440 demais é decisão do CEO · contexto 6b5cad70).

-- ── (2) GUARDAS (CREATE OR REPLACE preservando assinatura e retorno) ─────────────────────────────

-- fn_listar_nfses_emitidas: sql → plpgsql (para caber a guarda). Corpo idêntico.
CREATE OR REPLACE FUNCTION public.fn_listar_nfses_emitidas(p_company_id uuid, p_status text DEFAULT NULL::text, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_busca text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, numero text, serie text, codigo_verificacao text, data_emissao timestamp with time zone, tomador_razao_social text, tomador_cnpj text, tomador_cpf text, valor_servicos numeric, valor_iss numeric, descricao_servico text, status text, motivo_rejeicao text, xml_url text, pdf_url text, xml_storage_path text, pdf_storage_path text, provider_reference text, criado_em timestamp with time zone, total_geral bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT * FROM erp_nfse_emitidas n
    WHERE n.company_id = p_company_id
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_data_inicio IS NULL OR n.data_emissao >= p_data_inicio::timestamptz)
      AND (p_data_fim IS NULL OR n.data_emissao <= (p_data_fim + 1)::timestamptz)
      AND (p_busca IS NULL OR p_busca = '' OR
           n.tomador_razao_social ILIKE '%' || p_busca || '%' OR
           n.numero ILIKE '%' || p_busca || '%' OR
           n.tomador_cnpj ILIKE '%' || p_busca || '%')
  )
  SELECT
    b.id, b.numero, b.serie, b.codigo_verificacao, b.data_emissao,
    b.tomador_razao_social, b.tomador_cnpj, b.tomador_cpf,
    b.valor_servicos, b.valor_iss, b.descricao_servico,
    b.status, b.motivo_rejeicao,
    b.xml_url, b.pdf_url, b.xml_storage_path, b.pdf_storage_path,
    b.provider_reference, b.criado_em,
    (SELECT COUNT(*) FROM base)::bigint AS total_geral
  FROM base b
  ORDER BY b.data_emissao DESC NULLS LAST, b.criado_em DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- fn_gov_nfse_proximo_numero: sql → plpgsql. Comportamento idêntico (NULL se não houver config).
CREATE OR REPLACE FUNCTION public.fn_gov_nfse_proximo_numero(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(gov_nfse_proximo_numero_dps, 1)
    FROM erp_fiscal_provider_config
    WHERE company_id = p_company_id AND provider = 'gov_nfse_nacional'
    LIMIT 1
  );
END;
$function$;

-- fn_proximo_numero_nfse (RETURNS TABLE serie/numero) — guarda + corpo idêntico.
CREATE OR REPLACE FUNCTION public.fn_proximo_numero_nfse(p_company_id uuid)
 RETURNS TABLE(serie text, numero bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE erp_fiscal_provider_config c
     SET proxima_numeracao_nfse = c.proxima_numeracao_nfse + 1,
         atualizado_em = now()
   WHERE c.company_id = p_company_id
     AND c.provider = 'gov_nfse_nacional'
     AND c.ativo = true
  RETURNING
    c.serie_nfse_padrao::text AS serie,
    (c.proxima_numeracao_nfse - 1)::bigint AS numero;
END;
$function$;

-- fn_ge_nfse_listar — guarda antes de qualquer leitura.
CREATE OR REPLACE FUNCTION public.fn_ge_nfse_listar(p_company_id uuid, p_ano integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_status text DEFAULT 'todas'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb;
  v_total_valor numeric := 0;
  v_total_iss numeric := 0;
  v_qtd_vinculadas int := 0;
  v_qtd_pendentes int := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN RETURN jsonb_build_object('sem_plano', true); END IF;

  SELECT
    jsonb_agg(jsonb_build_object(
      'id', id, 'numero', numero, 'serie', serie,
      'prestador_razao', prestador_razao, 'prestador_cnpj', prestador_cnpj,
      'data_emissao', data_emissao, 'valor_total', valor_total,
      'valor_iss', valor_iss, 'aliquota_iss', aliquota_iss,
      'codigo_servico', codigo_servico, 'discriminacao', discriminacao,
      'status', status, 'vinculado_pagar_id', vinculado_pagar_id, 'origem', origem
    ) ORDER BY data_emissao DESC),
    COALESCE(SUM(valor_total), 0),
    COALESCE(SUM(valor_iss), 0),
    COUNT(*) FILTER (WHERE status = 'vinculada')::int,
    COUNT(*) FILTER (WHERE status = 'recebida')::int
  INTO v_resultados, v_total_valor, v_total_iss, v_qtd_vinculadas, v_qtd_pendentes
  FROM erp_nfse_recebidas
  WHERE company_id = p_company_id
    AND (p_ano IS NULL OR EXTRACT(YEAR FROM data_emissao) = p_ano)
    AND (p_mes IS NULL OR EXTRACT(MONTH FROM data_emissao) = p_mes)
    AND (p_status = 'todas' OR status = p_status);

  RETURN jsonb_build_object(
    'resultados', COALESCE(v_resultados, '[]'::jsonb),
    'kpis', jsonb_build_object(
      'valor_total', v_total_valor,
      'valor_iss_total', v_total_iss,
      'qtd_vinculadas', v_qtd_vinculadas,
      'qtd_pendentes', v_qtd_pendentes
    )
  );
END;
$function$;

-- fn_gov_nfse_registrar_dps — guarda no início.
CREATE OR REPLACE FUNCTION public.fn_gov_nfse_registrar_dps(p_company_id uuid, p_nfse_emitida_id uuid, p_numero_dps integer, p_municipio_ibge text, p_municipio_nome text, p_payload_enviado jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dps_id uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  INSERT INTO erp_gov_nfse_dps (company_id, nfse_emitida_id, numero_dps,
    municipio_emissor_ibge, municipio_emissor_nome, payload_enviado, status_gov)
  VALUES (p_company_id, p_nfse_emitida_id, p_numero_dps,
    p_municipio_ibge, p_municipio_nome, p_payload_enviado, 'enviado')
  RETURNING id INTO v_dps_id;

  UPDATE erp_fiscal_provider_config
  SET gov_nfse_proximo_numero_dps = COALESCE(gov_nfse_proximo_numero_dps, 1) + 1,
      atualizado_em = NOW()
  WHERE company_id = p_company_id AND provider = 'gov_nfse_nacional';

  RETURN jsonb_build_object('ok', true, 'dps_id', v_dps_id, 'numero_dps', p_numero_dps);
END;
$function$;

-- fn_nfse_obra_pendente — guarda no início (STABLE preservado).
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_pendente(p_company_id uuid, p_codigo_servico text, p_obra_id uuid DEFAULT NULL::uuid, p_cno text DEFAULT NULL::text, p_endereco text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_exige boolean; v_tem_cno boolean := false; v_tem_end boolean := false;
        v_ibge_uf text; v_mismatch boolean := false; o record;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_exige := public.fn_fiscal_exige_obra(p_company_id, p_codigo_servico);
  IF NOT v_exige THEN RETURN jsonb_build_object('exige_obra', false, 'pendente', false); END IF;

  v_tem_cno := length(regexp_replace(COALESCE(p_cno,''),'[^0-9]','','g')) > 0;
  v_tem_end := length(btrim(COALESCE(p_endereco,''))) > 0;

  IF NOT (v_tem_cno OR v_tem_end) AND p_obra_id IS NOT NULL THEN
    SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND company_id = p_company_id LIMIT 1;
    IF FOUND THEN
      IF length(regexp_replace(COALESCE(o.cno, o.codigo_obra_municipal, ''),'[^0-9]','','g')) > 0 THEN
        v_tem_cno := true;
      END IF;
      IF btrim(COALESCE(o.endereco,'')) <> ''
         AND btrim(COALESCE(o.numero_endereco,'')) <> ''
         AND btrim(COALESCE(o.cidade,'')) <> ''
         AND btrim(COALESCE(o.uf,'')) <> ''
         AND length(regexp_replace(COALESCE(o.cep,''),'[^0-9]','','g')) >= 8
         AND length(regexp_replace(COALESCE(o.codigo_ibge_municipio,''),'[^0-9]','','g')) = 7
      THEN
        SELECT uf INTO v_ibge_uf FROM public.erp_gov_nfse_municipios
         WHERE codigo_ibge = regexp_replace(o.codigo_ibge_municipio,'[^0-9]','','g') LIMIT 1;
        IF v_ibge_uf IS NOT NULL AND v_ibge_uf = upper(btrim(o.uf)) THEN
          v_tem_end := true;
        ELSE
          v_mismatch := true;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'exige_obra', true,
    'pendente', NOT (v_tem_cno OR v_tem_end),
    'mensagem', CASE
      WHEN (v_tem_cno OR v_tem_end) THEN NULL
      WHEN v_mismatch THEN 'O código do município (IBGE) não corresponde à cidade/UF informada — confira o endereço da obra.'
      ELSE 'Este serviço é de construção (regra E0370): informe o CNO ou o endereço completo da obra (logradouro, número, município/IBGE, UF e CEP) antes de emitir. Sem um dos dois, a prefeitura rejeita a nota.' END);
END;
$function$;

-- fn_nfse_obra_resolver — guarda no início (STABLE preservado).
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_resolver(p_company_id uuid, p_erp_receber_id uuid DEFAULT NULL::uuid, p_obra_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_obra_id uuid; o record;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_obra_id := p_obra_id;
  IF v_obra_id IS NULL AND p_erp_receber_id IS NOT NULL THEN
    SELECT po.id INTO v_obra_id
    FROM public.erp_receber r
    JOIN public.erp_pedidos pe ON pe.id = r.pedido_id
    JOIN public.projetos_obras po ON po.orcamento_id = pe.orcamento_origem_id
    WHERE r.id = p_erp_receber_id AND r.company_id = p_company_id
    LIMIT 1;
  END IF;
  IF v_obra_id IS NULL THEN RETURN jsonb_build_object('encontrada', false); END IF;

  SELECT * INTO o FROM public.projetos_obras WHERE id = v_obra_id AND company_id = p_company_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('encontrada', false); END IF;

  RETURN jsonb_build_object(
    'encontrada', true, 'obra_id', o.id, 'numero', o.numero,
    'cno', o.cno, 'codigo_obra_municipal', o.codigo_obra_municipal,
    'logradouro', o.endereco, 'numero_endereco', o.numero_endereco, 'bairro', o.bairro,
    'cidade', o.cidade, 'uf', o.uf, 'cep', o.cep, 'codigo_ibge', o.codigo_ibge_municipio);
END;
$function$;

-- fn_nfse_validar_emissao — guarda no início (STABLE preservado).
CREATE OR REPLACE FUNCTION public.fn_nfse_validar_emissao(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servico record; v_bloqueios jsonb := '[]'::jsonb;
  v_exige_obra jsonb; v_iss jsonb;
  v_obra_id uuid; v_obra_cno text; v_obra_ibge text;
  v_ibge text; v_data date := COALESCE((p_dados->>'data_emissao')::date, CURRENT_DATE);
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_servico FROM erp_servicos
   WHERE id = (p_dados->>'servico_id')::uuid AND company_id = p_company_id;
  IF v_servico.id IS NULL THEN
    RETURN jsonb_build_object('pode_emitir', false, 'bloqueios',
      jsonb_build_array(jsonb_build_object(
        'codigo','servico_nao_encontrado',
        'mensagem','Servico nao encontrado para esta empresa.')));
  END IF;

  IF (p_dados->>'obra_id') IS NOT NULL THEN
    SELECT id, cno, codigo_ibge_municipio INTO v_obra_id, v_obra_cno, v_obra_ibge
      FROM projetos_obras
     WHERE id = (p_dados->>'obra_id')::uuid AND company_id = p_company_id;
  END IF;

  IF COALESCE(btrim(v_servico.codigo_lc116),'') = '' THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo','servico_sem_lc116',
      'mensagem','O servico nao tem o codigo da LC 116 cadastrado.',
      'acao','Cadastre o codigo no servico antes de emitir.',
      'onde','cadastro do servico');
  END IF;

  v_exige_obra := public.fn_nfse_obra_exigencia(v_servico.codigo_lc116);
  IF COALESCE((v_exige_obra->>'exige')::boolean, false) THEN
    IF (p_dados->>'obra_id') IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_obrigatoria',
        'mensagem','O servico ' || COALESCE(v_exige_obra->>'subitem_repr', v_servico.codigo_lc116)
                   || ' exige informacao de obra na nota.',
        'acao','Vincule a nota a uma obra.',
        'onde','faturamento');
    ELSIF v_obra_id IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_nao_encontrada',
        'mensagem','A obra informada nao foi encontrada para esta empresa.',
        'acao','Escolha uma obra valida.', 'onde','faturamento');
    ELSIF COALESCE(btrim(v_obra_cno),'') = '' THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_sem_cno',
        'mensagem','A obra nao tem CNO cadastrado.',
        'acao','Informe o CNO na obra.', 'onde','cadastro da obra');
    END IF;
  END IF;

  IF COALESCE(v_servico.iss_no_local_prestacao, false) THEN
    v_ibge := COALESCE(v_obra_ibge, p_dados->>'municipio_prestacao_ibge');
    IF COALESCE(btrim(v_ibge),'') = '' THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','municipio_prestacao_ausente',
        'mensagem','Este servico tem ISS devido no municipio da execucao.',
        'acao','Informe onde o servico foi prestado.', 'onde','faturamento');
    ELSE
      v_iss := public.fn_fiscal_iss_resolver(
        p_company_id, v_ibge, v_servico.codigo_lc116, v_data);
      IF NOT COALESCE((v_iss->>'ok')::boolean, false) THEN
        v_bloqueios := v_bloqueios || jsonb_build_object(
          'codigo','aliquota_iss_desconhecida',
          'mensagem','A aliquota de ISS de ' || COALESCE(v_iss->>'municipio', v_ibge)
                     || ' para o servico ' || v_servico.codigo_lc116 || ' nao esta cadastrada.',
          'acao','Cadastre a aliquota ou consulte o contador.',
          'onde','configuracoes/fiscal/iss-municipios',
          'municipio_ibge', v_ibge, 'codigo_lc116', v_servico.codigo_lc116);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pode_emitir', jsonb_array_length(v_bloqueios) = 0,
    'bloqueios', v_bloqueios,
    'iss', v_iss,
    'municipio_prestacao_ibge', v_ibge,
    'exige_obra', COALESCE((v_exige_obra->>'exige')::boolean, false));
END $function$;

-- fn_registrar_nfse_emitida — guarda no início (corpo do #1534, com payload_enviado).
CREATE OR REPLACE FUNCTION public.fn_registrar_nfse_emitida(p_company_id uuid, p_erp_receber_id uuid, p_provider_reference text, p_ambiente text, p_dados jsonb, p_provider_raw jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_id UUID;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.erp_nfse_emitidas (
    company_id, erp_receber_id, provider_reference, ambiente,
    valor_servicos, valor_iss, aliquota_iss, retem_iss,
    cnae, codigo_servico, descricao_servico,
    prestador_cnpj, prestador_razao_social, prestador_im,
    tomador_cnpj, tomador_cpf, tomador_razao_social, tomador_email, tomador_endereco,
    status, numero, serie, codigo_verificacao,
    xml_url, pdf_url, motivo_rejeicao,
    municipio_prestacao_ibge, municipio_prestacao_nome, municipio_prestacao_uf, iss_fonte_aliquota,
    provider_raw, payload_enviado, emitido_por
  ) VALUES (
    p_company_id, p_erp_receber_id, p_provider_reference, p_ambiente,
    (p_dados->>'valor_servicos')::numeric,
    NULLIF(p_dados->>'valor_iss','')::numeric,
    NULLIF(p_dados->>'aliquota_iss','')::numeric,
    COALESCE((p_dados->>'retem_iss')::boolean, false),
    p_dados->>'cnae', p_dados->>'codigo_servico', p_dados->>'descricao_servico',
    p_dados->>'prestador_cnpj', p_dados->>'prestador_razao_social', p_dados->>'prestador_im',
    p_dados->>'tomador_cnpj', p_dados->>'tomador_cpf', p_dados->>'tomador_razao_social',
    p_dados->>'tomador_email', p_dados->'tomador_endereco',
    COALESCE(p_dados->>'status','processando'),
    p_dados->>'numero', p_dados->>'serie', p_dados->>'codigo_verificacao',
    p_dados->>'xml_url', p_dados->>'pdf_url', p_dados->>'motivo_rejeicao',
    NULLIF(p_dados->>'municipio_prestacao_ibge',''),
    NULLIF(p_dados->>'municipio_prestacao_nome',''),
    NULLIF(p_dados->>'municipio_prestacao_uf',''),
    NULLIF(p_dados->>'iss_fonte_aliquota',''),
    p_provider_raw, p_dados->'payload_enviado', auth.uid()
  ) RETURNING id INTO v_id;
  IF p_erp_receber_id IS NOT NULL THEN
    UPDATE public.erp_receber
    SET observacoes = COALESCE(observacoes, '') || format(E'\nNFSe emitida em %s - ref %s', NOW()::date, p_provider_reference)
    WHERE id = p_erp_receber_id;
  END IF;
  RETURN v_id;
END;
$function$;

-- ── (1) REVOKE anon/public + GRANT authenticated/service_role em TODAS as RPCs de NFS-e ──────────
DO $do$
DECLARE r regprocedure;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname ILIKE '%nfse%'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public;', r);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', r);
  END LOOP;
END
$do$;
