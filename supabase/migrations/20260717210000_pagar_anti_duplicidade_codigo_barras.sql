-- FASE B · Anti-duplicidade de pagamento por código de barras (erp_pagar).
-- Reusa a coluna erp_pagar.codigo_barras (JÁ EXISTE · 0/8556 preenchidas hoje).
-- Índice parcial (ignora os nulos que hoje são a maioria) + função de checagem.
-- 🔒 RD-45: escopo company_id explícito. 🔒 RD-51: sem código = sem match (0 falso-positivo).
-- Normaliza SÓ DÍGITOS dos 2 lados (colado/digitado/bipado vem com espaço/ponto/hífen).
-- RD-44: colunas reais = descricao, valor, data_vencimento, status, created_at.

CREATE INDEX IF NOT EXISTS ix_erp_pagar_codbarras
  ON public.erp_pagar (company_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_pagar_checar_duplicidade(
  p_company_id uuid, p_codigo_barras text, p_excluir_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, descricao text, valor numeric, vencimento date, status text, criado_em timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT p.id, p.descricao::text, p.valor, p.data_vencimento, p.status::text, p.created_at
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id                                   -- 🔒 explícito (RD-45)
    AND p.codigo_barras IS NOT NULL
    AND length(regexp_replace(coalesce(p_codigo_barras,''), '\D', '', 'g')) >= 20  -- sem código útil = sem match
    AND regexp_replace(p.codigo_barras, '\D', '', 'g')
        = regexp_replace(p_codigo_barras, '\D', '', 'g')              -- normalizado dos 2 lados
    AND (p_excluir_id IS NULL OR p.id <> p_excluir_id)                -- edição não alerta contra si mesma
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_pagar_checar_duplicidade(uuid, text, uuid) TO authenticated;
