-- Importação de Cadastros · P2 (banco). Prévia + aplicar da planilha de clientes/fornecedores.
-- Prioridade CEO (23/09). Genérico (qualquer empresa/sistema de origem). Migration idempotente
-- (CREATE OR REPLACE), guarda por empresa, autoria auth.uid(), REVOKE anon.
--
-- Contrato de coluna: as chaves das linhas jsonb são as de src/lib/cadastros/colunasImportacao.ts
-- (tipo, tipo_pessoa, nome_fantasia, razao_social, cpf_cnpj, codigo_sistema_anterior, sistema_origem,
--  ie, im, contribuinte_icms, ..., cidade, uf, ...). Casamento por CPF/CNPJ normalizado, depois por
-- ref_externa_id + ref_externa_sistema. Grava cnpj_cpf E cpf_cnpj (RD-65 canônico+legado). "Ambos"
-- cria/atualiza nos DOIS cadastros. LGPD: registra a importação em erp_importacoes (quem/quando/quantos),
-- NÃO guarda o arquivo.

-- ── Validador de CPF/CNPJ (dígito verificador). IMMUTABLE, reutilizável. ──
CREATE OR REPLACE FUNCTION public.fn_cadastro_doc_valido(p_doc text)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE d text := regexp_replace(coalesce(p_doc,''), '\D', '', 'g'); s int; dv int; i int;
BEGIN
  IF d = '' THEN RETURN false; END IF;
  IF length(d) = 11 THEN
    IF d ~ '^(.)\1{10}$' THEN RETURN false; END IF;                    -- 11 dígitos iguais é inválido
    s := 0; FOR i IN 0..8 LOOP s := s + substr(d,i+1,1)::int * (10-i); END LOOP;
    dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
    IF dv <> substr(d,10,1)::int THEN RETURN false; END IF;
    s := 0; FOR i IN 0..9 LOOP s := s + substr(d,i+1,1)::int * (11-i); END LOOP;
    dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
    RETURN dv = substr(d,11,1)::int;
  ELSIF length(d) = 14 THEN
    IF d ~ '^(.)\1{13}$' THEN RETURN false; END IF;
    s := 0; FOR i IN 0..11 LOOP s := s + substr(d,i+1,1)::int * (CASE WHEN i < 4 THEN 5-i ELSE 13-i END); END LOOP;
    dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
    IF dv <> substr(d,13,1)::int THEN RETURN false; END IF;
    s := 0; FOR i IN 0..12 LOOP s := s + substr(d,i+1,1)::int * (CASE WHEN i < 5 THEN 6-i ELSE 14-i END); END LOOP;
    dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
    RETURN dv = substr(d,14,1)::int;
  END IF;
  RETURN false;   -- comprimento diferente de 11/14
END $function$;

-- ── Helper interno: grava UMA linha num cadastro (erp_clientes|erp_fornecedores). Casa por documento
-- normalizado e depois por ref_externa; devolve 'criado' | 'atualizado'. Só a coluna 'origem' (clientes). ──
CREATE OR REPLACE FUNCTION public.fn_cadastro_importar_gravar_um(p_company uuid, p_tabela text, p_linha jsonb)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_doc text := regexp_replace(coalesce(p_linha->>'cpf_cnpj',''), '\D', '', 'g');
  v_tp text := upper(btrim(coalesce(p_linha->>'tipo_pessoa','')));
  v_contrib text := CASE btrim(coalesce(p_linha->>'contribuinte_icms','')) WHEN '1' THEN 'contribuinte' WHEN '2' THEN 'isento' WHEN '9' THEN 'nao_contribuinte' ELSE NULL END;
  v_sist text := nullif(btrim(p_linha->>'sistema_origem'),'');
  v_refid text := nullif(btrim(p_linha->>'codigo_sistema_anterior'),'');
  v_row jsonb; v_keys text[]; v_collist text; v_sellist text; v_setlist text; v_id uuid; v_origem text := '';
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

  -- casamento: documento normalizado; depois ref_externa (id + sistema)
  IF v_doc <> '' THEN
    EXECUTE format('SELECT id FROM %I WHERE company_id=$1 AND regexp_replace(coalesce(cnpj_cpf,cpf_cnpj,''''),''\D'','''',''g'')=$2 LIMIT 1', p_tabela)
      INTO v_id USING p_company, v_doc;
  END IF;
  IF v_id IS NULL AND v_refid IS NOT NULL AND v_sist IS NOT NULL THEN
    EXECUTE format('SELECT id FROM %I WHERE company_id=$1 AND ref_externa_id=$2 AND ref_externa_sistema=$3 LIMIT 1', p_tabela)
      INTO v_id USING p_company, v_refid, v_sist;
  END IF;

  IF v_id IS NULL THEN
    v_collist := (SELECT string_agg(quote_ident(k), ', ') FROM unnest(v_keys) k);
    v_sellist := (SELECT string_agg('r.'||quote_ident(k), ', ') FROM unnest(v_keys) k);
    IF p_tabela='erp_clientes' THEN v_origem := ", origem"; END IF;
    EXECUTE format(
      'INSERT INTO %I (%s, importado_em%s) SELECT %s, now()%s FROM jsonb_populate_record(null::%I, $1) r RETURNING id',
      p_tabela, v_collist, v_origem, v_sellist, CASE WHEN p_tabela='erp_clientes' THEN ', ''importacao_planilha''' ELSE '' END, p_tabela
    ) USING v_row INTO v_id;
    RETURN 'criado';
  ELSE
    -- atualiza só com valores presentes (COALESCE mantém o que já existe); não mexe em company_id
    v_setlist := (SELECT string_agg(format('%1$I = COALESCE(r.%1$I, t.%1$I)', k), ', ')
                  FROM unnest(v_keys) k WHERE k <> 'company_id');
    IF p_tabela='erp_clientes' THEN v_origem := ", origem = COALESCE(t.origem, 'importacao_planilha')"; END IF;
    EXECUTE format(
      'UPDATE %I t SET %s, importado_em = now()%s FROM jsonb_populate_record(null::%I, $1) r WHERE t.id=$2 AND t.company_id=$3',
      p_tabela, v_setlist, v_origem, p_tabela
    ) USING v_row, v_id, p_company;
    RETURN 'atualizado';
  END IF;
END $function$;

-- ── PRÉVIA: valida e classifica cada linha, SEM gravar. ──
CREATE OR REPLACE FUNCTION public.fn_cadastro_importar_previa(p_company uuid, p_linhas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb; v_ln jsonb; v_i int := 0;
  v_tipo text; v_tp text; v_nome text; v_doc text; v_uf text; v_sist text; v_refid text;
  v_motivo text; v_acao text; v_cli uuid; v_forn uuid;
  v_ufs text[] := ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  v_seen text[] := '{}';
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  FOR v_ln IN SELECT * FROM jsonb_array_elements(coalesce(p_linhas,'[]'::jsonb)) LOOP
    v_i := v_i + 1;
    v_tipo := lower(btrim(coalesce(v_ln->>'tipo','')));
    v_tp   := upper(btrim(coalesce(v_ln->>'tipo_pessoa','')));
    v_nome := btrim(coalesce(v_ln->>'nome_fantasia',''));
    v_doc  := regexp_replace(coalesce(v_ln->>'cpf_cnpj',''), '\D', '', 'g');
    v_uf   := upper(btrim(coalesce(v_ln->>'uf','')));
    v_sist := nullif(btrim(v_ln->>'sistema_origem'),'');
    v_refid := nullif(btrim(v_ln->>'codigo_sistema_anterior'),'');
    v_motivo := NULL; v_acao := NULL; v_cli := NULL; v_forn := NULL;

    -- linha vazia (sem nome, sem doc, sem tipo) → ignorar
    IF v_nome = '' AND v_doc = '' AND v_tipo = '' THEN
      v_acao := 'ignorar'; v_motivo := 'linha vazia';
    ELSIF v_nome = '' THEN
      v_acao := 'erro'; v_motivo := 'nome obrigatório';
    ELSIF v_tipo NOT IN ('cliente','fornecedor','ambos') THEN
      v_acao := 'erro'; v_motivo := 'tipo inválido (use Cliente, Fornecedor ou Ambos)';
    ELSIF v_tp NOT IN ('PF','PJ') AND v_doc = '' THEN
      v_acao := 'erro'; v_motivo := 'tipo de pessoa (PF/PJ) obrigatório quando não há CPF/CNPJ';
    ELSIF v_doc <> '' AND NOT fn_cadastro_doc_valido(v_doc) THEN
      v_acao := 'erro'; v_motivo := 'CPF/CNPJ com dígito verificador inválido';
    ELSIF v_uf <> '' AND NOT (v_uf = ANY(v_ufs)) THEN
      v_acao := 'erro'; v_motivo := 'UF inválida';
    ELSIF v_doc <> '' AND v_doc = ANY(v_seen) THEN
      v_acao := 'erro'; v_motivo := 'CPF/CNPJ duplicado na planilha';
    END IF;

    IF v_doc <> '' THEN v_seen := v_seen || v_doc; END IF;

    IF v_acao IS NULL THEN
      -- casar existentes nos cadastros do escopo
      IF v_tipo IN ('cliente','ambos') THEN
        IF v_doc <> '' THEN SELECT id INTO v_cli FROM erp_clientes WHERE company_id=p_company AND regexp_replace(coalesce(cnpj_cpf,cpf_cnpj,''),'\D','','g')=v_doc LIMIT 1; END IF;
        IF v_cli IS NULL AND v_refid IS NOT NULL AND v_sist IS NOT NULL THEN SELECT id INTO v_cli FROM erp_clientes WHERE company_id=p_company AND ref_externa_id=v_refid AND ref_externa_sistema=v_sist LIMIT 1; END IF;
      END IF;
      IF v_tipo IN ('fornecedor','ambos') THEN
        IF v_doc <> '' THEN SELECT id INTO v_forn FROM erp_fornecedores WHERE company_id=p_company AND regexp_replace(coalesce(cnpj_cpf,cpf_cnpj,''),'\D','','g')=v_doc LIMIT 1; END IF;
        IF v_forn IS NULL AND v_refid IS NOT NULL AND v_sist IS NOT NULL THEN SELECT id INTO v_forn FROM erp_fornecedores WHERE company_id=p_company AND ref_externa_id=v_refid AND ref_externa_sistema=v_sist LIMIT 1; END IF;
      END IF;
      -- atualizar se já existe em algum dos cadastros do escopo; senão criar
      IF (v_tipo IN ('cliente','ambos') AND v_cli IS NOT NULL) OR (v_tipo IN ('fornecedor','ambos') AND v_forn IS NOT NULL) THEN
        v_acao := 'atualizar';
      ELSE
        v_acao := 'criar';
      END IF;
    END IF;

    v_out := v_out || jsonb_build_object('indice', v_i, 'acao', v_acao, 'motivo', v_motivo,
      'tipo', v_tipo, 'existente_cliente_id', v_cli, 'existente_fornecedor_id', v_forn);
  END LOOP;

  RETURN jsonb_build_object('ok', true,
    'total', v_i,
    'criar',     (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'acao'='criar'),
    'atualizar', (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'acao'='atualizar'),
    'erro',      (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'acao'='erro'),
    'ignorar',   (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'acao'='ignorar'),
    'ambos',     (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'tipo'='ambos' AND e->>'acao' IN ('criar','atualizar')),
    'linhas', v_out);
END $function$;

-- ── APLICAR: grava só as linhas sem erro, na mesma transação. Idempotente. ──
CREATE OR REPLACE FUNCTION public.fn_cadastro_importar_aplicar(p_company uuid, p_linhas jsonb, p_modo text DEFAULT 'criar_e_atualizar')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_previa jsonb; v_linhas jsonb; v_ln jsonb; v_res jsonb; v_i int := 0; v_idx int;
  v_acao text; v_tipo text; v_r text;
  v_criados int := 0; v_atualizados int := 0; v_ignorados int := 0; v_erros int := 0;
  v_cri_cli int := 0; v_cri_forn int := 0; v_sist text;
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_modo NOT IN ('so_novos','criar_e_atualizar') THEN p_modo := 'criar_e_atualizar'; END IF;

  v_previa := fn_cadastro_importar_previa(p_company, p_linhas);
  IF NOT (v_previa->>'ok')::boolean THEN RETURN v_previa; END IF;
  v_linhas := coalesce(p_linhas,'[]'::jsonb);

  FOR v_res IN SELECT * FROM jsonb_array_elements(v_previa->'linhas') LOOP
    v_idx := (v_res->>'indice')::int;
    v_acao := v_res->>'acao';
    v_tipo := v_res->>'tipo';
    v_ln := v_linhas->(v_idx-1);
    IF v_acao = 'erro' THEN v_erros := v_erros + 1; CONTINUE; END IF;
    IF v_acao = 'ignorar' THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;
    IF v_acao = 'atualizar' AND p_modo = 'so_novos' THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;

    IF v_tipo IN ('cliente','ambos') THEN
      v_r := fn_cadastro_importar_gravar_um(p_company, 'erp_clientes', v_ln);
      IF v_r = 'criado' THEN v_cri_cli := v_cri_cli + 1; END IF;
    END IF;
    IF v_tipo IN ('fornecedor','ambos') THEN
      v_r := fn_cadastro_importar_gravar_um(p_company, 'erp_fornecedores', v_ln);
      IF v_r = 'criado' THEN v_cri_forn := v_cri_forn + 1; END IF;
    END IF;

    IF v_acao = 'criar' THEN v_criados := v_criados + 1; ELSE v_atualizados := v_atualizados + 1; END IF;
  END LOOP;

  -- LGPD: registra a importação (quem/quando/quantos) — NÃO guarda o arquivo.
  v_sist := (SELECT string_agg(DISTINCT nullif(btrim(e->>'sistema_origem'),''), ', ')
             FROM jsonb_array_elements(v_linhas) e);
  INSERT INTO erp_importacoes (company_id, user_id, tipo_dado, sistema_origem, status,
    registros_total, registros_novos, registros_atualizados, registros_erro, iniciado_em, concluido_em, metadata)
  VALUES (p_company, auth.uid(), 'cadastros', left(coalesce(v_sist,'planilha'), 120), 'concluido',
    (v_previa->>'total')::int, v_criados, v_atualizados, v_erros, now(), now(),
    jsonb_build_object('modo', p_modo, 'ignorados', v_ignorados, 'criados_cliente', v_cri_cli, 'criados_fornecedor', v_cri_forn));

  RETURN jsonb_build_object('ok', true, 'modo', p_modo,
    'criados', v_criados, 'atualizados', v_atualizados, 'ignorados', v_ignorados, 'erros', v_erros,
    'criados_cliente', v_cri_cli, 'criados_fornecedor', v_cri_forn);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cadastro_doc_valido(text)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cadastro_importar_previa(uuid,jsonb)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cadastro_importar_aplicar(uuid,jsonb,text)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_doc_valido(text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_previa(uuid,jsonb)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_aplicar(uuid,jsonb,text)    TO authenticated, service_role;
-- gravar_um é interna (chamada pelo aplicar, SECURITY DEFINER); não exposta ao cliente.
GRANT EXECUTE ON FUNCTION public.fn_cadastro_importar_gravar_um(uuid,text,jsonb)  TO service_role;
