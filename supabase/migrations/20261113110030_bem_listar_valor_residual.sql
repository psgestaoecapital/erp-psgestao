-- PDCA GE (auditor_pdca_2, 11/11) — /dashboard/gestao-empresarial/bens, RD-98 #2 (perda de dado na edição).
-- Prova RD-38 (produção, read-only): 1 de 36 bens ativos tem valor_residual > 0. A tela edita o bem com
-- valor_residual fixo em '' (page.tsx editar() L127, porque fn_bem_listar NÃO devolvia o campo) e salva 0
-- (salvar() L111) -> QUALQUER edição zera o valor residual silenciosamente.
--
-- Correção (CREATE OR REPLACE, aditiva): fn_bem_listar passa a devolver valor_residual (coluna numeric já
-- existente em erp_bem). Mesma guarda de empresa (fail-closed) e mesmo corpo — só acrescenta a coluna ao
-- RETURNS TABLE e ao SELECT. A tela (nesta mesma PR) carrega o valor no editar() e preserva ao salvar.
-- Nada destrutivo; não altera dado de cliente.

-- CONSERTO (11/11): esta migration FALHOU no deploy com 42P13 "cannot change return type of existing function"
-- porque acrescenta a coluna de saída valor_residual e CREATE OR REPLACE não altera as OUT params de uma função
-- que já existe. Como ela NUNCA chegou a aplicar (não está no ledger), corrige-se o próprio arquivo: DROP + CREATE
-- (nenhuma view depende de fn_bem_listar; o corpo é idêntico ao provado na #4549).
DROP FUNCTION IF EXISTS public.fn_bem_listar(uuid);
CREATE FUNCTION public.fn_bem_listar(p_company_id uuid)
 RETURNS TABLE(id uuid, codigo text, descricao text, natureza text, data_aquisicao date, valor_aquisicao numeric, deprecia boolean, vida_util_meses integer, metodo_depreciacao text, business_line_id uuid, business_line_nome text, centro_custo text, status text, dep_acumulada numeric, valor_contabil numeric, valor_residual numeric, falta_parametro boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- guarda de empresa (fail-closed): sem vínculo com a empresa, lista vazia
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT b.id, b.codigo, b.descricao, b.natureza, b.data_aquisicao, b.valor_aquisicao,
    b.deprecia, b.vida_util_meses, b.metodo_depreciacao, b.business_line_id, bl.name,
    b.centro_custo, b.status,
    COALESCE(d.acumulado, 0) AS dep_acumulada,
    ROUND(b.valor_aquisicao - COALESCE(d.acumulado,0), 2) AS valor_contabil,
    COALESCE(b.valor_residual, 0) AS valor_residual,
    (b.deprecia AND b.vida_util_meses IS NULL) AS falta_parametro
  FROM erp_bem b
  LEFT JOIN business_lines bl ON bl.id = b.business_line_id
  LEFT JOIN LATERAL (
    SELECT acumulado FROM erp_bem_depreciacao dd
    WHERE dd.bem_id = b.id ORDER BY dd.competencia DESC LIMIT 1
  ) d ON TRUE
  WHERE b.company_id = p_company_id AND b.status <> 'excluido'
  ORDER BY b.status, b.natureza, b.descricao;
END $function$;

REVOKE ALL ON FUNCTION public.fn_bem_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bem_listar(uuid) TO authenticated, service_role;
