-- conserto-main: fn_clientes_duplicados_listar timeout (statement_timeout 57014) no @pos-migration da main.
--
-- Causa (provado no dado, RD-38): a função montava o JSON de cada grupo de documentos duplicados com
-- uma SUBCONSULTA CORRELACIONADA por grupo ("(SELECT jsonb_agg(...) FROM c WHERE c.doc = g.doc)"),
-- rescaneando a CTE materializada `c` uma vez por grupo. Na empresa de DEMONSTRAÇÃO Comércio
-- (b0700000-0000-4000-a000-000000000004) os testes de aceitação acumularam ~16 mil cadastros ao longo
-- de semanas (o afterEach só inativa, nunca remove), gerando 1.436 grupos duplicados. 1.436 grupos x
-- ~16k linhas = ~23 milhões de comparações -> a função estourava o statement_timeout e devolvia 500.
--
-- Correção: reescrita em PASSO ÚNICO (GROUP BY doc + jsonb_agg com ORDER BY interno), SEM subconsulta
-- correlacionada. Saída byte-a-byte idêntica (mesmo filtro, mesmo HAVING count>1, mesmos campos, mesma
-- ordenação interna por ativo DESC/created_at e externa por documento).
--
-- Prova (produção, BEGIN...ROLLBACK, statement_timeout curto):
--   * versão antiga: >timeout (cancelado por statement timeout) na DEMO Comércio.
--   * versão nova: 313 ms, mesmos 1.436 grupos. Plano: GroupAggregate único, sem Nested Loop por grupo.
--
-- Benefício durável: a função deixa de ser O(grupos x n); fica rápida mesmo com muitos cadastros/duplicados,
-- protegendo também empresas de cliente reais. Não toca dado de cliente; apenas CREATE OR REPLACE da função.

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
    WITH c AS (
      SELECT x.id, x.nome_fantasia, x.razao_social, x.codigo, x.ativo, x.ref_externa_sistema,
             x.cep, x.cidade, x.codigo_ibge_municipio, x.created_at,
             public.fn_clientes_documento_digitos(x.cpf_cnpj, x.cnpj_cpf) AS doc
        FROM public.erp_clientes x
       WHERE x.company_id = p_company_id AND x.unificado_para IS NULL
    ), f AS (
      SELECT * FROM c WHERE length(doc) IN (11, 14) AND doc !~ '^(\d)\1*$'
    ), grp AS (
      SELECT doc,
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
        FROM f
       GROUP BY doc
      HAVING count(*) > 1
    )
    SELECT jsonb_agg(jsonb_build_object('documento', doc, 'cadastros', cadastros) ORDER BY doc)
      FROM grp
  ), '[]'::jsonb);
END $function$;

-- Guarda de ACL (check_fn_guards / revoke_anon): função SECURITY DEFINER NÃO exposta a anon.
-- A ACL viva em produção já é {postgres, authenticated, service_role} (anon/PUBLIC sem acesso);
-- estas linhas apenas declaram no arquivo o que o banco já aplica, para um db push limpo reproduzir a ACL.
REVOKE ALL ON FUNCTION public.fn_clientes_duplicados_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_duplicados_listar(uuid) TO authenticated, service_role;
