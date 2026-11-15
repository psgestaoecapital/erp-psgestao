-- #5452 F3 (contratos): a CONTRATADA do modelo de contrato vem da "empresa que fatura"
-- (erp_contratos.empresa_faturadora_id) quando definida e do MESMO grupo; senao a propria empresa
-- do contrato (comportamento anterior). Acrescenta as variaveis empresa_endereco/_cidade/_cep.
--
-- Aditivo: muda SO a resolucao da empresa contratada e ADD de 3 variaveis novas no catalogo e no
-- gerador. Nada e removido/renomeado; o fallback preserva o comportamento atual quando nao ha
-- empresa_faturadora_id. Isolamento multi-tenant: a faturadora so e aceita se for do MESMO group_id
-- (companies.group_id) da empresa do contrato — regra identica a fn_contrato_definir_empresa_faturadora
-- e fn_contrato_empresas_faturadoras. Fail-safe: faturadora ausente/fora do grupo -> empresa do contrato.
--
-- Prova RD-38 (grupo 9d8ad6fb-...): o grupo da Pdois tem 2 empresas do mesmo group_id —
--   Prigol/Pdois (36b69d77-...) e Proplay (b2b96eef-...). Um contrato da Prigol com
--   empresa_faturadora_id = Proplay passa a gerar o texto com a razao social/CNPJ/endereco da Proplay.

CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_gerar(p_company_id uuid, p_modelo_id uuid, p_contrato_id uuid, p_gravar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modelo    public.erp_contrato_modelo%ROWTYPE;
  v_contrato  public.erp_contratos%ROWTYPE;
  v_empresa   public.companies%ROWTYPE;
  v_cliente   public.erp_clientes%ROWTYPE;
  v_tem_cli   boolean := false;
  v_cli_end   text := '';
  v_fat_id    uuid;
  v_emp_end   text := '';
  v_vars      jsonb;
  v_texto     text;
  v_k         text;
  v_v         text;
  v_pendentes text[];
BEGIN
  -- guarda de empresa (service connection tem auth.uid() NULL e passa; usuário só a própria empresa)
  IF p_company_id IS NULL
     OR (auth.uid() IS NOT NULL AND NOT public.is_admin()
         AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_modelo FROM public.erp_contrato_modelo
   WHERE id = p_modelo_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo de contrato não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_contrato FROM public.erp_contratos
   WHERE id = p_contrato_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- #5452 F3: CONTRATADA = empresa que fatura (empresa_faturadora_id) quando definida e do MESMO grupo.
  -- Mesma regra de companies.group_id usada por fn_contrato_definir_empresa_faturadora /
  -- fn_contrato_empresas_faturadoras. Fail-safe: faturadora ausente/fora do grupo -> empresa do contrato.
  v_fat_id := v_contrato.empresa_faturadora_id;
  IF v_fat_id IS NOT NULL AND v_fat_id <> p_company_id THEN
    SELECT c.* INTO v_empresa
      FROM public.companies c
     WHERE c.id = v_fat_id
       AND c.group_id IS NOT NULL
       AND c.group_id = (SELECT group_id FROM public.companies WHERE id = p_company_id);
    IF NOT FOUND THEN
      SELECT * INTO v_empresa FROM public.companies WHERE id = p_company_id;
    END IF;
  ELSE
    SELECT * INTO v_empresa FROM public.companies WHERE id = p_company_id;
  END IF;

  -- endereço completo da contratada (mesmo padrão do cliente): campo livre OU composição de partes
  v_emp_end := COALESCE(
    NULLIF(btrim(COALESCE(v_empresa.endereco, '')), ''),
    NULLIF(btrim(
      COALESCE(v_empresa.logradouro, '')
      || CASE WHEN COALESCE(v_empresa.numero, '') <> '' THEN ', ' || v_empresa.numero ELSE '' END
      || CASE WHEN COALESCE(v_empresa.complemento, '') <> '' THEN ' - ' || v_empresa.complemento ELSE '' END
      || CASE WHEN COALESCE(v_empresa.bairro, '') <> '' THEN ', ' || v_empresa.bairro ELSE '' END
    ), ''),
    ''
  );

  -- #6703: cadastro do cliente (contratante) para preencher endereço/cidade/UF/CEP/e-mail/telefone.
  -- Escopado por company_id: não vaza cliente de outra empresa.
  IF v_contrato.cliente_id IS NOT NULL THEN
    SELECT * INTO v_cliente FROM public.erp_clientes
     WHERE id = v_contrato.cliente_id AND company_id = p_company_id;
    v_tem_cli := FOUND;
  END IF;

  IF v_tem_cli THEN
    -- endereço completo: usa o campo livre "endereco" quando preenchido (mais limpo no cadastro real);
    -- senão compõe de logradouro/nº/complemento/bairro.
    v_cli_end := COALESCE(
      NULLIF(btrim(COALESCE(v_cliente.endereco, '')), ''),
      NULLIF(btrim(
        COALESCE(v_cliente.logradouro, '')
        || CASE WHEN COALESCE(v_cliente.numero, '') <> '' THEN ', ' || v_cliente.numero ELSE '' END
        || CASE WHEN COALESCE(v_cliente.complemento, '') <> '' THEN ' - ' || v_cliente.complemento ELSE '' END
        || CASE WHEN COALESCE(v_cliente.bairro, '') <> '' THEN ', ' || v_cliente.bairro ELSE '' END
      ), ''),
      ''
    );
  END IF;

  -- catálogo chave -> valor já formatado (datas DD/MM/YYYY, dinheiro via fn_brl)
  v_vars := jsonb_build_object(
    'cliente_nome',             COALESCE(v_contrato.cliente_nome, ''),
    'cliente_cnpj',             COALESCE(v_contrato.cliente_cnpj, ''),
    'cliente_email',            COALESCE(NULLIF(v_contrato.cliente_email, ''),    CASE WHEN v_tem_cli THEN v_cliente.email ELSE NULL END, ''),
    'cliente_telefone',         COALESCE(NULLIF(v_contrato.cliente_telefone, ''), CASE WHEN v_tem_cli THEN v_cliente.telefone ELSE NULL END, ''),
    'cliente_endereco',         v_cli_end,
    'cliente_cidade',           CASE WHEN v_tem_cli THEN COALESCE(v_cliente.cidade, '') ELSE '' END,
    'cliente_uf',               CASE WHEN v_tem_cli THEN COALESCE(v_cliente.uf, '')     ELSE '' END,
    'cliente_cep',              CASE WHEN v_tem_cli THEN COALESCE(v_cliente.cep, '')    ELSE '' END,
    'contrato_numero',          COALESCE(v_contrato.numero, ''),
    'contrato_nome',            COALESCE(v_contrato.nome, ''),
    'contrato_objeto',          COALESCE(NULLIF(v_contrato.objeto, ''), v_contrato.descricao, ''),
    'contrato_escopo',          COALESCE(v_contrato.escopo, ''),
    'contrato_descricao',       COALESCE(v_contrato.descricao, ''),
    'valor_mensal',             CASE WHEN v_contrato.valor_mensal IS NULL THEN '' ELSE public.fn_brl(v_contrato.valor_mensal) END,
    'valor_atual',              CASE WHEN v_contrato.valor_atual  IS NULL THEN '' ELSE public.fn_brl(v_contrato.valor_atual)  END,
    'valor_parcela',            CASE WHEN v_contrato.valor_mensal IS NULL THEN '' ELSE public.fn_brl(v_contrato.valor_mensal) END,
    'valor_total',              CASE WHEN v_contrato.valor_mensal IS NOT NULL
                                      AND v_contrato.numero_parcelas IS NOT NULL
                                      AND v_contrato.numero_parcelas > 0
                                     THEN public.fn_brl(v_contrato.valor_mensal * v_contrato.numero_parcelas)
                                     ELSE '' END,
    'periodicidade',            COALESCE(v_contrato.periodicidade, ''),
    'forma_pagamento',          COALESCE(v_contrato.forma_pagamento, ''),
    'condicao_pagamento',       COALESCE(v_contrato.condicao_pagamento, ''),
    'condicoes_especificas',    COALESCE(v_contrato.condicoes_especificas, ''),
    'numero_parcelas',          COALESCE(v_contrato.numero_parcelas::text, ''),
    'dia_vencimento',           COALESCE(v_contrato.dia_vencimento::text, ''),
    'data_inicio',              COALESCE(to_char(v_contrato.data_inicio, 'DD/MM/YYYY'), ''),
    'data_fim',                 COALESCE(to_char(v_contrato.data_fim, 'DD/MM/YYYY'), ''),
    'data_primeiro_vencimento', COALESCE(to_char(v_contrato.data_primeiro_vencimento, 'DD/MM/YYYY'), ''),
    'empresa_razao_social',     COALESCE(v_empresa.razao_social, ''),
    'empresa_nome_fantasia',    COALESCE(v_empresa.nome_fantasia, ''),
    'empresa_cnpj',             COALESCE(v_empresa.cnpj, ''),
    'empresa_endereco',         v_emp_end,
    'empresa_cidade',           COALESCE(v_empresa.cidade, ''),
    'empresa_cep',              COALESCE(v_empresa.cep, ''),
    'data_hoje',                to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'DD/MM/YYYY')
  );

  -- normaliza {{ campo }} -> {{campo}} e substitui por replace literal (valores não entram no regex)
  v_texto := regexp_replace(COALESCE(v_modelo.texto, ''), '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', '{{\1}}', 'g');
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each_text(v_vars) LOOP
    v_texto := replace(v_texto, '{{' || v_k || '}}', v_v);
  END LOOP;

  -- campos variáveis não reconhecidos que sobraram (a tela avisa)
  SELECT array_agg(DISTINCT m[1]) INTO v_pendentes
  FROM regexp_matches(v_texto, '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', 'g') AS m;

  IF p_gravar THEN
    UPDATE public.erp_contratos
       SET texto_legal = v_texto,
           updated_at  = now()
     WHERE id = p_contrato_id AND company_id = p_company_id;

    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_contratos', p_contrato_id, 'gerar_texto_legal',
            jsonb_build_object('modelo_id', p_modelo_id, 'modelo_nome', v_modelo.nome,
                               'modelo_versao', v_modelo.versao, 'tamanho', length(v_texto)));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'gravado', p_gravar,
    'contrato_id', p_contrato_id,
    'modelo_id', p_modelo_id,
    'modelo_versao', v_modelo.versao,
    'texto', v_texto,
    'campos_pendentes', COALESCE(to_jsonb(v_pendentes), '[]'::jsonb)
  );
END; $function$;

-- ACL explicita (gate check_fn_guards): CREATE OR REPLACE preserva os grants, mas o gate exige o bloco escrito.
-- Identica a ACL viva em producao.
REVOKE ALL ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) TO authenticated, service_role;

-- Catalogo de variaveis: expoe as 3 novas da contratada para a tela de Modelos listar/inserir.
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_variaveis()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_array(
    jsonb_build_object('chave','cliente_nome',             'rotulo','Nome do cliente'),
    jsonb_build_object('chave','cliente_cnpj',             'rotulo','CNPJ/CPF do cliente'),
    jsonb_build_object('chave','cliente_email',            'rotulo','E-mail do cliente'),
    jsonb_build_object('chave','cliente_telefone',         'rotulo','Telefone do cliente'),
    jsonb_build_object('chave','cliente_endereco',         'rotulo','Endereço do cliente'),
    jsonb_build_object('chave','cliente_cidade',           'rotulo','Cidade do cliente'),
    jsonb_build_object('chave','cliente_uf',               'rotulo','UF do cliente'),
    jsonb_build_object('chave','cliente_cep',              'rotulo','CEP do cliente'),
    jsonb_build_object('chave','contrato_numero',          'rotulo','Número do contrato'),
    jsonb_build_object('chave','contrato_nome',            'rotulo','Nome do contrato'),
    jsonb_build_object('chave','contrato_objeto',          'rotulo','Objeto do contrato'),
    jsonb_build_object('chave','contrato_escopo',          'rotulo','Escopo'),
    jsonb_build_object('chave','contrato_descricao',       'rotulo','Descrição'),
    jsonb_build_object('chave','valor_mensal',             'rotulo','Valor mensal (R$)'),
    jsonb_build_object('chave','valor_atual',              'rotulo','Valor atual (R$)'),
    jsonb_build_object('chave','valor_parcela',            'rotulo','Valor da parcela (R$)'),
    jsonb_build_object('chave','valor_total',              'rotulo','Valor total do contrato (R$)'),
    jsonb_build_object('chave','periodicidade',            'rotulo','Periodicidade'),
    jsonb_build_object('chave','forma_pagamento',          'rotulo','Forma de pagamento'),
    jsonb_build_object('chave','condicao_pagamento',       'rotulo','Condição de pagamento'),
    jsonb_build_object('chave','condicoes_especificas',    'rotulo','Condições específicas'),
    jsonb_build_object('chave','numero_parcelas',          'rotulo','Número de parcelas'),
    jsonb_build_object('chave','dia_vencimento',           'rotulo','Dia de vencimento'),
    jsonb_build_object('chave','data_inicio',              'rotulo','Data de início'),
    jsonb_build_object('chave','data_fim',                 'rotulo','Data de término'),
    jsonb_build_object('chave','data_primeiro_vencimento', 'rotulo','1º vencimento'),
    jsonb_build_object('chave','empresa_razao_social',     'rotulo','Razão social da empresa (contratada)'),
    jsonb_build_object('chave','empresa_nome_fantasia',    'rotulo','Nome fantasia da empresa (contratada)'),
    jsonb_build_object('chave','empresa_cnpj',             'rotulo','CNPJ da empresa (contratada)'),
    jsonb_build_object('chave','empresa_endereco',         'rotulo','Endereço da empresa (contratada)'),
    jsonb_build_object('chave','empresa_cidade',           'rotulo','Cidade da empresa (contratada)'),
    jsonb_build_object('chave','empresa_cep',              'rotulo','CEP da empresa (contratada)'),
    jsonb_build_object('chave','data_hoje',                'rotulo','Data de hoje')
  );
$function$;
