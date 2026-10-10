-- #933 (Gean Auto Mecânica) — tela de NF-es emitidas.
-- Causa provada no dado: NF-e de devolução de compra não tem título/pedido/OS/origem, então caía em
-- 'doc:<id>' e cada "Corrigir e reenviar" virava uma linha nova (ref ...225833: 2 recusas + NF 646 = 3 linhas).
-- Correção: com p_agrupar, nota sem vínculo e COM chave_referenciada agrupa em
--   'dev:<chave_referenciada>:<âncora>', onde âncora = id da 1ª tentativa NÃO recusada (por criado_em, id)
--   a partir desta nota, ou 'pendente' se ainda não houve nenhuma.
-- Assim as recusas se juntam à nota que as sucedeu, e duas devoluções parciais da mesma NF de compra
-- continuam em linhas separadas. A listagem passa a devolver chave_referenciada e nf_referencia
-- (nº da NF referenciada = posições 26–34 da chave, sem zeros à esquerda).
-- A timeline reconstrói a mesma chave. Guarda de acesso, assinatura e demais ramos inalterados.

CREATE OR REPLACE FUNCTION public.fn_fiscal_documentos(p_company_id uuid, p_tipo text, p_status text DEFAULT NULL::text, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_busca text DEFAULT NULL::text, p_finalidade text DEFAULT NULL::text, p_agrupar boolean DEFAULT true, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_docs jsonb;
  v_total bigint;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_tipo NOT IN ('nfse','nfe') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido');
  END IF;

  WITH norm AS (
    -- normaliza NFS-e e NF-e num formato comum; só o ramo de p_tipo devolve linhas
    SELECT n.id, n.status,
           n.numero,
           COALESCE(n.data_emissao, n.criado_em)                  AS dt,
           n.criado_em,
           n.motivo_rejeicao,
           n.tomador_razao_social                                  AS contraparte_nome,
           COALESCE(n.tomador_cnpj, n.tomador_cpf)                 AS contraparte_doc,
           n.valor_servicos                                        AS valor,
           NULLIF(btrim(COALESCE(n.descricao_servico,'')),'')      AS origem_rotulo,
           NULL::text                                              AS finalidade,
           NULL::text                                              AS chave_referenciada,
           n.erp_receber_id, n.pedido_id, n.os_id, n.origem_tipo, n.origem_id
      FROM erp_nfse_emitidas n
     WHERE p_tipo = 'nfse' AND n.company_id = p_company_id
    UNION ALL
    SELECT e.id, e.status,
           e.numero,
           COALESCE(e.data_emissao, e.criado_em)                  AS dt,
           e.criado_em,
           e.motivo_rejeicao,
           e.destinatario_razao_social                             AS contraparte_nome,
           COALESCE(e.destinatario_cnpj, e.destinatario_cpf)       AS contraparte_doc,
           e.valor_total                                           AS valor,
           NULLIF(btrim(COALESCE(e.natureza_operacao,'')),'')      AS origem_rotulo,
           e.finalidade                                            AS finalidade,
           NULLIF(btrim(COALESCE(e.chave_referenciada,'')),'')     AS chave_referenciada,
           e.erp_receber_id, e.pedido_id, e.os_id, e.origem_tipo, e.origem_id
      FROM erp_nfe_emitidas e
     WHERE p_tipo = 'nfe' AND e.company_id = p_company_id
  ),
  marcada AS (
    -- nota de referência sem vínculo: candidata ao agrupamento por chave referenciada
    SELECT norm.*,
      (erp_receber_id IS NULL AND pedido_id IS NULL AND os_id IS NULL
       AND (origem_tipo IS NULL OR origem_id IS NULL) AND chave_referenciada IS NOT NULL) AS por_ref
      FROM norm
  ),
  chaveada AS (
    SELECT m.*,
      CASE
        WHEN NOT p_agrupar                                          THEN 'doc:'||m.id::text
        WHEN m.erp_receber_id IS NOT NULL                           THEN 'recv:'||m.erp_receber_id::text
        WHEN m.pedido_id IS NOT NULL                                THEN 'ped:'||m.pedido_id::text
        WHEN m.os_id IS NOT NULL                                    THEN 'os:'||m.os_id::text
        WHEN m.origem_tipo IS NOT NULL AND m.origem_id IS NOT NULL  THEN 'org:'||m.origem_tipo||':'||m.origem_id::text
        WHEN m.por_ref THEN 'dev:'||m.chave_referenciada||':'||COALESCE((
          SELECT a.id::text FROM marcada a
           WHERE a.por_ref AND a.chave_referenciada = m.chave_referenciada AND a.status <> 'rejeitada'
             AND (a.criado_em, a.id) >= (m.criado_em, m.id)
           ORDER BY a.criado_em, a.id LIMIT 1), 'pendente')
        ELSE 'doc:'||m.id::text
      END AS grupo_chave,
      -- prioridade do status principal: autorizada > cancelada > denegada > processando > rejeitada > outros
      CASE m.status WHEN 'autorizada' THEN 1 WHEN 'cancelada' THEN 2 WHEN 'denegada' THEN 3 WHEN 'processando' THEN 4 WHEN 'rejeitada' THEN 5 ELSE 6 END AS rnk
      FROM marcada m
  ),
  grp AS (
    SELECT grupo_chave,
           min(rnk)                                              AS min_rnk,
           count(*) FILTER (WHERE status='rejeitada')            AS recusadas,
           max(dt)  FILTER (WHERE status='rejeitada')            AS ultima_recusa,
           count(*)                                              AS qtd_registros,
           array_agg(id ORDER BY dt)                             AS doc_ids
      FROM chaveada GROUP BY grupo_chave
  ),
  principal AS (
    -- registro que define o documento: menor rank; empate → mais recente
    SELECT DISTINCT ON (c.grupo_chave) c.*
      FROM chaveada c JOIN grp g ON g.grupo_chave = c.grupo_chave AND c.rnk = g.min_rnk
     ORDER BY c.grupo_chave, c.dt DESC
  ),
  docs AS (
    SELECT
      p.grupo_chave,
      p.status                                                    AS status_principal,
      (p.status = 'rejeitada')                                    AS nao_emitida,
      (p.status = 'rejeitada')                                    AS pode_reenviar,
      p.numero, p.dt AS data, p.contraparte_nome, p.contraparte_doc, p.valor,
      COALESCE(p.origem_rotulo, p.origem_tipo)                    AS origem_rotulo,
      p.finalidade,
      p.chave_referenciada,
      CASE WHEN p.chave_referenciada ~ '^[0-9]{44}$'
           THEN NULLIF(ltrim(substr(p.chave_referenciada, 26, 9), '0'), '') END AS nf_referencia,
      p.motivo_rejeicao,
      g.recusadas::int                                            AS tentativas_recusadas,
      g.ultima_recusa,
      g.qtd_registros::int                                        AS qtd_registros,
      p.id                                                        AS principal_id,
      g.doc_ids
      FROM principal p JOIN grp g ON g.grupo_chave = p.grupo_chave
     WHERE (p_status IS NULL OR p_status = '' OR p.status = p_status)
       AND (p_finalidade IS NULL OR p_finalidade = '' OR p.finalidade = p_finalidade)
       AND (p_data_inicio IS NULL OR p.dt >= p_data_inicio::timestamptz)
       AND (p_data_fim IS NULL OR p.dt <= (p_data_fim + 1)::timestamptz)
       AND (p_busca IS NULL OR p_busca = '' OR
            p.contraparte_nome ILIKE '%'||p_busca||'%' OR
            p.numero ILIKE '%'||p_busca||'%' OR
            p.contraparte_doc ILIKE '%'||p_busca||'%' OR
            COALESCE(p.origem_rotulo,'') ILIKE '%'||p_busca||'%')
  )
  -- total = todos os documentos do filtro; v_docs = só a página (LIMIT/OFFSET). Contar dentro do subselect
  -- com window daria o tamanho da página, não o total — por isso o count roda sobre a CTE inteira.
  SELECT (SELECT count(*) FROM docs)::bigint,
         (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.data DESC NULLS LAST)
            FROM (SELECT * FROM docs ORDER BY data DESC NULLS LAST LIMIT p_limit OFFSET p_offset) d)
    INTO v_total, v_docs;

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total,0), 'documentos', COALESCE(v_docs, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_fiscal_documento_timeline(p_company_id uuid, p_tipo text, p_grupo_chave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := split_part(p_grupo_chave, ':', 1);
  v_a    text := split_part(p_grupo_chave, ':', 2);
  v_b    text := split_part(p_grupo_chave, ':', 3);
  v_eventos jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_tipo NOT IN ('nfse','nfe') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido');
  END IF;

  WITH dev AS (
    -- 'dev:<chave_referenciada>:<âncora>' — mesma regra de fn_fiscal_documentos
    SELECT e.id, e.status, e.criado_em
      FROM erp_nfe_emitidas e
     WHERE v_kind='dev' AND p_tipo='nfe' AND e.company_id=p_company_id
       AND NULLIF(btrim(COALESCE(e.chave_referenciada,'')),'') = v_a
       AND e.erp_receber_id IS NULL AND e.pedido_id IS NULL AND e.os_id IS NULL
       AND (e.origem_tipo IS NULL OR e.origem_id IS NULL)
  ),
  dev_ids AS (
    SELECT d.id FROM dev d
     WHERE COALESCE((SELECT a.id::text FROM dev a
                      WHERE a.status <> 'rejeitada' AND (a.criado_em, a.id) >= (d.criado_em, d.id)
                      ORDER BY a.criado_em, a.id LIMIT 1), 'pendente') = v_b
  ),
  registros AS (
    -- registros do documento, normalizados; o WHERE reconstrói a mesma chave do agrupamento
    SELECT n.id, n.status, n.numero, n.motivo_rejeicao,
           COALESCE(n.data_emissao, n.criado_em) AS dt, n.criado_em,
           n.codigo_verificacao AS chave, n.xml_url, n.pdf_url,
           n.xml_storage_path, n.pdf_storage_path,
           n.cancelado_em, n.cancelado_por, n.justificativa_cancelamento
      FROM erp_nfse_emitidas n
     WHERE p_tipo='nfse' AND n.company_id=p_company_id AND (
       (v_kind='recv' AND n.erp_receber_id::text = v_a) OR
       (v_kind='ped'  AND n.pedido_id::text = v_a) OR
       (v_kind='os'   AND n.os_id::text = v_a) OR
       (v_kind='org'  AND n.origem_tipo = v_a AND n.origem_id::text = v_b) OR
       (v_kind='doc'  AND n.id::text = v_a))
    UNION ALL
    SELECT e.id, e.status, e.numero, e.motivo_rejeicao,
           COALESCE(e.data_emissao, e.criado_em) AS dt, e.criado_em,
           e.chave, e.xml_url, e.danfe_url AS pdf_url,
           e.xml_storage_path, e.danfe_storage_path AS pdf_storage_path,
           e.cancelado_em, e.cancelado_por, e.justificativa_cancelamento
      FROM erp_nfe_emitidas e
     WHERE p_tipo='nfe' AND e.company_id=p_company_id AND (
       (v_kind='recv' AND e.erp_receber_id::text = v_a) OR
       (v_kind='ped'  AND e.pedido_id::text = v_a) OR
       (v_kind='os'   AND e.os_id::text = v_a) OR
       (v_kind='org'  AND e.origem_tipo = v_a AND e.origem_id::text = v_b) OR
       (v_kind='dev'  AND e.id IN (SELECT id FROM dev_ids)) OR
       (v_kind='doc'  AND e.id::text = v_a))
  ),
  eventos AS (
    -- recusa
    SELECT r.criado_em AS quando, 'recusa'::text AS categoria, 'rejeitada'::text AS status,
           r.numero, NULL::text AS chave, NULL::text AS xml_url, NULL::text AS pdf_url,
           NULL::text AS xml_storage_path, NULL::text AS pdf_storage_path,
           r.motivo_rejeicao AS detalhe, NULL::uuid AS usuario_id, r.id AS nota_id,
           NULL::text AS operacao, NULL::int AS http_status, NULL::text AS provider_codigo
      FROM registros r WHERE r.status='rejeitada'
    UNION ALL
    -- autorização (nota que chegou a ser autorizada, mesmo que depois cancelada)
    SELECT r.dt, 'autorizacao', 'autorizada',
           r.numero, r.chave, r.xml_url, r.pdf_url, r.xml_storage_path, r.pdf_storage_path,
           NULL, NULL, r.id, NULL, NULL, NULL
      FROM registros r WHERE r.status IN ('autorizada','cancelada')
    UNION ALL
    -- cancelamento
    SELECT r.cancelado_em, 'cancelamento', 'cancelada',
           r.numero, NULL, NULL, NULL, NULL, NULL,
           r.justificativa_cancelamento, r.cancelado_por, r.id, NULL, NULL, NULL
      FROM registros r WHERE r.cancelado_em IS NOT NULL
    UNION ALL
    -- processando (aguardando retorno)
    SELECT r.criado_em, 'processando', 'processando',
           r.numero, NULL, NULL, NULL, NULL, NULL, NULL, NULL, r.id, NULL, NULL, NULL
      FROM registros r WHERE r.status='processando'
    UNION ALL
    -- tentativas fiscais registradas (cancelamento/emissão/consulta) ligadas aos registros
    SELECT t.criado_em, 'tentativa', t.resultado,
           NULL, NULL, NULL, NULL, NULL, NULL,
           t.provider_mensagem, t.usuario_id, t.nota_id, t.operacao, t.http_status, t.provider_codigo
      FROM erp_fiscal_tentativa t
     WHERE t.company_id = p_company_id AND t.nota_tipo = p_tipo
       AND t.nota_id IN (SELECT id FROM registros)
  )
  SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.quando ASC NULLS LAST)
    INTO v_eventos
    FROM eventos ev;

  RETURN jsonb_build_object('ok', true, 'eventos', COALESCE(v_eventos, '[]'::jsonb));
END;
$function$;

-- Grants preservados (mesmo estado da produção: só authenticated e service_role executam).
REVOKE ALL ON FUNCTION public.fn_fiscal_documentos(uuid, text, text, date, date, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_documentos(uuid, text, text, date, date, text, text, boolean, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_fiscal_documento_timeline(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_documento_timeline(uuid, text, text) TO authenticated, service_role;
