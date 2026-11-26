-- Chamado #5451 (cadastros/clientes, Auto Mecanica Gean): "ao pesquisar o cliente (ex.: ROMARIO), se nao botar
-- o acento ou nao escrever 100% o cadastro, ele nao puxa". Causa (RD-38): a busca de cliente/fornecedor usa ILIKE,
-- que ignora maiusculas mas NAO ignora acento -> "Romario" nunca acha "Romario" (com acento) gravado no banco.
--
-- Esta migration torna o PONTO UNICO DE SERVIDOR (as funcoes canonicas fn_cliente_buscar / fn_fornecedor_buscar,
-- usadas pela NF-e avulsa e demais seletores por RPC) ACENTO-INSENSIVEL, reaproveitando a coluna gerada `busca_norm`
-- (nome_fantasia + razao_social, minusculo e SEM acento) e o wrapper IMMUTABLE `public.fn_texto_busca_norm`
-- introduzidos pela PR #5876 (chamado #5451, tela de cadastro). Depende dessas duas (coluna + funcao) ja existirem
-- no ledger: esta PR so vai a Ready depois que a #5876 estiver mergeada.
--
-- Prova real (RD-38, producao read-only): o cliente "Romario Pires" (Gean a462e13f-...) casa
--   lower(unaccent('public.unaccent', nome_fantasia||' '||razao_social)) LIKE '%romario%'  (sem acento) e '%romar%' (parcial).
-- `busca_norm` materializa exatamente essa expressao e tem indice GIN trigram -> busca continua rapida.
--
-- Seguranca: so CREATE OR REPLACE de funcao de LEITURA (STABLE). A FORMA da resposta (cliente_id/fornecedor_id, nome,
-- cnpj_cpf, cidade) fica IDENTICA -> nenhum consumidor (NF-e avulsa) quebra. Guarda de empresa, grants e ordenacao
-- mantidos. Nenhum UPDATE/DELETE/DDL em dado de cliente. Idempotente (CREATE OR REPLACE).

-- ========================= CLIENTES =========================
CREATE OR REPLACE FUNCTION public.fn_cliente_buscar(p_company_id uuid, p_termo text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
      AND ( c.busca_norm ILIKE '%'||public.fn_texto_busca_norm(v_termo)||'%'
         OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(c.cnpj_cpf, c.cpf_cnpj, ''), '\D', '', 'g') ILIKE '%'||v_dig||'%') )
    ORDER BY COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_cliente_buscar(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_buscar(uuid, text, integer) TO authenticated, service_role;

-- ========================= FORNECEDORES =========================
CREATE OR REPLACE FUNCTION public.fn_fornecedor_buscar(p_company_id uuid, p_termo text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      AND ( f.busca_norm ILIKE '%'||public.fn_texto_busca_norm(v_termo)||'%'
         OR (v_dig IS NOT NULL AND (regexp_replace(COALESCE(f.cnpj_cpf, ''), '\D', '', 'g') LIKE '%'||v_dig||'%'
                                 OR regexp_replace(COALESCE(f.cpf_cnpj, ''), '\D', '', 'g') LIKE '%'||v_dig||'%')) )
    ORDER BY COALESCE(NULLIF(btrim(f.nome_fantasia),''), NULLIF(btrim(f.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_fornecedor_buscar(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fornecedor_buscar(uuid, text, integer) TO authenticated, service_role;
