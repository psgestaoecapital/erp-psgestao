-- #71/#38 (Jordana) · "registros excluídos ainda aparecem na conciliação com info incorreta".
-- BUG PROVADO (15/09, reconfirmado hoje: 3 casos vivos): fn_conciliacao_conciliados filtrava só
-- company_id + status='conciliado' — NÃO checava se o título (erp_pagar/erp_receber) foi soft-deletado
-- (deleted_at). Um título excluído cujo movimento continuava 'conciliado' seguia aparecendo na lista de
-- conciliados, com os dados (agora obsoletos) do título deletado.
--
-- FIX: excluir da lista os movimentos cujo título 1:1 (lancamento_id) está soft-deletado. Só ACRESCENTA o
-- filtro no WHERE; todo o resto (contraparte/valor/data/precisão, 1:1 e agrupado) é idêntico. RD-30/RD-53.
-- (conciliacao_movimento/vinculo não têm deleted_at — só erp_pagar/erp_receber; por isso o filtro é no título.)

CREATE OR REPLACE FUNCTION public.fn_conciliacao_conciliados(p_company_id uuid, p_limite integer DEFAULT 100)
 RETURNS TABLE(movimento_id uuid, lote_id uuid, lote_nome text, data_transacao date, valor numeric, descricao text, natureza text, lancamento_tabela text, lancamento_id uuid, contraparte text, valor_lancamento numeric, data_lancamento date, precisao numeric, match_origem text, conciliado_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.lote_id, cl.nome, m.data_transacao, m.valor, m.descricao, m.natureza,
    m.lancamento_tabela, m.lancamento_id,
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT COALESCE(p.fornecedor_nome,p.descricao) FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT COALESCE(r.cliente_nome,r.descricao)     FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT CASE
                WHEN COUNT(*) = 0 THEN NULL
                WHEN COUNT(*) = 1 THEN MAX(COALESCE(r.cliente_nome, p.fornecedor_nome, r.descricao, p.descricao))
                ELSE 'Fatura agrupada (' || COUNT(*) || ' títulos)'
              END
         FROM conciliacao_vinculo cv
         LEFT JOIN erp_receber r ON r.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_receber'
         LEFT JOIN erp_pagar   p ON p.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_pagar'
        WHERE cv.movimento_id = m.id)
    ) AS contraparte,
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT p.valor FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT r.valor FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT SUM(cv.valor_vinculado) FROM conciliacao_vinculo cv WHERE cv.movimento_id = m.id)
    ) AS valor_lancamento,
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT p.data_vencimento FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT r.data_vencimento FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT MAX(COALESCE(r.data_vencimento, p.data_vencimento))
         FROM conciliacao_vinculo cv
         LEFT JOIN erp_receber r ON r.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_receber'
         LEFT JOIN erp_pagar   p ON p.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_pagar'
        WHERE cv.movimento_id = m.id)
    ) AS data_lancamento,
    COALESCE(
      m.psgc_confianca, m.match_score,
      CASE WHEN m.lancamento_id IS NULL THEN
        (SELECT ROUND(100.0 * ABS(SUM(cv.valor_vinculado)) / NULLIF(ABS(m.valor), 0), 0)
           FROM conciliacao_vinculo cv WHERE cv.movimento_id = m.id)
      END
    ) AS precisao,
    m.match_origem, m.match_aplicado_em
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  WHERE m.company_id = p_company_id AND m.status = 'conciliado'
    -- 🔒 #71/#38: não mostrar movimentos cujo título foi excluído (soft delete). Antes vazavam com dado velho.
    AND NOT (
      m.lancamento_tabela = 'erp_pagar'
      AND EXISTS (SELECT 1 FROM erp_pagar p WHERE p.id = m.lancamento_id AND p.deleted_at IS NOT NULL)
    )
    AND NOT (
      m.lancamento_tabela = 'erp_receber'
      AND EXISTS (SELECT 1 FROM erp_receber r WHERE r.id = m.lancamento_id AND r.deleted_at IS NOT NULL)
    )
  ORDER BY m.match_aplicado_em DESC NULLS LAST
  LIMIT p_limite;
$function$;
