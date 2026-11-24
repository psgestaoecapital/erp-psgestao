-- Canal PS · leitura cross-empresa para a Claude dos sócios — NÍVEL 1 (RPCs prontas, curadas e seguras).
-- Decisão CEO 23/11: só leitura, todas as empresas, liberado para os sócios de erp_aprovador_pr (Gilberto/Rodrigo/Jordana).
-- NÍVEL 2 (fn_diag_sql · SQL livre) NÃO entra nesta migration: expõe segredos/credenciais/PII de todas as empresas via
-- SECURITY DEFINER (vault.decrypted_secrets, auth.users, erp_fiscal_provider_config.*_secret) e contraria o invariante
-- documentado do Canal PS ("sem SQL livre"). Fica para decisão explícita do CEO sobre um desenho ENDURECIDO (allowlist).
-- Todas as funções: SECURITY DEFINER, só leitura, porteiro fn__diagnostico_socio_pode no início, REVOKE anon.

-- ───────────── 1. porteiro (base) ─────────────
CREATE OR REPLACE FUNCTION public.fn__diagnostico_socio_pode()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.erp_aprovador_pr a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.user_id = auth.uid() AND a.ativo AND coalesce(u.is_robo,false) = false
  );
$$;
REVOKE ALL ON FUNCTION public.fn__diagnostico_socio_pode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__diagnostico_socio_pode() TO authenticated, service_role;

-- ───────────── 2. empresas (todas), por nome ou IM ─────────────
CREATE OR REPLACE FUNCTION public.fn_diag_empresas(p_busca text DEFAULT NULL, p_limite int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.fn__diagnostico_socio_pode() THEN RAISE EXCEPTION 'Sem permissão para diagnóstico' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'razao', razao_social, 'fantasia', nome_fantasia,
      'cidade', cidade, 'uf', uf_fiscal, 'cod_ibge', codigo_ibge_municipio, 'regime', regime_tributario)), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.companies
      WHERE p_busca IS NULL
         OR razao_social ILIKE '%'||p_busca||'%'
         OR nome_fantasia ILIKE '%'||p_busca||'%'
         OR regexp_replace(coalesce(inscricao_municipal,''),'\D','','g') ILIKE '%'||regexp_replace(coalesce(p_busca,''),'\D','','g')||'%'
      ORDER BY nome_fantasia LIMIT least(greatest(coalesce(p_limite,50),1),200)) s;
  RETURN jsonb_build_object('ok', true, 'dados', v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.fn_diag_empresas(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diag_empresas(text,int) TO authenticated, service_role;

-- ───────────── 3. NFS-e emitidas de uma empresa (número, status, MOTIVO da rejeição) ─────────────
CREATE OR REPLACE FUNCTION public.fn_diag_nfse(p_company_id uuid, p_limite int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.fn__diagnostico_socio_pode() THEN RAISE EXCEPTION 'Sem permissão para diagnóstico' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'numero', numero, 'serie', serie, 'status', status, 'data', data_emissao,
      'codigo_servico', codigo_servico, 'motivo_rejeicao', motivo_rejeicao, 'provider', provider)
      ORDER BY coalesce(data_emissao, criado_em) DESC), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.erp_nfse_emitidas WHERE company_id = p_company_id
      ORDER BY coalesce(data_emissao, criado_em) DESC LIMIT least(greatest(coalesce(p_limite,30),1),200)) s;
  RETURN jsonb_build_object('ok', true, 'dados', v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.fn_diag_nfse(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diag_nfse(uuid,int) TO authenticated, service_role;

-- ───────────── 4. resumo financeiro cross-empresa do período (soma das baixas brutas) ─────────────
-- Calcula DIRETO (cross-empresa, protegido pelo porteiro) em vez de delegar ao fn_caixa_grupo_periodo — este re-filtra
-- pelas empresas do auth.uid() (get_user_company_ids()), o que limitaria o sócio à própria carteira. Mesma definição de
-- "bruto" (soma de erp_receber_baixa/erp_pagar_baixa no intervalo, deleted_at IS NULL).
CREATE OR REPLACE FUNCTION public.fn_diag_financeiro(p_company_ids uuid[], p_ini date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_cons jsonb;
BEGIN
  IF NOT public.fn__diagnostico_socio_pode() THEN RAISE EXCEPTION 'Sem permissão para diagnóstico' USING ERRCODE='42501'; END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', '[]'::jsonb,
      'consolidado', jsonb_build_object('recebido_bruto',0,'pago_bruto',0)); END IF;
  WITH rb AS (SELECT b.company_id cid, COALESCE(SUM(b.valor),0) v FROM erp_receber_baixa b
     WHERE b.company_id = ANY(p_company_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim GROUP BY b.company_id),
  pb AS (SELECT b.company_id cid, COALESCE(SUM(b.valor),0) v FROM erp_pagar_baixa b
     WHERE b.company_id = ANY(p_company_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim GROUP BY b.company_id),
  ef AS (SELECT co.id cid, coalesce(co.nome_fantasia,co.razao_social) nome,
      round(COALESCE(rb.v,0),2) recebido_bruto, round(COALESCE(pb.v,0),2) pago_bruto
    FROM unnest(p_company_ids) vid JOIN companies co ON co.id=vid
    LEFT JOIN rb ON rb.cid=vid LEFT JOIN pb ON pb.cid=vid)
  SELECT coalesce(jsonb_agg(jsonb_build_object('company_id',ef.cid,'nome',ef.nome,
      'recebido_bruto',ef.recebido_bruto,'pago_bruto',ef.pago_bruto) ORDER BY ef.nome),'[]'::jsonb),
    jsonb_build_object('recebido_bruto',round(COALESCE(SUM(ef.recebido_bruto),0),2),'pago_bruto',round(COALESCE(SUM(ef.pago_bruto),0),2))
    INTO v_rows, v_cons FROM ef;
  RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', v_rows, 'consolidado', v_cons);
END; $$;
REVOKE ALL ON FUNCTION public.fn_diag_financeiro(uuid[],date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diag_financeiro(uuid[],date,date) TO authenticated, service_role;

-- ───────────── 5. chamado completo (sugestão + mensagens + empresa) ─────────────
CREATE OR REPLACE FUNCTION public.fn_diag_chamado(p_numero int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.fn__diagnostico_socio_pode() THEN RAISE EXCEPTION 'Sem permissão para diagnóstico' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
      'chamado', to_jsonb(s.*) - 'embedding',
      'empresa', (SELECT jsonb_build_object('id', c.id, 'fantasia', c.nome_fantasia) FROM public.companies c WHERE c.id = s.company_id),
      'mensagens', (SELECT coalesce(jsonb_agg(to_jsonb(m.*) ORDER BY m.criado_em), '[]'::jsonb)
                     FROM public.sugestao_mensagem m WHERE m.sugestao_id = s.id))
    INTO v_out FROM public.sugestoes s WHERE s.numero = p_numero;
  RETURN coalesce(v_out, jsonb_build_object('ok', false, 'erro', 'chamado não encontrado'));
END; $$;
REVOKE ALL ON FUNCTION public.fn_diag_chamado(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diag_chamado(int) TO authenticated, service_role;
