-- NFE-F5 · Entrega 1 (tela) — suporte de backend pra tela do Livro de Entradas.
-- (1) fn_fiscal_exportacao_registrar ganha p_conteudo: o hash MD5 é calculado NO SERVIDOR (md5() do Postgres),
--     não no cliente — mais limpo e confiável (o cliente não precisa implementar MD5). Se p_conteudo vier,
--     hash_md5 = md5(p_conteudo) e tamanho_bytes = octet_length(p_conteudo); senão mantém o comportamento antigo.
-- (2) registra o slot de menu do Livro (grupo commerce, subgrupo compras) + ativa por tenant p/ a KGF
--     (o passo do tenant_modules_active — sem ele a tela some, como o logo).

CREATE OR REPLACE FUNCTION public.fn_fiscal_exportacao_registrar(
  p_company_id uuid, p_tipo text, p_periodo text, p_hash_md5 text DEFAULT NULL,
  p_linhas int DEFAULT NULL, p_tamanho_bytes int DEFAULT NULL, p_sistema_destino text DEFAULT NULL,
  p_conteudo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; v_hash text; v_tam int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  v_hash := COALESCE(p_hash_md5, CASE WHEN p_conteudo IS NOT NULL THEN md5(p_conteudo) END);
  v_tam  := COALESCE(p_tamanho_bytes, CASE WHEN p_conteudo IS NOT NULL THEN octet_length(p_conteudo) END);
  INSERT INTO public.exportacoes_sped (company_id, tipo, periodo, hash_md5, linhas, tamanho_bytes, sistema_destino, status, gerado_em)
  VALUES (p_company_id, p_tipo, p_periodo, v_hash, p_linhas, v_tam, p_sistema_destino, 'gerado', now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'hash_md5', v_hash, 'tamanho_bytes', v_tam);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fiscal_exportacao_registrar(uuid,text,text,text,int,int,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_exportacao_registrar(uuid,text,text,text,int,int,text,text) TO authenticated, service_role;

-- slot de menu do Livro de Entradas (não existia). NOT NULL do catálogo = id, nome, grupo.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, vertical_specific, legacy, dependencies, surface_in_groups)
VALUES ('commerce_livro_entradas', 'Livro de Entradas', 'commerce', 'compras', 'BookText', '/dashboard/commerce/livro-entradas', 182, true, true, ARRAY['commerce','industrial','hub'], false, ARRAY[]::text[], ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET ativo=true, subgrupo='compras', rota='/dashboard/commerce/livro-entradas';

-- ativa por tenant p/ a KGF (idempotente)
INSERT INTO public.tenant_modules_active (company_id, module_id, is_active, override_reason, activated_at)
SELECT 'a462e13f-0f51-4c54-abe8-4474b591633b', 'commerce_livro_entradas', true, 'NFE-F5 Livro de Entradas', now()
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_modules_active WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id='commerce_livro_entradas');
UPDATE public.tenant_modules_active SET is_active=true, deactivated_at=NULL
 WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id='commerce_livro_entradas';
