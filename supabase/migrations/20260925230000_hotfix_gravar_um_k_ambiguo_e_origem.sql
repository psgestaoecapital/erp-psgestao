-- HOTFIX (Rodrigo/Alliance 25/09 17:10, "column reference k is ambiguous" ao importar 264 clientes).
-- Duas regressões introduzidas por mim nas migrations 20260925210000/220000, uma mascarando a outra:
--   1. #1803 declarou a variável de loop `k` no FOREACH; ela colide com o alias `unnest(v_keys) k`
--      das subqueries de string_agg → "column reference k is ambiguous". Quebrava TODA criação.
--      Fix: variável do loop renomeada para v_campo (o alias k das subqueries volta a ser único).
--   2. v_origem recebia `", origem"` com ASPAS DUPLAS — em PL/pgSQL isso é identificador, não string
--      → 'column ", origem" does not exist'. Só apareceu depois de corrigir a 1. Fix: aspas simples
--      nos três pontos (criar, atualizar-completar, atualizar-normal).
-- Aplicado à mão em produção via execute_sql (hotfix urgente) e provado executando os TRÊS ramos
-- (criar / atualizar / completar) na sandbox [BOT] Revenda em rollback. Este arquivo espelha o que
-- está em produção; CREATE OR REPLACE é idempotente no deploy-migrations.
-- Lição: o dry-run anterior só validava o CREATE — plpgsql não checa o SQL embutido até executar.
-- Todo dry-run de função de importação passa a EXECUTAR gravar_um nos três ramos, não só criá-la.

CREATE OR REPLACE FUNCTION public.fn_cadastro_importar_gravar_um(p_company uuid, p_tabela text, p_linha jsonb, p_completar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_doc text := regexp_replace(coalesce(p_linha->>'cpf_cnpj',''), '\D', '', 'g');
  v_tp text := upper(btrim(coalesce(p_linha->>'tipo_pessoa','')));
  v_contrib text := CASE btrim(coalesce(p_linha->>'contribuinte_icms','')) WHEN '1' THEN 'contribuinte' WHEN '2' THEN 'isento' WHEN '9' THEN 'nao_contribuinte' ELSE NULL END;
  v_sist text := nullif(btrim(p_linha->>'sistema_origem'),'');
  v_refid text := nullif(btrim(p_linha->>'codigo_sistema_anterior'),'');
  v_nome_norm text := fn_cadastro_norm_nome(coalesce(nullif(btrim(p_linha->>'nome_fantasia'),''), p_linha->>'razao_social'));
  v_row jsonb; v_keys text[]; v_collist text; v_sellist text; v_setlist text; v_id uuid; v_origem text := ''; v_ncount int;
  v_estrategia text := NULL; v_existing jsonb; v_campos text[] := '{}'; v_campo text;
BEGIN
  IF p_tabela NOT IN ('erp_clientes','erp_fornecedores') THEN RAISE EXCEPTION 'tabela invalida %', p_tabela; END IF;
  IF v_tp NOT IN ('PF','PJ') THEN v_tp := CASE WHEN length(v_doc)=11 THEN 'PF' WHEN length(v_doc)=14 THEN 'PJ' ELSE 'PJ' END; END IF;

  v_row := jsonb_strip_nulls(jsonb_build_object(
    'company_id', p_company,
    'nome_fantasia', nullif(btrim(p_linha->>'nome_fantasia'),''),
    'razao_social', nullif(btrim(p_linha->>'razao_social'),''),
    'tipo_pessoa', v_tp,
    'cnpj_cpf', nullif(v_doc,''),
    'cpf_cnpj', nullif(v_doc,''),
    'ie', nullif(btrim(p_linha->>'ie'),''),
    'contribuinte_icms', v_contrib,
    'email', nullif(btrim(p_linha->>'email'),''),
    'telefone', nullif(btrim(p_linha->>'telefone'),''),
    'cep', nullif(regexp_replace(coalesce(p_linha->>'cep',''),'\D','','g'),''),
    'logradouro', nullif(btrim(p_linha->>'logradouro'),''),
    'numero', nullif(btrim(p_linha->>'numero'),''),
    'complemento', nullif(btrim(p_linha->>'complemento'),''),
    'bairro', nullif(btrim(p_linha->>'bairro'),''),
    'cidade', nullif(btrim(p_linha->>'cidade'),''),
    'uf', nullif(upper(btrim(p_linha->>'uf')),''),
    'ref_externa_sistema', v_sist,
    'ref_externa_id', v_refid,
    'ativo', CASE lower(btrim(coalesce(p_linha->>'ativo','sim'))) WHEN 'não' THEN false WHEN 'nao' THEN false WHEN 'n' THEN false WHEN 'false' THEN false WHEN '0' THEN false ELSE true END
  ));
  v_keys := ARRAY(SELECT jsonb_object_keys(v_row));

  -- casamento: documento → ref_externa → nome (registrando a estratégia que casou)
  IF v_doc <> '' THEN
    EXECUTE format('SELECT id FROM %I WHERE company_id=$1 AND regexp_replace(coalesce(cnpj_cpf,cpf_cnpj,''''),''\D'','''',''g'')=$2 LIMIT 1', p_tabela)
      INTO v_id USING p_company, v_doc;
    IF v_id IS NOT NULL THEN v_estrategia := 'documento'; END IF;
  END IF;
  IF v_id IS NULL AND v_refid IS NOT NULL AND v_sist IS NOT NULL THEN
    EXECUTE format('SELECT id FROM %I WHERE company_id=$1 AND ref_externa_id=$2 AND ref_externa_sistema=$3 LIMIT 1', p_tabela)
      INTO v_id USING p_company, v_refid, v_sist;
    IF v_id IS NOT NULL THEN v_estrategia := 'ref_externa'; END IF;
  END IF;
  IF v_id IS NULL AND p_completar AND v_nome_norm <> '' THEN
    EXECUTE format('SELECT count(*) FROM %I WHERE company_id=$1 AND fn_cadastro_norm_nome(coalesce(nullif(btrim(nome_fantasia),''''), razao_social))=$2', p_tabela)
      INTO v_ncount USING p_company, v_nome_norm;
    IF v_ncount = 1 THEN
      EXECUTE format('SELECT id FROM %I WHERE company_id=$1 AND fn_cadastro_norm_nome(coalesce(nullif(btrim(nome_fantasia),''''), razao_social))=$2 LIMIT 1', p_tabela)
        INTO v_id USING p_company, v_nome_norm;
      IF v_id IS NOT NULL THEN v_estrategia := 'nome'; END IF;
    END IF;
  END IF;

  -- No modo COMPLETAR nunca cria: se não casou (0 ou >1), reporta ignorado.
  IF v_id IS NULL AND p_completar THEN
    RETURN jsonb_build_object('acao','ignorado','estrategia',NULL,'campos','[]'::jsonb);
  END IF;

  IF v_id IS NULL THEN
    v_collist := (SELECT string_agg(quote_ident(k), ', ') FROM unnest(v_keys) k);
    v_sellist := (SELECT string_agg('r.'||quote_ident(k), ', ') FROM unnest(v_keys) k);
    IF p_tabela='erp_clientes' THEN v_origem := ', origem'; END IF;
    EXECUTE format(
      'INSERT INTO %I (%s, importado_em%s) SELECT %s, now()%s FROM jsonb_populate_record(null::%I, $1) r RETURNING id',
      p_tabela, v_collist, v_origem, v_sellist, CASE WHEN p_tabela='erp_clientes' THEN ', ''importacao_planilha''' ELSE '' END, p_tabela
    ) USING v_row INTO v_id;
    RETURN jsonb_build_object('acao','criado','estrategia',NULL,'campos','[]'::jsonb);
  ELSE
    IF p_completar THEN
      -- QUAIS campos serão preenchidos: existente vazio E novo tem valor (para o log).
      EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id=$1', p_tabela) INTO v_existing USING v_id;
      FOREACH v_campo IN ARRAY v_keys LOOP
        IF v_campo <> 'company_id'
           AND (v_existing->>v_campo IS NULL OR btrim(v_existing->>v_campo) = '')
           AND (v_row->>v_campo IS NOT NULL) THEN
          v_campos := v_campos || v_campo;
        END IF;
      END LOOP;
      v_setlist := (SELECT string_agg(format('%1$I = COALESCE(t.%1$I, r.%1$I)', k), ', ')
                    FROM unnest(v_keys) k WHERE k <> 'company_id');
      IF p_tabela='erp_clientes' THEN v_origem := ', origem = COALESCE(t.origem, ''importacao_planilha'')'; END IF;
    ELSE
      v_setlist := (SELECT string_agg(format('%1$I = COALESCE(r.%1$I, t.%1$I)', k), ', ')
                    FROM unnest(v_keys) k WHERE k <> 'company_id');
      IF p_tabela='erp_clientes' THEN v_origem := ', origem = COALESCE(t.origem, ''importacao_planilha'')'; END IF;
    END IF;
    EXECUTE format(
      'UPDATE %I t SET %s, importado_em = now()%s FROM jsonb_populate_record(null::%I, $1) r WHERE t.id=$2 AND t.company_id=$3',
      p_tabela, v_setlist, v_origem, p_tabela
    ) USING v_row, v_id, p_company;
    RETURN jsonb_build_object('acao','atualizado','estrategia',v_estrategia,'campos',to_jsonb(v_campos));
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb,boolean) TO service_role;
