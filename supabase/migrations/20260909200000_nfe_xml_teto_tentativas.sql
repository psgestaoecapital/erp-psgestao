-- ============================================================
-- Teto de tentativas de baixar o XML: a nota para de tentar sozinha e vira "precisa de ação".
--
-- Dor: 2 notas do KGF com 675 tentativas cada desde julho. O worker nfe-baixar-xml-pendentes
-- reeenfileira eternamente notas cujo XML a SEFAZ nunca libera (fornecedor precisa mandar o
-- arquivo). 675 tentativas por nota e desperdicio, e o problema so aparece quando alguem olha.
--
-- Solucao (sem status novo, sem constraint nova, sem backfill): o teto e derivado do proprio
-- xml_tentativas.
--   - o worker passa a selecionar so xml_tentativas < TETO (para de tentar sozinho) — no edge;
--   - a nota estourada vira situacao='precisa_xml' na listagem, com o botao Subir XML ao lado (#1314).
-- As 2 notas de 675 ja passam do teto -> aparecem como precisa_xml na hora, sem backfill.
--
-- TETO = 20 (≈10h no cron de 30min; a SEFAZ costuma liberar em ate ~2h). Precisa bater com o
-- TETO_TENTATIVAS do worker supabase/functions/nfe-baixar-xml-pendentes/index.ts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_nfe_recebidas_listar(
  p_company_id uuid, p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 100, p_situacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
  c_teto constant int := 20;   -- teto de tentativas · vide comentario do arquivo
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
      'xml_tentativas', n.xml_tentativas,
      'situacao', CASE
        WHEN n.concluida_em IS NOT NULL                                     THEN 'concluida'
        WHEN n.status = 'aguardando_xml' AND n.xml_tentativas >= c_teto     THEN 'precisa_xml'
        WHEN n.status = 'aguardando_xml'                                    THEN 'sem_xml'
        WHEN n.estoque_status = 'pendente'                                  THEN 'falta_estoque'
        WHEN n.lancado_pagar = false                                       THEN 'falta_financeiro'
        ELSE 'outro' END,
      'qtd_itens', (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = n.id),
      'qtd_duplicatas', (SELECT count(*) FROM erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id)
    ) AS t
    FROM erp_nfe_recebidas n
    WHERE n.company_id = p_company_id
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_situacao IS NULL
        OR (p_situacao = 'concluida'        AND n.concluida_em IS NOT NULL)
        OR (p_situacao = 'precisa_xml'      AND n.status = 'aguardando_xml' AND n.xml_tentativas >= c_teto)
        OR (p_situacao = 'sem_xml'          AND n.status = 'aguardando_xml' AND n.xml_tentativas <  c_teto)
        OR (p_situacao = 'falta_estoque'    AND n.concluida_em IS NULL AND n.estoque_status = 'pendente')
        OR (p_situacao = 'falta_financeiro' AND n.concluida_em IS NULL AND n.lancado_pagar = false))
    ORDER BY n.data_emissao DESC NULLS LAST
    LIMIT p_limit
  ) s;

  RETURN v;
END;
$function$;
