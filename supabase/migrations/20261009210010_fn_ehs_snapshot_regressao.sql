-- PS EHS · E0 regressão (gilberto-chamados, decisão do Eng. Chefe 08/10)
-- Snapshot SÓ LEITURA, só números e hashes (sem nome/CPF), por empresa, para comparar antes/depois do deploy.
-- Executável só por service_role. Função nova: não altera nenhuma função/tabela existente.
CREATE OR REPLACE FUNCTION public.fn_ehs_snapshot_regressao(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT jsonb_build_object(
  'company_id', p_company_id,
  'funcionarios', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo),
      'com_setor', count(*) FILTER (WHERE setor_id IS NOT NULL),
      'hash', md5(coalesce(string_agg(id::text||':'||ativo::text||':'||coalesce(setor_id::text,'-'), ',' ORDER BY id), '')))
    FROM compliance_funcionarios WHERE company_id = p_company_id),
  'prestadores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo))
    FROM compliance_prestadores WHERE company_id = p_company_id),
  'setores', (SELECT jsonb_build_object('total', count(*), 'ativos', count(*) FILTER (WHERE ativo))
    FROM compliance_setores WHERE company_id = p_company_id),
  'documentos_por_status', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
    FROM (SELECT coalesce(status_validade,'(nulo)') s, count(*) n FROM compliance_documentos
          WHERE company_id = p_company_id AND ativo GROUP BY 1) x),
  'documentos_hash', (SELECT md5(coalesce(string_agg(id::text||':'||coalesce(status_validade,'')||':'||coalesce(data_validade::text,''), ',' ORDER BY id), ''))
    FROM compliance_documentos WHERE company_id = p_company_id AND ativo),
  'exigencias', (SELECT jsonb_build_object('exigidos', (SELECT count(*) FROM compliance_documento_exigido WHERE company_id = p_company_id AND ativo),
      'por_setor', (SELECT count(*) FROM compliance_exigencia_setor WHERE company_id = p_company_id AND ativo),
      'por_pessoa', (SELECT count(*) FROM compliance_exigencia_pessoa WHERE company_id = p_company_id AND ativo))),
  'calendario_por_status', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
    FROM (SELECT coalesce(status,'(nulo)') s, count(*) n FROM compliance_calendar_tarefas WHERE company_id = p_company_id GROUP BY 1) x),
  'pausas_apuradas_por_tipo_status', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('n', n, 'devido_min', dv, 'realizado_min', rl)), '{}'::jsonb)
    FROM (SELECT coalesce(tipo,'-')||'|'||coalesce(status,'-') k, count(*) n, coalesce(sum(devido_min),0) dv, coalesce(sum(realizado_min),0) rl
          FROM nr36_pausa_apurada WHERE company_id = p_company_id GROUP BY 1) x),
  'pausas_historico', (SELECT jsonb_build_object('total', count(*), 'soma_duracao_seg', coalesce(sum(duracao_seg),0)) FROM nr36_pausa_historico WHERE company_id = p_company_id),
  'ciencias_por_status', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
    FROM (SELECT coalesce(status,'(nulo)')||'|'||coalesce(tipo,'-') s, count(*) n FROM nr36_ciencia_mensal WHERE company_id = p_company_id GROUP BY 1) x),
  'ciencias_assinadas', (SELECT count(*) FROM nr36_ciencia_mensal WHERE company_id = p_company_id AND assinado_em IS NOT NULL),
  'epi', (SELECT jsonb_build_object(
      'fichas', (SELECT count(*) FROM epi_ficha WHERE company_id = p_company_id),
      'fichas_qtd_atual', (SELECT coalesce(sum(qtd_atual),0) FROM epi_ficha WHERE company_id = p_company_id),
      'movimentacoes', (SELECT count(*) FROM epi_movimentacao WHERE company_id = p_company_id),
      'assinaturas', (SELECT count(*) FROM epi_assinatura WHERE company_id = p_company_id),
      'assinaturas_validadas', (SELECT count(*) FROM epi_assinatura WHERE company_id = p_company_id AND validado),
      'tokens_por_status', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) FROM (SELECT coalesce(status,'(nulo)') s, count(*) n FROM compliance_epi_assinatura_tokens WHERE company_id = p_company_id GROUP BY 1) x),
      'catalogo', (SELECT count(*) FROM epi_catalogo WHERE company_id = p_company_id OR is_global),
      'estoque_disponivel', (SELECT coalesce(sum(qtd_disponivel),0) FROM epi_estoque WHERE company_id = p_company_id),
      'alertas_abertos', (SELECT count(*) FROM epi_alerta WHERE company_id = p_company_id AND status NOT IN ('resolvido','descartado'))))
);
$$;

REVOKE ALL ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) IS 'PS EHS E0: snapshot só leitura (contagens/somas/hashes, sem dado pessoal) para regressão antes/depois do deploy. service_role apenas.';
