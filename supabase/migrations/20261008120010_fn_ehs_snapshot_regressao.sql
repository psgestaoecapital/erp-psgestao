-- PS EHS E0 (gilberto-chamados, 08/10): snapshot SOMENTE LEITURA para o teste de regressão com dado real.
-- Só contagens, somas e hashes por tela. Sem nome, CPF ou qualquer dado pessoal. Só service_role executa.
CREATE OR REPLACE FUNCTION public.fn_ehs_snapshot_regressao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
BEGIN
  SET LOCAL statement_timeout = '15s';
  SELECT jsonb_build_object(
    'company_id', p_company_id,
    'funcionarios', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
        'hash', coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '')) FROM compliance_funcionarios WHERE company_id = p_company_id),
    'setores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
        'hash', coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '')) FROM compliance_setores WHERE company_id = p_company_id),
    'prestadores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo)) FROM compliance_prestadores WHERE company_id = p_company_id),
    'documentos_por_status', (SELECT coalesce(jsonb_object_agg(coalesce(status_validade,'(nulo)'), n), '{}'::jsonb)
        FROM (SELECT status_validade, count(*) n FROM compliance_documentos WHERE company_id = p_company_id AND ativo GROUP BY 1) d),
    'documentos_hash', (SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '') FROM compliance_documentos WHERE company_id = p_company_id AND ativo),
    'pausas_apuradas_por_status', (SELECT coalesce(jsonb_object_agg(tipo||'/'||status, n), '{}'::jsonb)
        FROM (SELECT tipo, status, count(*) n FROM nr36_pausa_apurada WHERE company_id = p_company_id GROUP BY 1,2) p),
    'pausas_apuradas_soma_min', (SELECT jsonb_build_object('devido', coalesce(sum(devido_min),0), 'realizado', coalesce(sum(realizado_min),0))
        FROM nr36_pausa_apurada WHERE company_id = p_company_id),
    'ciencias_por_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
        FROM (SELECT status, count(*) n FROM nr36_ciencia_mensal WHERE company_id = p_company_id GROUP BY 1) c),
    'epi_fichas', (SELECT jsonb_build_object('total', count(*), 'qtd_atual', coalesce(sum(qtd_atual),0)) FROM epi_ficha WHERE company_id = p_company_id),
    'epi_movimentacoes', (SELECT jsonb_build_object('total', count(*), 'quantidade', coalesce(sum(quantidade),0)) FROM epi_movimentacao WHERE company_id = p_company_id),
    'epi_assinaturas', (SELECT jsonb_build_object('total', count(*), 'validadas', count(*) FILTER (WHERE validado)) FROM epi_assinatura WHERE company_id = p_company_id),
    'epi_estoque', (SELECT jsonb_build_object('itens', count(*), 'disponivel', coalesce(sum(qtd_disponivel),0)) FROM epi_estoque WHERE company_id = p_company_id),
    'epi_alertas_por_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
        FROM (SELECT status, count(*) n FROM epi_alerta WHERE company_id = p_company_id GROUP BY 1) a)
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) TO service_role;
