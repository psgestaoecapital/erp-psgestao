-- GE-F7 follow-up (decisao CEO 26/09 · PR #1813 obs. 1) + gate de colisao de version (140000: #1811 x #1813).
-- (1) listagem: JOIN na fila, exclui tentativas >= 5 — fonte unica do "listavel"
-- (2) view: pendentes = so o listavel; o resto classificado (nao_arquivaveis / arquivadas_fila_orfa / fila_sem_doc)
-- (3) briefing: expoe a classificacao; sinal nao pinta VERMELHO por linha nao-listavel (RD-64)
-- (4) dispatch: curto-circuito pela MESMA listagem (nao chama a edge para processar zero)
-- (5) fn_migrations_ledger(): RPC service_role-only para o gate de CI ler supabase_migrations.schema_migrations
-- Prova 26/09 dos 21 "pendentes": 13 NF-e ja arquivadas com fila nao marcada + 8 canceladas (2 NF-e, 6 NFS-e).
-- Nenhuma linha da fila e alterada (RD-30): so classificacao.

-- ---------- (1) listagem ----------
CREATE OR REPLACE FUNCTION public.fn_fiscal_listar_pendentes_storage(p_limit integer DEFAULT 50)
RETURNS TABLE(tabela text, doc_id uuid, company_id uuid, numero text, xml_url text, pdf_url text, data_emissao timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'nfse'::text AS tabela, n.id AS doc_id, n.company_id, n.numero, n.xml_url, n.pdf_url, n.data_emissao
  FROM erp_nfse_emitidas n
  LEFT JOIN erp_fiscal_storage_queue q ON q.tabela = 'nfse' AND q.doc_id = n.id
  WHERE n.status = 'autorizada' AND n.xml_url IS NOT NULL AND n.xml_storage_path IS NULL
    AND coalesce(q.tentativas, 0) < 5
  UNION ALL
  SELECT 'nfe'::text, n.id, n.company_id, n.numero, n.xml_url, n.danfe_url AS pdf_url, n.data_emissao
  FROM erp_nfe_emitidas n
  LEFT JOIN erp_fiscal_storage_queue q ON q.tabela = 'nfe' AND q.doc_id = n.id
  WHERE n.status = 'autorizada' AND n.xml_url IS NOT NULL AND n.xml_storage_path IS NULL
    AND coalesce(q.tentativas, 0) < 5
  ORDER BY data_emissao ASC NULLS LAST
  LIMIT p_limit;
$$;
-- so a edge (service key) chama; nenhum chamador em src/. Antes: aberta a anon (grandfathered).
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_listar_pendentes_storage(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_fiscal_listar_pendentes_storage(integer) TO service_role;

-- ---------- (2) view ----------
CREATE OR REPLACE VIEW public.v_fiscal_storage_status AS
WITH f AS (
  SELECT fq.*,
    CASE fq.tabela WHEN 'nfse' THEN n.id               WHEN 'nfe' THEN e.id               END AS doc_existe_id,
    CASE fq.tabela WHEN 'nfse' THEN n.status           WHEN 'nfe' THEN e.status           END AS doc_status,
    CASE fq.tabela WHEN 'nfse' THEN n.xml_url          WHEN 'nfe' THEN e.xml_url          END AS doc_xml_url,
    CASE fq.tabela WHEN 'nfse' THEN n.xml_storage_path WHEN 'nfe' THEN e.xml_storage_path END AS doc_storage_path
  FROM erp_fiscal_storage_queue fq
  LEFT JOIN erp_nfse_emitidas n ON fq.tabela = 'nfse' AND n.id = fq.doc_id
  LEFT JOIN erp_nfe_emitidas  e ON fq.tabela = 'nfe'  AND e.id = fq.doc_id
), c AS (
  SELECT f.*,
    CASE
      WHEN f.processado                                        THEN 'processado'
      WHEN f.doc_existe_id IS NULL                             THEN 'fila_sem_doc'
      WHEN f.doc_storage_path IS NOT NULL                      THEN 'arquivada_fila_orfa'
      WHEN f.doc_status <> 'autorizada' OR f.doc_xml_url IS NULL THEN 'nao_arquivavel'
      WHEN f.tentativas >= 5                                   THEN 'falha_repetida'
      ELSE 'pendente'
    END AS classe
  FROM f
)
SELECT
  count(*) FILTER (WHERE classe = 'pendente')            AS pendentes,
  count(*) FILTER (WHERE classe = 'processado')          AS processados,
  count(*) FILTER (WHERE classe = 'falha_repetida')      AS falhas_repetidas,
  (SELECT count(*) FROM erp_nfse_emitidas WHERE xml_storage_path IS NOT NULL) AS nfse_armazenadas,
  (SELECT count(*) FROM erp_nfe_emitidas  WHERE xml_storage_path IS NOT NULL) AS nfe_armazenadas,
  max(processado_em)  FILTER (WHERE classe = 'processado') AS ultimo_processado_em,
  min(enfileirado_em) FILTER (WHERE classe = 'pendente')   AS mais_antigo_pendente,
  count(*) FILTER (WHERE classe = 'nao_arquivavel')      AS nao_arquivaveis,
  count(*) FILTER (WHERE classe = 'arquivada_fila_orfa') AS arquivadas_fila_orfa,
  count(*) FILTER (WHERE classe = 'fila_sem_doc')        AS fila_sem_doc
FROM c;
COMMENT ON VIEW public.v_fiscal_storage_status IS 'Fila de arquivamento fiscal classificada: pendentes = so o listavel por fn_fiscal_listar_pendentes_storage (tentativas<5). nao_arquivaveis = doc cancelado/sem xml_url. arquivadas_fila_orfa = doc ja com xml_storage_path mas fila nao marcada. falhas_repetidas = tentativas>=5.';

-- ---------- (3) briefing ----------
CREATE OR REPLACE FUNCTION public.fn_fiscal_storage_briefing() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'pendentes', s.pendentes, 'processados', s.processados, 'falhas_repetidas', s.falhas_repetidas,
    'nao_arquivaveis', s.nao_arquivaveis, 'arquivadas_fila_orfa', s.arquivadas_fila_orfa, 'fila_sem_doc', s.fila_sem_doc,
    'ultimo_processado_em', s.ultimo_processado_em, 'mais_antigo_pendente', s.mais_antigo_pendente,
    'sinal', CASE WHEN s.ultimo_processado_em IS NULL THEN 'CINZA: nunca processou'
                  WHEN s.ultimo_processado_em < now() - interval '2 hours' AND s.pendentes > 0 THEN 'VERMELHO: pendentes listaveis e worker parado > 2h'
                  WHEN s.falhas_repetidas > 0 THEN 'AMARELO: documentos com 5+ falhas (URL da Focus expirada?)'
                  ELSE 'VERDE' END,
    'nota', CASE WHEN s.nao_arquivaveis + s.arquivadas_fila_orfa + s.fila_sem_doc > 0
                 THEN 'linhas da fila fora do listavel (cancelada / ja arquivada / sem doc) nao contam como pendentes — RD-64' END)
  FROM v_fiscal_storage_status s
$$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_storage_briefing() FROM PUBLIC, anon;

-- ---------- (4) dispatch: curto-circuito pela listagem ----------
CREATE OR REPLACE FUNCTION public.fn_fiscal_storage_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_service_role text; v_url_base text := 'https://horsymhsinqcimflrtjo.supabase.co'; v_pendentes int; v_request_id bigint;
BEGIN
  -- curto-circuito pela MESMA listagem que a edge usa (fonte unica, RD-65): sem listavel, nao chama a edge.
  -- Antes contava a fila (NOT processado AND tentativas<5) e chamava a edge a cada 15 min por 21 linhas que rendiam zero.
  SELECT count(*) INTO v_pendentes FROM fn_fiscal_listar_pendentes_storage(50);
  IF v_pendentes = 0 THEN RETURN jsonb_build_object('ok', true, 'pendentes', 0, 'pulado', true); END IF;

  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_fiscal_storage_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/fiscal-storage-worker?limit=50',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body    := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'pendentes', v_pendentes, 'request_id', v_request_id, 'ts', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_storage_dispatch() FROM PUBLIC, anon, authenticated;

-- ---------- (5) ledger para o gate de CI ----------
-- supabase_migrations.schema_migrations nao e exposto pelo PostgREST; o gate (scripts/check-migration-versions.ts)
-- le por esta RPC com a service key e falha o PR se uma migration nova tiver version ja aplicada com OUTRO nome
-- (o db push pularia o arquivo em silencio — foi o que quase aconteceu com 140000 em 26/09).
CREATE OR REPLACE FUNCTION public.fn_migrations_ledger()
RETURNS TABLE(version text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'supabase_migrations', 'public' AS $$
  SELECT m.version::text, m.name::text FROM supabase_migrations.schema_migrations m ORDER BY m.version
$$;
REVOKE EXECUTE ON FUNCTION public.fn_migrations_ledger() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_migrations_ledger() TO service_role;
