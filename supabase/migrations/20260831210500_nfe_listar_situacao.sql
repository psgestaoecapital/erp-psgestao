-- NF-e Recebida Bloco 2 · §3 — filtro por SITUAÇÃO (rollup), não por status.
-- Armadilha (RD-44): a coluna status só tem aguardando_xml/completa/resumo. "Concluída" NÃO está lá —
-- é rollup de concluida_em/estoque_status/lancado_pagar. Filtrar por status mostraria coisa errada.
-- Adiciona p_situacao (novo, opcional, default NULL=tudo) e o campo 'situacao' por nota. p_status FICA
-- (outras telas usam). DROP+CREATE porque a assinatura ganha um parâmetro; chamadas antigas (sem
-- p_situacao) seguem funcionando pelo default.

DROP FUNCTION IF EXISTS public.fn_nfe_recebidas_listar(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.fn_nfe_recebidas_listar(
  p_company_id uuid, p_status text DEFAULT NULL, p_limit integer DEFAULT 100, p_situacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'total', COALESCE(count(*), 0),
    'itens', COALESCE(jsonb_agg(t ORDER BY (t->>'data_emissao') DESC), '[]'::jsonb)
  )
  INTO v FROM (
    SELECT jsonb_build_object(
      'id', n.id,
      'chave_acesso', n.chave_acesso,
      'numero', n.numero,
      'serie', n.serie,
      'fornecedor', n.emitente_razao,
      'cnpj', n.emitente_cnpj,
      'data_emissao', n.data_emissao,
      'valor_total', n.valor_total,
      'status', n.status,
      'manifestacao', n.status_manifestacao,
      'lancado_pagar', n.lancado_pagar,
      -- situacao = rollup honesto (RD-44). Ordem importa: concluída > sem XML > falta estoque > falta financeiro.
      'situacao', CASE
        WHEN n.concluida_em IS NOT NULL          THEN 'concluida'
        WHEN n.status = 'aguardando_xml'         THEN 'sem_xml'
        WHEN n.estoque_status = 'pendente'       THEN 'falta_estoque'
        WHEN n.lancado_pagar = false             THEN 'falta_financeiro'
        ELSE 'outro' END,
      'qtd_itens', (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = n.id),
      'qtd_duplicatas', (SELECT count(*) FROM erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id)
    ) AS t
    FROM erp_nfe_recebidas n
    WHERE n.company_id = p_company_id
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_situacao IS NULL
        OR (p_situacao = 'concluida'        AND n.concluida_em IS NOT NULL)
        OR (p_situacao = 'sem_xml'          AND n.status = 'aguardando_xml')
        OR (p_situacao = 'falta_estoque'    AND n.concluida_em IS NULL AND n.estoque_status = 'pendente')
        OR (p_situacao = 'falta_financeiro' AND n.concluida_em IS NULL AND n.lancado_pagar = false))
    ORDER BY n.data_emissao DESC NULLS LAST
    LIMIT p_limit
  ) s;

  RETURN v;
END;
$function$;
