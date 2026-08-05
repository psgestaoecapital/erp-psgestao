-- RD-41 · Oficina/recepção: busca de cliente por NOME (ou documento). Multi-tenant (Pilar 2),
-- mesmo molde do fn_pessoa_existe_por_cnpj. Nome ILIKE OU dígitos do cnpj_cpf. Retorna lista
-- (homônimos) com cidade pra desambiguar. Termo < 2 → vazio (não varre a base). RD-26.
CREATE OR REPLACE FUNCTION public.fn_cliente_buscar(p_company_id uuid, p_termo text, p_limit int DEFAULT 10)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_termo text := btrim(coalesce(p_termo,'')); v_dig text; v_out jsonb;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF length(v_termo) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  v_dig := NULLIF(regexp_replace(v_termo, '\D', '', 'g'), '');
  SELECT jsonb_agg(j) INTO v_out FROM (
    SELECT jsonb_build_object(
      'cliente_id', c.id,
      'nome', COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '—'),
      'cnpj_cpf', COALESCE(NULLIF(btrim(c.cnpj_cpf),''), NULLIF(btrim(c.cpf_cnpj),'')),
      'cidade', c.cidade
    ) AS j
    FROM erp_clientes c
    WHERE c.company_id = p_company_id AND COALESCE(c.ativo, true)
      AND ( c.nome_fantasia ILIKE '%'||v_termo||'%'
         OR c.razao_social ILIKE '%'||v_termo||'%'
         OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(c.cnpj_cpf, c.cpf_cnpj, ''), '\D', '', 'g') ILIKE '%'||v_dig||'%') )
    ORDER BY COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_cliente_buscar(uuid, text, int) TO authenticated;
