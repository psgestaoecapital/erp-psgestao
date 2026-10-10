-- Correção do gatilho do #2300 (CEO 10/10 — regressão que deixou o @pos-migration vermelho no run 323, spec
-- cliente-cnpj-duplicado-guarda.spec.ts:66, [celular]). O design (#2300) diz que linhas de sincronização/importação
-- (ref_externa_sistema preenchido) "passam dos dois lados": a função isentava a linha que ENTRA, mas o SELECT da
-- duplicata EXISTENTE não excluía as linhas de sync — então uma linha de sync ATIVA com o mesmo documento bloqueava
-- criar um cliente ativo manual (defeito real de produção, além de quebrar o spec do próprio #2300).
-- Única mudança: "AND c.ref_externa_sistema IS NULL" no SELECT da duplicata existente. CREATE OR REPLACE idempotente;
-- já aplicado em produção como hotfix urgente (execute_sql) para destravar a fila; este arquivo casa o repositório ao banco.
CREATE OR REPLACE FUNCTION public.fn_clientes_cnpj_duplicado_guarda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc     text;
  v_doc_ant text;
  v_ex      record;
BEGIN
  IF NOT coalesce(NEW.ativo, true) OR NEW.ref_externa_sistema IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_doc := public.fn_clientes_documento_digitos(NEW.cpf_cnpj, NEW.cnpj_cpf);
  IF v_doc IS NULL OR length(v_doc) NOT IN (11, 14) OR v_doc ~ '^(\d)\1*$' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_doc_ant := public.fn_clientes_documento_digitos(OLD.cpf_cnpj, OLD.cnpj_cpf);
    -- mesmo documento, mesma empresa e já estava ativo → é edição de outro campo; não confere
    IF v_doc_ant IS NOT DISTINCT FROM v_doc AND coalesce(OLD.ativo, true) AND OLD.company_id = NEW.company_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT c.id, coalesce(nullif(btrim(c.nome_fantasia), ''), nullif(btrim(c.razao_social), ''), 'sem nome') AS nome, c.codigo
    INTO v_ex
    FROM public.erp_clientes c
   WHERE c.company_id = NEW.company_id
     AND c.id <> NEW.id
     AND coalesce(c.ativo, true)
     AND c.ref_externa_sistema IS NULL   -- sync/importação não conta como duplicata existente (design do #2300)
     AND (regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g') = v_doc
       OR regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g') = v_doc)
   ORDER BY c.created_at
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('Este %s já está cadastrado nesta empresa: %s%s. Abra esse cadastro e edite-o, em vez de criar outro.',
                       CASE WHEN length(v_doc) = 14 THEN 'CNPJ' ELSE 'CPF' END,
                       v_ex.nome,
                       CASE WHEN coalesce(btrim(v_ex.codigo), '') <> '' THEN ' (código ' || btrim(v_ex.codigo) || ')' ELSE '' END),
      HINT = 'Dois cadastros com o mesmo documento fazem a nota fiscal e a cobrança pegarem o cliente errado. Se o outro cadastro está errado, inative-o antes.';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_clientes_cnpj_duplicado_guarda() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.fn_clientes_cnpj_duplicado_guarda() IS
  'Recusa cliente ATIVO feito à mão (sem ref_externa_sistema) com CNPJ/CPF (só dígitos) igual ao de outro cliente ATIVO E SEM ref_externa_sistema da mesma empresa. Linhas de sincronização passam dos dois lados. Não mexe em dado existente.';
