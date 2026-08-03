-- RD-41 · Municípios IBGE — RPCs de resolução + índice unaccent (preenchimento automático).
-- Parte 2 do SPEC: com a tabela populada (5.570), o sistema resolve o código IBGE sozinho —
-- via CNPJ (a cidade+UF do autofill viram código) e via cidade (autocompletar no cadastro).
-- RD-26: usa a tabela existente + a extensão unaccent (já instalada em public). Aditivo.

-- 1 · wrapper IMMUTABLE do unaccent (unaccent() é STABLE; para indexar precisa ser IMMUTABLE).
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT public.unaccent('public.unaccent', $1) $function$;

-- 2 · índice de busca rápida por (uf, nome sem acento/caixa) — casa "sao miguel" com "São Miguel".
CREATE INDEX IF NOT EXISTS ix_municipios_uf_nome_unaccent
  ON public.erp_gov_nfse_municipios (uf, lower(public.f_unaccent(nome_municipio)));

-- 3 · leitura da tabela (referência pública): libera SELECT p/ autocompletar cidade no cadastro.
DROP POLICY IF EXISTS municipios_sel ON public.erp_gov_nfse_municipios;
CREATE POLICY municipios_sel ON public.erp_gov_nfse_municipios
  FOR SELECT TO authenticated, anon USING (true);

-- 4 · resolve o código IBGE por nome + UF (tolerante a acento/caixa/espaços). "São"/"Sao" idem.
CREATE OR REPLACE FUNCTION public.fn_municipio_por_nome_uf(p_nome text, p_uf text)
RETURNS TABLE(codigo_ibge text, nome_municipio text, uf text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_nome text; v_uf text;
BEGIN
  IF p_nome IS NULL OR p_uf IS NULL THEN RETURN; END IF;
  -- normaliza: sem acento, minúsculo, espaços colapsados
  v_nome := btrim(regexp_replace(lower(public.f_unaccent(p_nome)), '\s+', ' ', 'g'));
  v_uf   := upper(btrim(p_uf));
  IF v_nome = '' OR v_uf = '' THEN RETURN; END IF;
  RETURN QUERY
    SELECT m.codigo_ibge, m.nome_municipio, m.uf
      FROM public.erp_gov_nfse_municipios m
     WHERE m.uf = v_uf
       AND btrim(regexp_replace(lower(public.f_unaccent(m.nome_municipio)), '\s+', ' ', 'g')) = v_nome
     ORDER BY m.codigo_ibge
     LIMIT 1;
END $function$;

-- 5 · validação reversa: dado o código IBGE, devolve nome + UF (p/ preencher/confirmar a cidade).
CREATE OR REPLACE FUNCTION public.fn_municipio_por_ibge(p_codigo text)
RETURNS TABLE(codigo_ibge text, nome_municipio text, uf text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v text;
BEGIN
  v := regexp_replace(coalesce(p_codigo,''), '\D', '', 'g');   -- só dígitos (aceita com máscara)
  IF length(v) <> 7 THEN RETURN; END IF;
  RETURN QUERY
    SELECT m.codigo_ibge, m.nome_municipio, m.uf
      FROM public.erp_gov_nfse_municipios m
     WHERE m.codigo_ibge = v
     LIMIT 1;
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_municipio_por_nome_uf(text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_municipio_por_ibge(text) TO authenticated, anon;
