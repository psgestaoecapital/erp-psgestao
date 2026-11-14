-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — F2 (slice B): aviso de campos obrigatórios vazios ao gerar.
-- Complementa a slice A (campos_obrigatorios no modelo): ao PRÉ-VISUALIZAR/SALVAR o contrato a partir do
-- modelo (fn_contrato_modelo_gerar, consumida em /dashboard/contratos), a função passa a devolver também
-- campos_obrigatorios_vazios — os campos que o modelo marcou como OBRIGATÓRIOS mas que, para ESTE contrato,
-- resolveram vazio. A tela mostra um aviso (RD-95) para preencher antes de usar. REPORTE, NUNCA BLOQUEIA
-- (RD-97): gerar continua funcionando igual; o array só informa. Modelo sem obrigatórios → array vazio.
--
-- AUTO-CONTIDA: garante a coluna campos_obrigatorios por IF NOT EXISTS (idempotente), então não depende da
-- ordem de merge com a slice A. CREATE OR REPLACE preserva a assinatura de fn_contrato_modelo_gerar (o save
-- segue funcionando no preview da PR; o campo novo só aparece após esta migration). Versão acima da main,
-- faixa de segundos :45–:54.

-- 0) Garante a coluna (idempotente — pode já ter vindo da slice A) --------------------------------------
ALTER TABLE public.erp_contrato_modelo
  ADD COLUMN IF NOT EXISTS campos_obrigatorios text[] NOT NULL DEFAULT '{}'::text[];

-- 1) fn_contrato_modelo_gerar: + campos_obrigatorios_vazios ---------------------------------------------
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
  v_vars      jsonb;
  v_texto     text;
  v_k         text;
  v_v         text;
  v_pendentes text[];
  v_obrig_vazios text[];
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

  -- F2 (#5452): campos marcados como OBRIGATÓRIOS no modelo que resolveram vazio para ESTE contrato.
  -- Reporte, nunca bloqueia: um campo de catálogo cujo valor ficou '' ou um {{campo}} custom que não existe
  -- (valor NULL no catálogo) entra como obrigatório vazio. Ordenado e distinto.
  SELECT COALESCE(array_agg(o ORDER BY o), '{}'::text[]) INTO v_obrig_vazios
  FROM (SELECT DISTINCT o FROM unnest(COALESCE(v_modelo.campos_obrigatorios, '{}'::text[])) AS o) q
  WHERE btrim(COALESCE(v_vars->>o, '')) = '';

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
    'campos_pendentes', COALESCE(to_jsonb(v_pendentes), '[]'::jsonb),
    'campos_obrigatorios_vazios', COALESCE(to_jsonb(v_obrig_vazios), '[]'::jsonb)
  );
END; $function$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_gerar(uuid, uuid, uuid, boolean) TO authenticated, service_role;
