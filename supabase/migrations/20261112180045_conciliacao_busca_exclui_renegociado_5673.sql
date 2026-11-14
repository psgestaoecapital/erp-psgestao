-- Chamado #5673 — título renegociado NÃO pode ser candidato na busca da Conciliação
-- (tela "Vincular vários · fatura agrupada"). Hoje fn_conciliacao_buscar_lancamentos
-- devolve QUALQUER erp_receber não deletado, inclusive os com status 'renegociado'
-- (já substituídos pelos novos títulos da renegociação), 'orcamento' e 'cancelado' —
-- que podiam ser vinculados por engano a um crédito do extrato.
--
-- A sugestão automática (buscar_matches_extrato) e a listagem de Receitas a Receber
-- (fn_ge_listagem_v2) JÁ excluem esses status; esta era a única porta que ainda os
-- mostrava. Correção aditiva: no ramo de crédito (erp_receber) a busca passa a ignorar
-- 'renegociado', 'orcamento' e 'cancelado'. O ramo de débito (erp_pagar) fica inalterado.
--
-- Prova (RD-38) na Gean (a462e13f-0f51-4c54-abe8-4474b591633b), 10/11/2026:
--   SELECT status, count(*), sum(valor) FROM erp_receber
--     WHERE company_id='a462e13f-...' AND deleted_at IS NULL GROUP BY status;
--     -> renegociado: 4 títulos, R$ 5.520,00 (inclui TRANSPORTES TOMAZI R$ 2.990,00,
--        id 3cbb1626-5a83-44a4-a6c3-de6bb292d534).
--   Antes: fn_conciliacao_buscar_lancamentos(...,'tomazi',...) devolvia o renegociado
--     de R$ 2.990,00 junto com os novos de R$ 1.495,00.
--   Depois: devolve só os novos (R$ 1.495,00 em 'parcial'/'pago'); o renegociado some.
--
-- Mantém assinatura, tipo de retorno, ordenação e demais filtros idênticos.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_buscar_lancamentos(p_company_id uuid, p_natureza text, p_valor_min numeric DEFAULT NULL::numeric, p_valor_max numeric DEFAULT NULL::numeric, p_termo text DEFAULT NULL::text, p_valor_ref numeric DEFAULT NULL::numeric, p_limite integer DEFAULT 50, p_data_ini date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, contraparte text, descricao_lancamento text, status text, ja_conciliado boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH base AS (
    SELECT 'erp_pagar'::text tab, p.id, p.data_vencimento::date dt, p.valor::numeric val,
           p.fornecedor_nome::text contrap,
           COALESCE(p.descricao,p.fornecedor_nome,'')::text descr, p.status::text st
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) p
    WHERE p.company_id = p_company_id AND p_natureza = 'debito'
    UNION ALL
    SELECT 'erp_receber', r.id, r.data_vencimento::date, r.valor,
           r.cliente_nome, COALESCE(r.descricao,r.cliente_nome,''), r.status
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) r
    WHERE r.company_id = p_company_id AND p_natureza = 'credito'
      -- #5673: título já renegociado (substituído), orçamento ou cancelado não é
      -- candidato de conciliação. Só os novos títulos da renegociação aparecem.
      AND COALESCE(r.status,'') NOT IN ('renegociado','orcamento','cancelado')
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
