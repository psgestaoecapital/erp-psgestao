-- conserto-main (gilberto-esteira · 2026-11-02): fn_clientes_duplicados_listar estourava
-- statement_timeout (57014 -> HTTP 500) no @pos-migration da main
-- (e2e/jornadas/aceitacao/cliente-unificar-cnpj-duplicado.spec.ts:35, run 41414818417).
--
-- Causa provada no dado (RD-38): a versão anterior, para CADA grupo de documento duplicado,
-- rodava uma subconsulta correlacionada `(SELECT ... FROM c WHERE c.doc = g.doc)` sobre a CTE `c`
-- NÃO materializada. Como `c` recalcula `fn_clientes_documento_digitos(...)` por linha e essa
-- função tem `SET search_path` (logo NÃO é inlinada), o custo virava O(grupos × linhas) chamadas
-- da função — o mesmo anti-padrão "função por linha em volume" do incidente 03/10. Na empresa de
-- demonstração (b0700000-…-0004), com ~15,6 mil cadastros varridos e ~1.423 grupos duplicados
-- (resíduo de testes de aceitação acumulado), isso excedia o statement_timeout.
--
-- Correção: SÓ PERFORMANCE. CTE `c` MATERIALIZED (a função de dígitos roda uma vez por linha),
-- agregação em passo único por documento (sem subconsulta correlacionada). A checagem de acesso,
-- a volatilidade (STABLE), SECURITY DEFINER, o search_path, os GRANTs e o formato de saída
-- (mesmas chaves, mesma ordenação, '[]' quando vazio) permanecem IDÊNTICOS.
-- Sensível (função de dado de cliente) → revisao-eng-chefe + etiqueta conserto-main.

CREATE OR REPLACE FUNCTION public.fn_clientes_duplicados_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH c AS MATERIALIZED (
      SELECT x.id, x.nome_fantasia, x.razao_social, x.codigo, x.ativo,
             x.ref_externa_sistema, x.cep, x.cidade, x.codigo_ibge_municipio, x.created_at,
             public.fn_clientes_documento_digitos(x.cpf_cnpj, x.cnpj_cpf) AS doc
        FROM public.erp_clientes x
       WHERE x.company_id = p_company_id AND x.unificado_para IS NULL
    ), valido AS (
      SELECT * FROM c
       WHERE length(doc) IN (11, 14) AND doc !~ '^(\d)\1*$'
    ), grupo AS (
      SELECT doc,
             count(*) AS n,
             jsonb_agg(jsonb_build_object(
                 'id', id,
                 'nome', coalesce(nullif(btrim(nome_fantasia), ''), nullif(btrim(razao_social), ''), 'sem nome'),
                 'razao_social', razao_social,
                 'codigo', codigo,
                 'ativo', coalesce(ativo, true),
                 'origem', coalesce(ref_externa_sistema, 'manual'),
                 'tem_endereco', (nullif(btrim(cep), '') IS NOT NULL AND nullif(btrim(cidade), '') IS NOT NULL),
                 'tem_ibge', nullif(btrim(codigo_ibge_municipio), '') IS NOT NULL,
                 'criado_em', created_at)
               ORDER BY coalesce(ativo, true) DESC, created_at) AS cadastros
        FROM valido
       GROUP BY doc
    )
    SELECT jsonb_agg(jsonb_build_object('documento', doc, 'cadastros', cadastros) ORDER BY doc)
      FROM grupo
     WHERE n > 1
  ), '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.fn_clientes_duplicados_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_duplicados_listar(uuid) TO authenticated, service_role;
