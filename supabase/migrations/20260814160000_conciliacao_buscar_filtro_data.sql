-- RD-41 · Fase 1 (Saneamento) — Conciliação: filtro de data no "Vincular vários" (fatura agrupada).
-- Origem: Jordana KGF — a busca de contas a pagar/receber volta sem recorte temporal (vencimentos de 2028
-- dominam), inviável de operar. Adiciona p_data_ini/p_data_fim (date, opcionais) filtrando data_vencimento.
-- Assinatura muda (2 params novos ao FINAL) → DROP + CREATE (a versão de 7 args seria ambígua com a de 9).
-- Chamadas atuais (named ou 7 posicionais) seguem válidas: os novos params default NULL = sem recorte.

DROP FUNCTION IF EXISTS public.fn_conciliacao_buscar_lancamentos(uuid, text, numeric, numeric, text, numeric, integer);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_buscar_lancamentos(
  p_company_id uuid,
  p_natureza text,
  p_valor_min numeric DEFAULT NULL,
  p_valor_max numeric DEFAULT NULL,
  p_termo text DEFAULT NULL,
  p_valor_ref numeric DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_data_ini date DEFAULT NULL,
  p_data_fim date DEFAULT NULL)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, contraparte text, descricao_lancamento text, status text, ja_conciliado boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH base AS (
    SELECT 'erp_pagar'::text tab, p.id, p.data_vencimento::date dt, p.valor::numeric val,
           p.fornecedor_nome::text contrap,
           COALESCE(p.descricao,p.fornecedor_nome,'')::text descr, p.status::text st
    FROM erp_pagar p
    WHERE p.company_id = p_company_id AND p_natureza = 'debito'
    UNION ALL
    SELECT 'erp_receber', r.id, r.data_vencimento::date, r.valor,
           r.cliente_nome, COALESCE(r.descricao,r.cliente_nome,''), r.status
    FROM erp_receber r
    WHERE r.company_id = p_company_id AND p_natureza = 'credito'
  )
  SELECT b.tab, b.id, b.dt, b.val, b.contrap, b.descr, b.st,
    EXISTS(SELECT 1 FROM conciliacao_movimento cm
      WHERE cm.lancamento_id=b.id AND cm.lancamento_tabela=b.tab AND cm.status='conciliado')
  FROM base b
  WHERE (p_valor_min IS NULL OR b.val >= p_valor_min)
    AND (p_valor_max IS NULL OR b.val <= p_valor_max)
    AND (p_termo IS NULL OR b.contrap ILIKE '%'||p_termo||'%' OR b.descr ILIKE '%'||p_termo||'%')
    AND (p_data_ini IS NULL OR b.dt >= p_data_ini)
    AND (p_data_fim IS NULL OR b.dt <= p_data_fim)
  ORDER BY CASE WHEN p_valor_ref IS NOT NULL THEN abs(b.val - p_valor_ref) ELSE 0 END, b.dt DESC
  LIMIT p_limite;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_buscar_lancamentos(uuid, text, numeric, numeric, text, numeric, integer, date, date) TO authenticated;
