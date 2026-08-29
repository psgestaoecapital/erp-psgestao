-- NFE-F5 · ENTREGA 1 — Livro de Entradas. Os dados já estão no banco (Fase 0 CFOP, Fase 1 tributos);
-- esta função só APRESENTA no formato que a contabilidade lê. Nada é calculado de novo — valores vêm do XML.
--
-- Filtro (decisão do CEO): entram as notas com status='completa' (dados completos) cuja manifestação NÃO é
-- recusada/não_realizada. Manifestação 'pendente' ENTRA (são as "geridas no OMIE" da Fase 3 — a nota existe,
-- foi emitida contra o CNPJ e a mercadoria entrou; conferir item a item é controle nosso, o livro é obrigação
-- legal). O selo 'conferida' por linha diz a verdade (hoje 0 de 208). Quando o mutirão rodar, o selo muda e o
-- valor NÃO muda — porque sempre veio do XML.
--
-- Competência: por data_emissao. ⚠️ recebida_em está NULL em 210/210 (a Fase 2 criou a coluna e nada preenche).
-- Quando o mutirão passar a preencher recebida_em, o livro DEVE usar recebida_em (data de ENTRADA, não de
-- emissão) — trocar as referências a data_emissao abaixo. NÃO implementado agora de propósito.
--
-- Reconciliação (RD-38): ICMS KGF ago/2026 = R$1.761,77 · trimestre jun+jul+ago = R$5.669,34.

CREATE OR REPLACE FUNCTION public.fn_fiscal_livro_entradas(p_company_id uuid, p_competencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  WITH notas AS (
    SELECT n.id, n.data_emissao, n.recebida_em, n.numero, n.serie, n.chave_acesso,
           n.emitente_razao, n.emitente_cnpj, n.emitente_uf, (n.concluida_em IS NOT NULL) AS conferida
    FROM erp_nfe_recebidas n
    WHERE n.company_id = p_company_id
      AND n.status = 'completa'
      AND COALESCE(n.status_manifestacao,'') NOT IN ('recusada','nao_realizada','não_realizada','nao realizada')
      AND (p_competencia IS NULL OR to_char(n.data_emissao,'YYYY-MM') = p_competencia)  -- trocar p/ recebida_em quando preenchido
  ),
  -- por item: CFOP de entrada (Fase 0) + tributos agregados (Fase 1); valor_total só do item (não multiplicar pelo join)
  item AS (
    SELECT i.id AS item_id, i.nfe_recebida_id AS nfe_id, COALESCE(i.cfop_entrada, i.cfop) AS cfop, i.valor_total,
           max(CASE WHEN t.tributo='icms' THEN t.cst END) AS icms_cst,
           sum(CASE WHEN t.tributo='icms' THEN t.base_calculo ELSE 0 END) AS icms_base,
           sum(CASE WHEN t.tributo='icms' THEN t.valor ELSE 0 END) AS icms_valor,
           max(CASE WHEN t.tributo='icms' THEN t.aliquota_pct END) AS icms_aliq,
           sum(CASE WHEN t.tributo='ipi' THEN t.valor ELSE 0 END) AS ipi_valor,
           sum(CASE WHEN t.tributo='icmsst' THEN t.valor ELSE 0 END) AS st_valor
    FROM erp_nfe_recebidas_itens i
    JOIN notas ln ON ln.id = i.nfe_recebida_id
    LEFT JOIN erp_nfe_recebidas_itens_tributo t ON t.item_id = i.id
    GROUP BY i.id, i.nfe_recebida_id, COALESCE(i.cfop_entrada, i.cfop), i.valor_total
  ),
  -- uma linha por (nota, CFOP): contábil = base_icms + isentas + outras
  linha AS (
    SELECT it.nfe_id, it.cfop,
      round(sum(it.valor_total),2) AS valor_contabil,
      round(sum(CASE WHEN COALESCE(it.icms_cst,'') NOT IN ('40','41','50','51','60') THEN it.icms_base ELSE 0 END),2) AS base_icms,
      round(sum(it.icms_valor),2) AS valor_icms,
      round(sum(CASE WHEN it.icms_cst IN ('40','41','50') THEN it.valor_total ELSE 0 END),2) AS isentas,
      round(sum(it.ipi_valor),2) AS ipi, round(sum(it.st_valor),2) AS st, max(it.icms_aliq) AS aliquota_icms
    FROM item it GROUP BY it.nfe_id, it.cfop
  )
  SELECT jsonb_build_object(
    'ok', true, 'competencia', COALESCE(p_competencia,'todas'),
    'cabecalho', jsonb_build_object(
      'total_notas', (SELECT count(*) FROM notas),
      'conferidas', (SELECT count(*) FILTER (WHERE conferida) FROM notas),
      'nao_conferidas', (SELECT count(*) FILTER (WHERE NOT conferida) FROM notas),
      'valores_do_xml', true,
      'aviso', format('%s nota(s) · %s conferida(s) item a item. Valores extraídos do XML.',
                      (SELECT count(*) FROM notas), (SELECT count(*) FILTER (WHERE conferida) FROM notas)),
      'excluidas', jsonb_build_object(
        'sem_xml', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=p_company_id AND status='aguardando_xml' AND (p_competencia IS NULL OR to_char(data_emissao,'YYYY-MM')=p_competencia)),
        'recusada_ou_nao_realizada', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=p_company_id AND COALESCE(status_manifestacao,'') IN ('recusada','nao_realizada','não_realizada','nao realizada') AND (p_competencia IS NULL OR to_char(data_emissao,'YYYY-MM')=p_competencia)))),
    'por_cfop', (SELECT COALESCE(jsonb_agg(z ORDER BY z->>'cfop'),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('cfop', cfop, 'notas', count(DISTINCT nfe_id),
          'valor_contabil', round(sum(valor_contabil),2), 'base_icms', round(sum(base_icms),2),
          'valor_icms', round(sum(valor_icms),2), 'isentas', round(sum(isentas),2),
          'outras', round(sum(valor_contabil - base_icms - isentas),2), 'ipi', round(sum(ipi),2), 'st', round(sum(st),2)) AS z
        FROM linha GROUP BY cfop) q),
    'totais', (SELECT jsonb_build_object('valor_contabil', round(sum(valor_contabil),2), 'base_icms', round(sum(base_icms),2),
        'valor_icms', round(sum(valor_icms),2), 'isentas', round(sum(isentas),2),
        'outras', round(sum(valor_contabil - base_icms - isentas),2), 'ipi', round(sum(ipi),2), 'st', round(sum(st),2)) FROM linha),
    'linhas', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'cfop', x->>'numero'),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('cfop', l.cfop, 'data_emissao', ln.data_emissao, 'entrada', ln.recebida_em,
          'numero', ln.numero, 'serie', ln.serie, 'chave', ln.chave_acesso,
          'emitente', ln.emitente_razao, 'cnpj', ln.emitente_cnpj, 'uf', ln.emitente_uf,
          'valor_contabil', l.valor_contabil, 'base_icms', l.base_icms, 'aliquota_icms', l.aliquota_icms,
          'valor_icms', l.valor_icms, 'isentas', l.isentas, 'outras', round(l.valor_contabil - l.base_icms - l.isentas,2),
          'ipi', l.ipi, 'st', l.st, 'conferida', ln.conferida) AS x
        FROM linha l JOIN notas ln ON ln.id = l.nfe_id) q)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fiscal_livro_entradas(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_livro_entradas(uuid,text) TO authenticated, service_role;

-- registrar uma exportação (rastreabilidade RD-58): qual arquivo, quando, com que conteúdo (hash)
CREATE OR REPLACE FUNCTION public.fn_fiscal_exportacao_registrar(
  p_company_id uuid, p_tipo text, p_periodo text, p_hash_md5 text,
  p_linhas int DEFAULT NULL, p_tamanho_bytes int DEFAULT NULL, p_sistema_destino text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  INSERT INTO public.exportacoes_sped (company_id, tipo, periodo, hash_md5, linhas, tamanho_bytes, sistema_destino, status, gerado_em)
  VALUES (p_company_id, p_tipo, p_periodo, p_hash_md5, p_linhas, p_tamanho_bytes, p_sistema_destino, 'gerado', now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fiscal_exportacao_registrar(uuid,text,text,text,int,int,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_exportacao_registrar(uuid,text,text,text,int,int,text) TO authenticated, service_role;
