-- PS EHS E0 (regressão): snapshot SÓ LEITURA, só números (sem nome/CPF), por empresa.
-- O teste de aceitação grava o snapshot antes do deploy e compara depois. Função NOVA (aditiva).
CREATE OR REPLACE FUNCTION public.fn_ehs_snapshot_regressao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company_id', p_company_id,
    'funcionarios', jsonb_build_object(
      'total', (SELECT count(*) FROM compliance_funcionarios WHERE company_id = p_company_id),
      'ativos', (SELECT count(*) FROM compliance_funcionarios WHERE company_id = p_company_id AND ativo)),
    'setores', jsonb_build_object(
      'total', (SELECT count(*) FROM compliance_setores WHERE company_id = p_company_id),
      'ativos', (SELECT count(*) FROM compliance_setores WHERE company_id = p_company_id AND ativo)),
    'prestadores', (SELECT count(*) FROM compliance_prestadores WHERE company_id = p_company_id),
    'documentos', jsonb_build_object(
      'total', (SELECT count(*) FROM compliance_documentos WHERE company_id = p_company_id),
      'ativos', (SELECT count(*) FROM compliance_documentos WHERE company_id = p_company_id AND ativo),
      'exigidos', (SELECT count(*) FROM compliance_documento_exigido WHERE company_id = p_company_id AND ativo)),
    'calendario_por_status', COALESCE((SELECT jsonb_object_agg(coalesce(status,'-'), n) FROM (
        SELECT status, count(*) n FROM compliance_calendar_tarefas WHERE company_id = p_company_id GROUP BY status) x), '{}'::jsonb),
    'pausas_apuradas_por_tipo_status', COALESCE((SELECT jsonb_object_agg(coalesce(tipo,'-')||'/'||coalesce(status,'-'), n) FROM (
        SELECT tipo, status, count(*) n FROM nr36_pausa_apurada WHERE company_id = p_company_id GROUP BY tipo, status) x), '{}'::jsonb),
    'ciencias_por_status', COALESCE((SELECT jsonb_object_agg(coalesce(status,'-'), n) FROM (
        SELECT status, count(*) n FROM nr36_ciencia_mensal WHERE company_id = p_company_id GROUP BY status) x), '{}'::jsonb),
    'ciencias_assinadas', (SELECT count(*) FROM nr36_ciencia_mensal WHERE company_id = p_company_id AND assinado_em IS NOT NULL),
    'epi', jsonb_build_object(
      'fichas_por_status', COALESCE((SELECT jsonb_object_agg(coalesce(status,'-'), n) FROM (
          SELECT status, count(*) n FROM epi_ficha WHERE company_id = p_company_id GROUP BY status) x), '{}'::jsonb),
      'assinaturas', (SELECT count(*) FROM epi_assinatura WHERE company_id = p_company_id),
      'assinaturas_assinadas', (SELECT count(*) FROM epi_assinatura WHERE company_id = p_company_id AND assinado_em IS NOT NULL),
      'alertas_por_status', COALESCE((SELECT jsonb_object_agg(coalesce(status,'-'), n) FROM (
          SELECT status, count(*) n FROM epi_alerta WHERE company_id = p_company_id GROUP BY status) x), '{}'::jsonb),
      'catalogo', (SELECT count(*) FROM epi_catalogo WHERE company_id = p_company_id),
      'estoque', (SELECT count(*) FROM epi_estoque WHERE company_id = p_company_id),
      'movimentacoes', (SELECT count(*) FROM epi_movimentacao WHERE company_id = p_company_id))
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) TO service_role;
