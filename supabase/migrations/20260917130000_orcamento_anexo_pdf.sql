-- CRM/Orçamentos ② (Wesley/Tryo) — o orçamento hoje é feito FORA do sistema (o de dentro "não se
-- cria", trava única do V8). Enquanto isso não é resolvido, o Wesley precisa ANEXAR o PDF do
-- orçamento que ele fez fora, dentro da tela, e informar o VALOR — senão o funil mostra R$ 0 em
-- cards que já têm proposta, e o orçamento parece "sem itens" (verdade, mas soa como problema).
--
-- Campos do anexo (o arquivo em si vai no bucket crm-anexos, privado, sob {company_id}/...):
--   pdf_anexo_path  — caminho no storage (ver/baixar/substituir)
--   pdf_anexo_em    — quando subiu
--   pdf_anexo_por   — quem subiu
-- (o VALOR reusa erp_orcamentos.total — é o total que o funil/tela somam.)

ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS pdf_anexo_path text,
  ADD COLUMN IF NOT EXISTS pdf_anexo_em   timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_anexo_por  uuid;

-- RPC com GUARDA (o V8 tinha "insert direto do frontend, sem guarda" — não repetir): só altera
-- orçamento de empresa que o usuário enxerga. p_path null limpa o anexo; p_valor null não mexe no total.
CREATE OR REPLACE FUNCTION public.fn_orcamento_anexar_pdf(
  p_orcamento_id uuid, p_path text DEFAULT NULL, p_valor numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT company_id INTO v_company FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'orcamento_nao_encontrado'); END IF;
  IF NOT (v_company = ANY (public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE erp_orcamentos SET
    pdf_anexo_path = p_path,
    pdf_anexo_em   = CASE WHEN p_path IS NULL THEN NULL ELSE now() END,
    pdf_anexo_por  = CASE WHEN p_path IS NULL THEN NULL ELSE v_uid END,
    total          = COALESCE(p_valor, total),
    updated_at     = now()
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id,
    'pdf_anexo_path', p_path, 'total', (SELECT total FROM erp_orcamentos WHERE id = p_orcamento_id));
END $function$;
