-- Carteira Gean (caixa jordana-code 3352399e, item 4 — Eng. Chefe 09/10): impedir criar cliente com CNPJ/CPF que já existe,
-- ATIVO, na mesma empresa. Prova no dado (RD-38): na Gean a FC Pisos tem dois cadastros — d0e668bc (ativo, só dígitos,
-- endereço completo) e dc836ebf (CNPJ com pontuação, sem endereço). A tela (PessoaForm) só compara o CNPJ "só dígitos" com a
-- coluna como está gravada (o formatado escapa) e ainda deixa o usuário "criar mesmo assim"; a emissão da OS-2026-0198 achou
-- o cadastro errado. Hoje há 28 grupos de CNPJ duplicado entre cadastros ATIVOS feitos à mão (último em 08/10).
--
-- Regra do gatilho (aditivo, não mexe em nenhum dado existente):
--   * dispara em INSERT e em UPDATE que TROCA o documento ou REATIVA o cadastro (editar endereço de um duplicado antigo passa);
--   * compara só dígitos do documento (cpf_cnpj ou cnpj_cpf, as duas colunas), apenas entre cadastros ATIVOS da mesma empresa;
--   * só vale para documento com 11 (CPF) ou 14 (CNPJ) dígitos e que não seja de um dígito repetido ("00000000000");
--   * cadastro inativo (ativo=false) nunca bloqueia nem é bloqueado — é como se "arquiva" o duplicado errado;
--   * linha de sincronização/importação (ref_externa_sistema preenchido: Omie, importação de planilha, odonto) passa:
--     espelha o sistema de origem, que pode ter o duplicado, e bloquear derrubaria a importação inteira. Elas já
--     reaproveitam o cadastro pelo documento antes de inserir (fn_import_cadastro_v1, fn_cliente_criar_inline);
--   * achou → recusa com mensagem que ensina (RD-74): qual cadastro já tem o documento e o que fazer.
-- Custo: uma busca pelo índice idx_clientes_company (company_id) por linha gravada à mão; nunca varre a tabela toda.
-- SECURITY INVOKER: o usuário só enxerga os clientes das próprias empresas (RLS) — que é exatamente o escopo da checagem.

CREATE OR REPLACE FUNCTION public.fn_clientes_documento_digitos(p_cpf_cnpj text, p_cnpj_cpf text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(regexp_replace(coalesce(nullif(btrim(p_cpf_cnpj), ''), nullif(btrim(p_cnpj_cpf), ''), ''), '\D', '', 'g'), '')
$$;

REVOKE ALL ON FUNCTION public.fn_clientes_documento_digitos(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_documento_digitos(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_clientes_documento_digitos(text, text) IS
  'Só os dígitos do CNPJ/CPF do cliente (cpf_cnpj; se vazio, cnpj_cpf). NULL quando não há documento.';

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

DROP TRIGGER IF EXISTS trg_clientes_cnpj_duplicado_guarda ON public.erp_clientes;
CREATE TRIGGER trg_clientes_cnpj_duplicado_guarda
  BEFORE INSERT OR UPDATE OF cpf_cnpj, cnpj_cpf, ativo, company_id ON public.erp_clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_cnpj_duplicado_guarda();

COMMENT ON FUNCTION public.fn_clientes_cnpj_duplicado_guarda() IS
  'Recusa cliente ATIVO feito à mão (sem ref_externa_sistema) com CNPJ/CPF (só dígitos) igual ao de outro cliente ATIVO da mesma empresa. Não mexe em dado existente.';
