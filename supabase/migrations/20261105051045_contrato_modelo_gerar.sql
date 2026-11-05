-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — slice 3: GERAÇÃO do contrato a partir do modelo
-- RD-26: REUSA erp_contratos / erp_contratos.texto_legal (NÃO recria o cadastro de contrato) e fn_brl.
-- A RPC lê o MODELO (erp_contrato_modelo, slice 1) + o CONTRATO (erp_contratos) + a EMPRESA (companies),
-- substitui os campos variáveis {{campo}} (espaços tolerados: {{ campo }}) pelos dados reais e grava
-- o resultado em erp_contratos.texto_legal (quando p_gravar = true) — rastreável em audit_log_global.
-- ADITIVA: só cria funções novas; o único UPDATE é texto_legal do próprio contrato da empresa (guarda
-- de empresa + RLS). IDEMPOTENTE (re-gerar sobrescreve texto_legal, mantém histórico via audit).
-- RD-100: nenhum nome de sistema de terceiros.

-- 1) Catálogo das variáveis disponíveis (para a tela mostrar quais {{campos}} existem, RD-95) ---------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_variaveis()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
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
$f$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_variaveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_variaveis() TO authenticated, service_role;

-- 2) Geração do contrato a partir do modelo -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_gerar(
  p_company_id  uuid,
  p_modelo_id   uuid,
  p_contrato_id uuid,
  p_gravar      boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
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
END; $f$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) IS
  'Chamado #5452 slice 3: gera o texto do contrato a partir de um modelo (erp_contrato_modelo), substituindo os campos variaveis {{campo}} com dados do contrato/cliente/empresa e gravando em erp_contratos.texto_legal (p_gravar). Rastreavel em audit_log_global.';
