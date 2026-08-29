-- SPEC NFE-F3 · o volume. A Jordana processar 208 notas sem enlouquecer. Depende de F0/F1/F2.
-- 🛑 Manifestação NÃO é enviada à SEFAZ nesta fase (o OMIE faz; o PS só lê).
--
-- Auditoria (RD-38/44/45):
--  · resumo_raw só traz manifestacao_destinatario em 2 de 210 notas; as 208 vêm ∅ → o evento do OMIE
--    NÃO está no banco. Decisão CEO: status desconhecido = "gerida no OMIE" (não bloqueia, não mente).
--    Só marca status real quando o evento existe (hoje as 2). Sem inventar parse (RD-51).
--  · casamento exato cobre ~82 de 356 (EAN 44 · código 38 · de-para 0). O resto exige olho humano.
--  · fn_movimentar_estoque recalcula custo médio por ORDEM DE INSERÇÃO (média corrente); data_movimento
--    é NOW() e não entra no cálculo → backdatar é risco BAIXO. (E4/lote fica para depois da decisão da data.)

-- ── §1 · sincronizar manifestação do resumo_raw (SÓ LEITURA — nada à SEFAZ) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dfe_sincronizar_manifestacao(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_real int; v_omie int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  -- 1) notas com evento real no resumo → status verdadeiro + manifestado_por = sincronizado_dfe
  WITH upd AS (
    UPDATE erp_nfe_recebidas n SET
      status_manifestacao = CASE lower(n.resumo_raw->>'manifestacao_destinatario')
        WHEN 'confirmacao' THEN 'confirmada' WHEN 'ciencia' THEN 'ciencia'
        WHEN 'desconhecimento' THEN 'desconhecida' WHEN 'operacao_nao_realizada' THEN 'nao_realizada'
        ELSE lower(n.resumo_raw->>'manifestacao_destinatario') END,
      manifestado_por = 'sincronizado_dfe', updated_at = now()
    WHERE n.company_id=p_company_id AND NULLIF(n.resumo_raw->>'manifestacao_destinatario','') IS NOT NULL
    RETURNING 1) SELECT count(*) INTO v_real FROM upd;

  -- 2) notas SEM evento no resumo → "gerida no OMIE" (desconhecido, não bloqueia — não é "manifestada")
  WITH upd2 AS (
    UPDATE erp_nfe_recebidas n SET status_manifestacao='gerida_omie', updated_at=now()
     WHERE n.company_id=p_company_id AND resumo_raw IS NOT NULL
       AND NULLIF(n.resumo_raw->>'manifestacao_destinatario','') IS NULL
       AND COALESCE(n.status_manifestacao,'') IN ('pendente','')   -- não sobrescreve um evento real já gravado
    RETURNING 1) SELECT count(*) INTO v_omie FROM upd2;

  RETURN jsonb_build_object('ok',true,'com_evento',v_real,'gerida_omie',v_omie,
    'aviso','Só leitura do resumo DF-e. Nenhum evento enviado à SEFAZ. Os 208 sem evento ficam "gerida no OMIE".');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dfe_sincronizar_manifestacao(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dfe_sincronizar_manifestacao(uuid) TO authenticated, service_role;

-- ── E2 · matcher do casamento EXATO (de-para → EAN → código; NUNCA descrição/NCM; só se inequívoco) ──
CREATE OR REPLACE FUNCTION public.fn_nfe_lote_exato_matches(p_company_id uuid, p_nfe_ids uuid[])
RETURNS TABLE(item_id uuid, nfe_id uuid, produto_id uuid, produto_nome text, criterio text, codigo_produto text, descricao text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT DISTINCT ON (i.id) i.id, i.nfe_recebida_id, m.produto_id, m.produto_nome, m.criterio, i.codigo_produto, i.descricao
  FROM erp_nfe_recebidas_itens i JOIN erp_nfe_recebidas n ON n.id=i.nfe_recebida_id
  JOIN LATERAL (
    SELECT d.produto_id, p0.nome AS produto_nome, 'depara'::text AS criterio, 1 AS pri
      FROM erp_produto_depara_fornecedor d JOIN erp_produtos p0 ON p0.id=d.produto_id
     WHERE d.company_id=i.company_id AND d.produto_id IS NOT NULL AND btrim(coalesce(i.codigo_produto,''))<>''
       AND regexp_replace(coalesce(d.fornecedor_cnpj,''),'\D','','g')=regexp_replace(coalesce(n.emitente_cnpj,''),'\D','','g')
       AND upper(btrim(d.codigo_fornecedor))=upper(btrim(i.codigo_produto))
    UNION ALL
    SELECT p.id, p.nome, 'ean', 2 FROM erp_produtos p
     WHERE p.company_id=i.company_id AND COALESCE(p.ativo,true) AND regexp_replace(coalesce(i.codigo_barras,''),'\D','','g')<>''
       AND regexp_replace(coalesce(p.codigo_barras,''),'\D','','g')=regexp_replace(coalesce(i.codigo_barras,''),'\D','','g')
       AND (SELECT count(*) FROM erp_produtos p2 WHERE p2.company_id=i.company_id AND COALESCE(p2.ativo,true)
             AND regexp_replace(coalesce(p2.codigo_barras,''),'\D','','g')=regexp_replace(coalesce(i.codigo_barras,''),'\D','','g'))=1
    UNION ALL
    SELECT p.id, p.nome, 'codigo', 3 FROM erp_produtos p
     WHERE p.company_id=i.company_id AND COALESCE(p.ativo,true) AND btrim(coalesce(i.codigo_produto,''))<>''
       AND upper(btrim(p.codigo))=upper(btrim(i.codigo_produto))
       AND (SELECT count(*) FROM erp_produtos p2 WHERE p2.company_id=i.company_id AND COALESCE(p2.ativo,true)
             AND upper(btrim(p2.codigo))=upper(btrim(i.codigo_produto)))=1
  ) m ON true
  WHERE i.company_id=p_company_id AND i.produto_id IS NULL AND i.nfe_recebida_id = ANY(p_nfe_ids)
  ORDER BY i.id, m.pri
$fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_lote_exato_matches(uuid,uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_lote_exato_matches(uuid,uuid[]) TO authenticated, service_role;

-- prévia (não grava): item → produto → critério + contagens
CREATE OR REPLACE FUNCTION public.fn_nfe_vincular_lote_exato_previa(p_company_id uuid, p_nfe_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',item_id,'nfe_id',nfe_id,'produto_id',produto_id,
    'produto_nome',produto_nome,'criterio',criterio,'codigo',codigo_produto,'descricao',descricao) ORDER BY criterio), '[]'::jsonb)
    INTO v_rows FROM fn_nfe_lote_exato_matches(p_company_id, p_nfe_ids);
  RETURN jsonb_build_object('ok',true,'total', jsonb_array_length(v_rows),
    'por_criterio', (SELECT jsonb_object_agg(criterio, n) FROM (SELECT criterio, count(*) n FROM fn_nfe_lote_exato_matches(p_company_id,p_nfe_ids) GROUP BY criterio) t),
    'vinculos', v_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_vincular_lote_exato_previa(uuid,uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_vincular_lote_exato_previa(uuid,uuid[]) TO authenticated, service_role;

-- aplicar: vincula (produto_id + de-para nasce). NÃO movimenta estoque (isso é o dar_entrada).
CREATE OR REPLACE FUNCTION public.fn_nfe_vincular_lote_exato(p_company_id uuid, p_nfe_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r record; v_n int := 0; v_crit jsonb := '{}'::jsonb; v_ok boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  FOR r IN SELECT * FROM fn_nfe_lote_exato_matches(p_company_id, p_nfe_ids) LOOP
    v_ok := COALESCE((fn_nfe_item_vincular(r.item_id, r.produto_id, true)->>'ok')::boolean, false);  -- de-para nasce (p_fixar_depara=true)
    IF v_ok THEN
      v_n := v_n + 1;
      v_crit := jsonb_set(v_crit, ARRAY[r.criterio], to_jsonb(COALESCE((v_crit->>r.criterio)::int,0)+1));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'vinculados',v_n,'por_criterio',v_crit,
    'itens_restantes', (SELECT count(*) FROM erp_nfe_recebidas_itens WHERE company_id=p_company_id AND nfe_recebida_id=ANY(p_nfe_ids) AND produto_id IS NULL),
    'notas_100_resolvidas', (SELECT count(*) FROM erp_nfe_recebidas n WHERE n.id=ANY(p_nfe_ids)
       AND NOT EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id AND COALESCE(i.entra_estoque,false)=true AND i.produto_id IS NULL)
       AND EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id)));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_vincular_lote_exato(uuid,uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_vincular_lote_exato(uuid,uuid[]) TO authenticated, service_role;

-- ── E1 · fila de conferência ordenada por QUANTO FALTA (as que faltam pouco primeiro) ────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_fila_conferencia(p_company_id uuid, p_filtro jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_rows jsonb; v_tipo text := COALESCE(p_filtro->>'tipo','todas'); v_forn text := NULLIF(regexp_replace(COALESCE(p_filtro->>'fornecedor_cnpj',''),'\D','','g'),''); v_mes text := NULLIF(p_filtro->>'mes','');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  WITH base AS (
    SELECT n.id, n.numero, n.emitente_razao, n.emitente_cnpj, n.valor_total, n.data_emissao,
      (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id) AS total,
      (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id AND (i.produto_id IS NOT NULL OR COALESCE(i.entra_estoque,false)=false)) AS resolvidos,
      (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id AND i.produto_id IS NULL AND COALESCE(i.entra_estoque,true)<>false
         AND ( EXISTS(SELECT 1 FROM erp_produtos p WHERE p.company_id=n.company_id AND COALESCE(p.ativo,true) AND regexp_replace(coalesce(i.codigo_barras,''),'\D','','g')<>'' AND regexp_replace(coalesce(p.codigo_barras,''),'\D','','g')=regexp_replace(coalesce(i.codigo_barras,''),'\D','','g'))
            OR EXISTS(SELECT 1 FROM erp_produtos p WHERE p.company_id=n.company_id AND COALESCE(p.ativo,true) AND btrim(coalesce(i.codigo_produto,''))<>'' AND upper(btrim(p.codigo))=upper(btrim(i.codigo_produto)))
            OR EXISTS(SELECT 1 FROM erp_produto_depara_fornecedor d WHERE d.company_id=n.company_id AND d.produto_id IS NOT NULL AND upper(btrim(d.codigo_fornecedor))=upper(btrim(i.codigo_produto)) AND regexp_replace(coalesce(d.fornecedor_cnpj,''),'\D','','g')=regexp_replace(coalesce(n.emitente_cnpj,''),'\D','','g')) )) AS exato_disp,
      (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id=n.id AND i.quantidade_recebida IS NOT NULL AND i.quantidade_recebida<>i.quantidade) AS divergencias,
      (CURRENT_DATE - n.data_emissao::date) AS idade
    FROM erp_nfe_recebidas n
    WHERE n.company_id=p_company_id AND n.concluida_em IS NULL AND COALESCE(n.status,'') NOT IN ('ignorada')
      AND (v_forn IS NULL OR regexp_replace(coalesce(n.emitente_cnpj,''),'\D','','g')=v_forn)
      AND (v_mes IS NULL OR to_char(n.data_emissao,'YYYY-MM')=v_mes)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'numero',numero,'fornecedor',emitente_razao,'cnpj',emitente_cnpj,
    'valor',valor_total,'emissao',data_emissao,'total',total,'resolvidos',resolvidos,
    'pronta',(total>0 AND resolvidos=total),'exato_disponivel',exato_disp,'divergencia',(divergencias>0),'idade',idade)
    ORDER BY (total-resolvidos) ASC, idade DESC), '[]'::jsonb) INTO v_rows
  FROM base
  WHERE total>0
    AND (v_tipo<>'prontas'    OR resolvidos=total)
    AND (v_tipo<>'com_exato'  OR exato_disp>0)
    AND (v_tipo<>'sem_vinculo' OR resolvidos=0);
  RETURN jsonb_build_object('ok',true,'total',jsonb_array_length(v_rows),'notas',v_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_fila_conferencia(uuid,jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_fila_conferencia(uuid,jsonb) TO authenticated, service_role;
