-- PS EHS · E0 regressão (Eng. Chefe 08/10): snapshot SÓ-LEITURA por empresa, para provar "números iguais antes e depois"
-- de cada PR da vertical Compliance/EHS sem credencial de cliente. Devolve contagens, somas e hashes (md5 de ids+campos
-- numéricos/de status em ordem estável) por tela. NUNCA devolve nome, CPF ou texto livre. Executável só por service_role.
CREATE OR REPLACE FUNCTION public.fn_ehs_snapshot_regressao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '20s'
AS $$
DECLARE
  r jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;

  r := jsonb_build_object(
    'company_id', p_company_id,
    'funcionarios', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
        'hash', md5(coalesce(string_agg(id::text || ':' || ativo::text, ',' ORDER BY id), '')))
      FROM compliance_funcionarios WHERE company_id = p_company_id),
    'setores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
        'hash', md5(coalesce(string_agg(id::text || ':' || ativo::text, ',' ORDER BY id), '')))
      FROM compliance_setores WHERE company_id = p_company_id),
    'prestadores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
        'hash', md5(coalesce(string_agg(id::text || ':' || ativo::text, ',' ORDER BY id), '')))
      FROM compliance_prestadores WHERE company_id = p_company_id),
    'documentos_por_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status_validade, '_nulo') s, count(*) n FROM compliance_documentos
        WHERE company_id = p_company_id AND ativo GROUP BY 1) x), '{}'::jsonb),
    'documentos_hash', (SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(status_validade, '') || ':' || coalesce(data_validade::text, ''), ',' ORDER BY id), ''))
      FROM compliance_documentos WHERE company_id = p_company_id AND ativo),
    'calendario_por_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, '_nulo') s, count(*) n FROM compliance_calendar_tarefas
        WHERE company_id = p_company_id GROUP BY 1) x), '{}'::jsonb),
    'pausas_apuradas', (SELECT jsonb_build_object('total', count(*), 'devido_min', coalesce(sum(devido_min), 0),
        'realizado_min', coalesce(sum(realizado_min), 0), 'diferenca_min', coalesce(sum(diferenca_min), 0),
        'hash', md5(coalesce(string_agg(id::text || ':' || coalesce(status, ''), ',' ORDER BY id), '')))
      FROM nr36_pausa_apurada WHERE company_id = p_company_id),
    'pausas_por_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, '_nulo') s, count(*) n FROM nr36_pausa_apurada
        WHERE company_id = p_company_id GROUP BY 1) x), '{}'::jsonb),
    'pausas_por_tipo_status', coalesce((SELECT jsonb_object_agg(k, n) FROM (
        SELECT coalesce(tipo, '_nulo') || '/' || coalesce(status, '_nulo') k, count(*) n FROM nr36_pausa_apurada
        WHERE company_id = p_company_id GROUP BY 1) x), '{}'::jsonb),
    'ciencias_por_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, '_nulo') s, count(*) n FROM nr36_ciencia_mensal
        WHERE company_id = p_company_id GROUP BY 1) x), '{}'::jsonb),
    'ciencias_hash', (SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(status, '') || ':' || coalesce(versao::text, ''), ',' ORDER BY id), ''))
      FROM nr36_ciencia_mensal WHERE company_id = p_company_id),
    'epi_fichas', (SELECT jsonb_build_object('total', count(*), 'qtd_atual', coalesce(sum(qtd_atual), 0),
        'entregas', coalesce(sum(qtd_entregas_total), 0),
        'hash', md5(coalesce(string_agg(id::text || ':' || coalesce(status, ''), ',' ORDER BY id), '')))
      FROM epi_ficha WHERE company_id = p_company_id),
    'epi_movimentacoes', (SELECT jsonb_build_object('total', count(*), 'quantidade', coalesce(sum(quantidade), 0),
        'hash', md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')))
      FROM epi_movimentacao WHERE company_id = p_company_id),
    'epi_assinaturas', (SELECT jsonb_build_object('total', count(*), 'validadas', count(*) FILTER (WHERE validado),
        'hash', md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')))
      FROM epi_assinatura WHERE company_id = p_company_id),
    'epi_catalogo_empresa', (SELECT count(*) FROM epi_catalogo WHERE company_id = p_company_id),
    'epi_estoque', (SELECT jsonb_build_object('linhas', count(*), 'qtd_disponivel', coalesce(sum(qtd_disponivel), 0))
      FROM epi_estoque WHERE company_id = p_company_id),
    'epi_alertas_por_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, '_nulo') s, count(*) n FROM epi_alerta
        WHERE company_id = p_company_id GROUP BY 1) x), '{}'::jsonb)
  );
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) IS
  'PS EHS E0: snapshot só-leitura (contagens/somas/hashes, sem dado pessoal) da vertical Compliance por empresa; só service_role.';
