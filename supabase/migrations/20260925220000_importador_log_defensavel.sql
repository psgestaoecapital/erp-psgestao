-- Importação de Cadastros · LOG DEFENSÁVEL (Triches): antes de completar 1.672 cadastros em massa,
-- o registro precisa provar o resultado. Acrescenta ao erp_importacoes:
--   • arquivo_nome  — qual arquivo (a coluna já existia; o aplicar não a preenchia);
--   • metadata.campos_preenchidos {ie:N, cnpj_cpf:N, logradouro:N, …} — QUAIS campos foram completados;
--   • metadata.estrategias {documento:N, ref_externa:N, nome:N} — POR QUAL CHAVE cada registro casou.
-- Saber que "1.700 casaram por código e 40 por nome" é a diferença entre confiar e desconfiar do resultado.
--
-- fn_cadastro_importar_gravar_um passa a devolver jsonb {acao, estrategia, campos} (antes: text).
-- fn_cadastro_importar_aplicar agrega isso e ganha p_arquivo. previa inalterada.
-- SECURITY DEFINER + guarda por empresa (autoria auth.uid()) + REVOKE anon (reafirmados no fim).

-- gravar_um: retorno vira jsonb. DROP do que devolvia text.
DROP FUNCTION IF EXISTS public.fn_cadastro_importar_gravar_um(uuid, text, jsonb, boolean);

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
  v_estrategia text := NULL; v_existing jsonb; v_campos text[] := '{}'; k text;
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
    IF p_tabela='erp_clientes' THEN v_origem := ", origem"; END IF;
    EXECUTE format(
      'INSERT INTO %I (%s, importado_em%s) SELECT %s, now()%s FROM jsonb_populate_record(null::%I, $1) r RETURNING id',
      p_tabela, v_collist, v_origem, v_sellist, CASE WHEN p_tabela='erp_clientes' THEN ', ''importacao_planilha''' ELSE '' END, p_tabela
    ) USING v_row INTO v_id;
    RETURN jsonb_build_object('acao','criado','estrategia',NULL,'campos','[]'::jsonb);
  ELSE
    IF p_completar THEN
      -- QUAIS campos serão preenchidos: existente vazio E novo tem valor (para o log).
      EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id=$1', p_tabela) INTO v_existing USING v_id;
      FOREACH k IN ARRAY v_keys LOOP
        IF k <> 'company_id'
           AND (v_existing->>k IS NULL OR btrim(v_existing->>k) = '')
           AND (v_row->>k IS NOT NULL) THEN
          v_campos := v_campos || k;
        END IF;
      END LOOP;
      v_setlist := (SELECT string_agg(format('%1$I = COALESCE(t.%1$I, r.%1$I)', k), ', ')
                    FROM unnest(v_keys) k WHERE k <> 'company_id');
      IF p_tabela='erp_clientes' THEN v_origem := ", origem = COALESCE(t.origem, 'importacao_planilha')"; END IF;
    ELSE
      v_setlist := (SELECT string_agg(format('%1$I = COALESCE(r.%1$I, t.%1$I)', k), ', ')
                    FROM unnest(v_keys) k WHERE k <> 'company_id');
      IF p_tabela='erp_clientes' THEN v_origem := ", origem = COALESCE(t.origem, 'importacao_planilha')"; END IF;
    END IF;
    EXECUTE format(
      'UPDATE %I t SET %s, importado_em = now()%s FROM jsonb_populate_record(null::%I, $1) r WHERE t.id=$2 AND t.company_id=$3',
      p_tabela, v_setlist, v_origem, p_tabela
    ) USING v_row, v_id, p_company;
    RETURN jsonb_build_object('acao','atualizado','estrategia',v_estrategia,'campos',to_jsonb(v_campos));
  END IF;
END $function$;

-- aplicar: agrega estratégia + campos, grava arquivo_nome. previa inalterada.
-- DROP do 3-arg (o novo 4-arg com p_arquivo o substitui; evita overload ambíguo no PostgREST).
DROP FUNCTION IF EXISTS public.fn_cadastro_importar_aplicar(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.fn_cadastro_importar_aplicar(p_company uuid, p_linhas jsonb, p_modo text DEFAULT 'criar_e_atualizar', p_arquivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_previa jsonb; v_linhas jsonb; v_ln jsonb; v_res jsonb; v_idx int;
  v_acao text; v_tipo text; v_um jsonb; v_completar boolean; v_ult_acao text;
  v_criados int := 0; v_atualizados int := 0; v_ignorados int := 0; v_erros int := 0;
  v_cri_cli int := 0; v_cri_forn int := 0; v_sist text;
  v_estr jsonb := '{}'::jsonb; v_campos jsonb := '{}'::jsonb; v_e text; v_c text;
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_modo NOT IN ('so_novos','criar_e_atualizar','completar_por_nome') THEN p_modo := 'criar_e_atualizar'; END IF;
  v_completar := (p_modo = 'completar_por_nome');

  v_previa := fn_cadastro_importar_previa(p_company, p_linhas, p_modo);
  IF NOT (v_previa->>'ok')::boolean THEN RETURN v_previa; END IF;
  v_linhas := coalesce(p_linhas,'[]'::jsonb);

  FOR v_res IN SELECT * FROM jsonb_array_elements(v_previa->'linhas') LOOP
    v_idx := (v_res->>'indice')::int;
    v_acao := v_res->>'acao';
    v_tipo := v_res->>'tipo';
    v_ln := v_linhas->(v_idx-1);
    IF v_acao = 'erro' THEN v_erros := v_erros + 1; CONTINUE; END IF;
    IF v_acao = 'ignorar' THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;
    IF v_acao = 'criar' AND p_modo = 'completar_por_nome' THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;
    IF v_acao = 'atualizar' AND p_modo = 'so_novos' THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;

    v_ult_acao := NULL;
    IF v_tipo IN ('cliente','ambos') THEN
      v_um := fn_cadastro_importar_gravar_um(p_company, 'erp_clientes', v_ln, v_completar);
      v_ult_acao := v_um->>'acao';
      IF v_um->>'acao' = 'criado' THEN v_cri_cli := v_cri_cli + 1; END IF;
      v_e := v_um->>'estrategia';
      IF v_e IS NOT NULL THEN v_estr := jsonb_set(v_estr, ARRAY[v_e], to_jsonb(coalesce((v_estr->>v_e)::int,0)+1)); END IF;
      FOR v_c IN SELECT jsonb_array_elements_text(v_um->'campos') LOOP
        v_campos := jsonb_set(v_campos, ARRAY[v_c], to_jsonb(coalesce((v_campos->>v_c)::int,0)+1));
      END LOOP;
    END IF;
    IF v_tipo IN ('fornecedor','ambos') THEN
      v_um := fn_cadastro_importar_gravar_um(p_company, 'erp_fornecedores', v_ln, v_completar);
      v_ult_acao := v_um->>'acao';
      IF v_um->>'acao' = 'criado' THEN v_cri_forn := v_cri_forn + 1; END IF;
      v_e := v_um->>'estrategia';
      IF v_e IS NOT NULL THEN v_estr := jsonb_set(v_estr, ARRAY[v_e], to_jsonb(coalesce((v_estr->>v_e)::int,0)+1)); END IF;
      FOR v_c IN SELECT jsonb_array_elements_text(v_um->'campos') LOOP
        v_campos := jsonb_set(v_campos, ARRAY[v_c], to_jsonb(coalesce((v_campos->>v_c)::int,0)+1));
      END LOOP;
    END IF;

    IF v_completar AND v_ult_acao = 'ignorado' THEN v_ignorados := v_ignorados + 1;
    ELSIF v_acao = 'criar' THEN v_criados := v_criados + 1;
    ELSE v_atualizados := v_atualizados + 1; END IF;
  END LOOP;

  v_sist := (SELECT string_agg(DISTINCT nullif(btrim(e->>'sistema_origem'),''), ', ')
             FROM jsonb_array_elements(v_linhas) e);
  INSERT INTO erp_importacoes (company_id, user_id, tipo_dado, sistema_origem, arquivo_nome, status,
    registros_total, registros_novos, registros_atualizados, registros_erro, iniciado_em, concluido_em, metadata)
  VALUES (p_company, auth.uid(), 'cadastros', left(coalesce(v_sist,'planilha'), 120), left(nullif(btrim(p_arquivo),''), 200), 'concluido',
    (v_previa->>'total')::int, v_criados, v_atualizados, v_erros, now(), now(),
    jsonb_build_object('modo', p_modo, 'ignorados', v_ignorados, 'criados_cliente', v_cri_cli,
      'criados_fornecedor', v_cri_forn, 'estrategias', v_estr, 'campos_preenchidos', v_campos));

  RETURN jsonb_build_object('ok', true, 'modo', p_modo,
    'criados', v_criados, 'atualizados', v_atualizados, 'ignorados', v_ignorados, 'erros', v_erros,
    'criados_cliente', v_cri_cli, 'criados_fornecedor', v_cri_forn,
    'estrategias', v_estr, 'campos_preenchidos', v_campos);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cadastro_importar_aplicar(uuid,jsonb,text,text)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_aplicar(uuid,jsonb,text,text)      TO authenticated, service_role;
