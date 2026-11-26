-- Chamado #11084 (complemento do #5848) — Emitir NF-e avulsa (/dashboard/fiscal/nfe/remessa): a busca do destinatário
-- carregava só 500 cadastros ordenados por razao_social (NULL por último) e filtrava no navegador. Na 163 há 737 clientes
-- ativos (458 PJ com razão social + 279 PF só com nome_fantasia): os 237 últimos nunca chegavam à tela → "nenhum cadastro".
-- A tela passa a buscar NO SERVIDOR pela função canônica fn_cliente_buscar (nome_fantasia OR razao_social OR documento).
-- O destinatário também pode ser FORNECEDOR (devolução/remessa a fornecedor) e não existia função equivalente: esta
-- migration cria fn_fornecedor_buscar, com a MESMA regra e a mesma forma de resposta da fn_cliente_buscar.
-- Só cria função nova (aditiva): nenhum dado é lido por ela além do que o usuário já enxerga na empresa; não altera
-- fn_cliente_buscar nem tabela. Documento: olha as DUAS colunas (cnpj_cpf e cpf_cnpj) — na base há 4.396 clientes com o
-- documento só em cnpj_cpf e 7.283 só em cpf_cnpj, conforme a origem do cadastro.
CREATE OR REPLACE FUNCTION public.fn_fornecedor_buscar(p_company_id uuid, p_termo text, p_limit int DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_termo text := btrim(coalesce(p_termo,'')); v_dig text; v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Login obrigatório');
  END IF;
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF length(v_termo) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  v_dig := NULLIF(regexp_replace(v_termo, '\D', '', 'g'), '');
  SELECT jsonb_agg(j) INTO v_out FROM (
    SELECT jsonb_build_object(
      'fornecedor_id', f.id,
      'nome', COALESCE(NULLIF(btrim(f.nome_fantasia),''), NULLIF(btrim(f.razao_social),''), '—'),
      'cnpj_cpf', COALESCE(NULLIF(btrim(f.cnpj_cpf),''), NULLIF(btrim(f.cpf_cnpj),'')),
      'cidade', f.cidade
    ) AS j
    FROM erp_fornecedores f
    WHERE f.company_id = p_company_id AND COALESCE(f.ativo, true)
      AND ( f.nome_fantasia ILIKE '%'||v_termo||'%'
         OR f.razao_social ILIKE '%'||v_termo||'%'
         OR (v_dig IS NOT NULL AND (regexp_replace(COALESCE(f.cnpj_cpf, ''), '\D', '', 'g') LIKE '%'||v_dig||'%'
                                 OR regexp_replace(COALESCE(f.cpf_cnpj, ''), '\D', '', 'g') LIKE '%'||v_dig||'%')) )
    ORDER BY COALESCE(NULLIF(btrim(f.nome_fantasia),''), NULLIF(btrim(f.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_fornecedor_buscar(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fornecedor_buscar(uuid, text, int) TO authenticated, service_role;
