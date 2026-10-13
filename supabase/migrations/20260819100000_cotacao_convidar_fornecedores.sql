-- Oficina · Item 2 — Convidar fornecedores para uma cotação (ponte operacional → GE Compras).
--
-- O diagnóstico da Oficina já gera a cotação (fn_os_diagnostico_gerar_cotacao, status 'rascunho').
-- Esta função registra o CONVITE dos fornecedores nessa cotação — o dispatch [→GE]. Comparar propostas
-- e decidir o vencedor continua sendo do GE/Compras (fronteira preservada; não recriamos a janela).
--
-- Premissas auditadas no banco (premissa-primeiro, RD-38):
--   • erp_cotacoes(id, company_id) e erp_cotacoes_fornecedores existem com todas as colunas usadas aqui.
--   • UNIQUE (cotacao_id, fornecedor_id) → o ON CONFLICT casa (idempotente: reconvidar não duplica).
--   • CHECK chk_cotacoes_fornec_status permite 'convidado' — é o status inicial correto (confirmado).
--   • erp_fornecedores tem cnpj_cpf (text) e cpf_cnpj (varchar); coalesce cobre ambos.
--   • DML validada em transação BEGIN/ROLLBACK com dados reais (2 fornecedores → 2 linhas 'convidado').

CREATE OR REPLACE FUNCTION public.fn_cotacao_convidar_fornecedores(
  p_cotacao_id uuid,
  p_fornecedor_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_n int := 0;
BEGIN
  SELECT company_id INTO v_company FROM erp_cotacoes WHERE id = p_cotacao_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cotacao inexistente');
  END IF;

  -- Multi-tenant: só quem enxerga a company da cotação (ou admin) pode convidar.
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  INSERT INTO erp_cotacoes_fornecedores
    (cotacao_id, company_id, fornecedor_id, fornecedor_nome, fornecedor_cnpj, status, data_convite)
  SELECT p_cotacao_id, v_company, f.id,
         coalesce(f.nome_fantasia, f.razao_social),
         coalesce(f.cnpj_cpf, f.cpf_cnpj),
         'convidado', now()
    FROM erp_fornecedores f
   WHERE f.id = ANY(p_fornecedor_ids)
     AND f.company_id = v_company
  ON CONFLICT (cotacao_id, fornecedor_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'convidados', v_n);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_cotacao_convidar_fornecedores(uuid, uuid[]) FROM anon;
