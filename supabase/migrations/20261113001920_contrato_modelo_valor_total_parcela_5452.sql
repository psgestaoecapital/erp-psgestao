-- #5452 / #5450 (Pdois · modelos de contrato): a geração do contrato a partir do modelo
-- preenche as marcações {{...}}, mas faltavam duas que os modelos reais da Jordana usam:
--   {{valor_total}}   — valor total do contrato (R$)
--   {{valor_parcela}} — valor de cada parcela (R$)
-- A Jordana pediu (chamados #5452/#3? via Canal PS): "Os valores e as parcelas (valor total,
-- número de parcelas, valor da parcela, vencimentos) também entram no modelo".
--
-- ADITIVA: só acrescenta duas chaves ao catálogo (fn_contrato_modelo_variaveis) e ao mapa de
-- substituição (fn_contrato_modelo_gerar). Nenhum comportamento existente muda: os 24 campos
-- atuais continuam idênticos; texto que não usa as novas marcações sai igual.
--
-- Derivação conservadora (o texto gerado é editável antes de salvar — idx 14/15 item 2):
--   valor_parcela = valor_mensal (o valor recorrente/da parcela), vazio se nulo;
--   valor_total   = valor_mensal × numero_parcelas, SOMENTE quando ambos presentes e
--                   numero_parcelas > 0; caso contrário vazio (contrato em aberto não tem total
--                   finito → marcação fica pendente e a tela avisa, nunca grava número errado).
-- Prova (RD-38) em erp_contratos da Pdois (36b69d77-...): CTR-2026-0011 valor_mensal 1300 × 13
--   parcelas → valor_total 16.900,00, valor_parcela 1.300,00; contratos sem numero_parcelas →
--   valor_total vazio (correto). Nenhuma das 2 chaves existia no catálogo antes desta migration.

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
    jsonb_build_object('chave','empresa_razao_social',     'rotulo','Razão social da empresa'),
    jsonb_build_object('chave','empresa_nome_fantasia',    'rotulo','Nome fantasia da empresa'),
    jsonb_build_object('chave','empresa_cnpj',             'rotulo','CNPJ da empresa'),
    jsonb_build_object('chave','data_hoje',                'rotulo','Data de hoje')
  );
$function$;

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

  SELECT * INTO v_empresa FROM public.companies WHERE id = p_company_id;

  -- catálogo chave -> valor já formatado (datas DD/MM/YYYY, dinheiro via fn_brl)
  v_vars := jsonb_build_object(
    'cliente_nome',             COALESCE(v_contrato.cliente_nome, ''),
    'cliente_cnpj',             COALESCE(v_contrato.cliente_cnpj, ''),
    'cliente_email',            COALESCE(v_contrato.cliente_email, ''),
    'cliente_telefone',         COALESCE(v_contrato.cliente_telefone, ''),
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
