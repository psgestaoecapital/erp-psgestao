-- ============================================================
-- #27 · ponte certificado de turma -> documento do funcionario (Karoline/Frioeste)
-- ============================================================
-- Auditoria (RD-26): as duas pontas existem (nr_turma_presenca com certificado_url;
-- compliance_documentos na ficha do funcionario). Faltava o VÍNCULO. Chave é FK
-- (funcionario_id nos dois lados), nunca matcher por string (lição repetida 5x em 01-05/09).
-- Achado que muda o desenho: 8 dos 9 tipos do Frioeste têm validade_meses NULL → sem a cascata
-- e o aviso na tela, o certificado ficaria fora dos alertas de vencimento (cron 48).

-- 3.1 vinculo explicito tipo de treinamento -> tipo de documento (D1: configurado, nao adivinhado)
ALTER TABLE public.nr_treinamento_tipo
  ADD COLUMN IF NOT EXISTS tipo_documento_id uuid
  REFERENCES public.compliance_tipos_documento(id);
COMMENT ON COLUMN public.nr_treinamento_tipo.tipo_documento_id IS
  'Tipo de documento gerado na ficha do funcionario ao anexar o certificado. NULL = nao gera (sinalizado na tela).';

-- 3.2 rastro da origem: qual presenca gerou o documento (idempotencia real)
ALTER TABLE public.compliance_documentos
  ADD COLUMN IF NOT EXISTS nr_presenca_id uuid
  REFERENCES public.nr_turma_presenca(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_compliance_doc_nr_presenca
  ON public.compliance_documentos (nr_presenca_id)
  WHERE nr_presenca_id IS NOT NULL;
COMMENT ON COLUMN public.compliance_documentos.nr_presenca_id IS
  'Presenca de turma que originou este documento. Unico: uma presenca gera no maximo um documento.';

-- ============================================================
-- 3.3 sincronizador: presenca -> documento
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_nr_sincronizar_documento(p_presenca_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p record; v_tipo_doc uuid; v_validade_padrao int;
  v_data_validade date; v_sem_validade boolean := false;
  v_doc_id uuid; v_anterior uuid; v_versao int := 1; v_nome_arquivo text;
BEGIN
  SELECT p.id, p.company_id, p.funcionario_id, p.certificado_url,
         p.data_emissao_certificado, p.validade_ate, p.presente,
         tu.data_realizacao, ti.nr_codigo, ti.nome AS treino_nome, ti.tipo_documento_id
    INTO v_p
    FROM nr_turma_presenca p
    JOIN nr_turma tu ON tu.id = p.turma_id
    JOIN nr_treinamento_tipo ti ON ti.id = tu.tipo_id
   WHERE p.id = p_presenca_id;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'presenca_nao_encontrada'); END IF;
  -- so gera com certificado de verdade e presenca confirmada
  IF COALESCE(v_p.presente,false) = false
     OR COALESCE(btrim(v_p.certificado_url),'') = '' THEN
    RETURN jsonb_build_object('ok', true, 'gerou', false, 'motivo', 'sem_certificado'); END IF;
  -- D1: sem vinculo configurado NAO gera. Motivo explicito para a tela mostrar.
  v_tipo_doc := v_p.tipo_documento_id;
  IF v_tipo_doc IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'gerou', false, 'motivo', 'tipo_documento_nao_vinculado',
                              'nr_codigo', v_p.nr_codigo); END IF;
  -- D2: cascata de validade
  SELECT validade_dias_padrao INTO v_validade_padrao
    FROM compliance_tipos_documento WHERE id = v_tipo_doc;
  IF v_p.validade_ate IS NOT NULL THEN
    v_data_validade := v_p.validade_ate;
  ELSIF v_validade_padrao IS NOT NULL THEN
    v_data_validade := (COALESCE(v_p.data_emissao_certificado, v_p.data_realizacao)
                       + (v_validade_padrao || ' days')::interval)::date;
  ELSE
    v_sem_validade := true;
  END IF;
  -- ja existe documento desta presenca? entao ALTERA (nao duplica)
  SELECT id INTO v_doc_id FROM compliance_documentos WHERE nr_presenca_id = p_presenca_id;
  IF v_doc_id IS NOT NULL THEN
    UPDATE compliance_documentos SET
      arquivo_url    = v_p.certificado_url,
      data_emissao   = COALESCE(v_p.data_emissao_certificado, v_p.data_realizacao),
      data_validade  = v_data_validade,
      sem_validade   = v_sem_validade,
      ativo          = true
    WHERE id = v_doc_id;
    RETURN jsonb_build_object('ok', true, 'gerou', true, 'acao', 'alterou', 'documento_id', v_doc_id);
  END IF;
  -- D4: reciclagem -> versiona o anterior, nao sobrescreve (historico de treinamento e prova legal)
  SELECT id, versao INTO v_anterior, v_versao
    FROM compliance_documentos
   WHERE company_id = v_p.company_id AND funcionario_id = v_p.funcionario_id
     AND tipo_documento_id = v_tipo_doc AND ativo = true
   ORDER BY COALESCE(data_emissao, '1900-01-01') DESC LIMIT 1;
  IF v_anterior IS NOT NULL THEN
    UPDATE compliance_documentos SET ativo = false WHERE id = v_anterior;
    v_versao := COALESCE(v_versao, 1) + 1;
  ELSE
    v_versao := 1;
  END IF;
  -- arquivo_nome_original é NOT NULL: sintetiza um nome legível (a URL é caminho de storage/UUID)
  v_nome_arquivo := 'Certificado ' || v_p.nr_codigo
    || COALESCE('.' || lower(substring(v_p.certificado_url from '\.([a-zA-Z0-9]+)$')), '');
  INSERT INTO compliance_documentos (
    company_id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original,
    data_emissao, data_validade, sem_validade, emissor, observacoes,
    versao, documento_anterior_id, ativo, nr_presenca_id
  ) VALUES (
    v_p.company_id, v_p.funcionario_id, v_tipo_doc, v_p.certificado_url, v_nome_arquivo,
    COALESCE(v_p.data_emissao_certificado, v_p.data_realizacao),
    v_data_validade, v_sem_validade, NULL,
    'Gerado pela turma de ' || v_p.nr_codigo || ' — ' || v_p.treino_nome,
    v_versao, v_anterior, true, p_presenca_id
  ) RETURNING id INTO v_doc_id;
  RETURN jsonb_build_object('ok', true, 'gerou', true, 'acao', 'criou',
                            'documento_id', v_doc_id, 'versao', v_versao,
                            'sem_validade', v_sem_validade);
END $function$;

-- ============================================================
-- 3.4 anexar certificado passa a sincronizar (v2). Preserva o comportamento atual
-- (grava certificado_url + data_emissao_certificado) e ACRESCENTA a ponte #27.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_nr_certificado_anexar(
  p_company_id uuid, p_presenca_id uuid, p_arquivo_url text, p_data_emissao date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sync jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  UPDATE public.nr_turma_presenca SET certificado_url = p_arquivo_url,
      data_emissao_certificado = COALESCE(p_data_emissao, data_emissao_certificado)
    WHERE id = p_presenca_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'presenca_nao_encontrada'; END IF;
  -- ponte #27: o documento nasce na ficha do funcionario.
  -- falha aqui NAO invalida o anexo do certificado, e NAO e silenciosa (erp_ia_falha).
  BEGIN
    v_sync := public.fn_nr_sincronizar_documento(p_presenca_id);
  EXCEPTION WHEN OTHERS THEN
    v_sync := jsonb_build_object('ok', false, 'erro', SQLERRM);
    PERFORM fn_ia_falha_registrar('pg','fn_nr_certificado_anexar','sincronizar_documento','compliance',
            NULL, SQLERRM, p_company_id);
  END;
  RETURN jsonb_build_object('ok', true, 'documento', v_sync);
END $function$;

-- ============================================================
-- 3.5 configuracao do vinculo (tela)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_nr_tipo_vincular_documento(
  p_company_id uuid, p_tipo_id uuid, p_tipo_documento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  IF p_tipo_documento_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM compliance_tipos_documento
                      WHERE id = p_tipo_documento_id AND categoria = 'funcionario' AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_documento_invalido');
  END IF;
  UPDATE nr_treinamento_tipo SET tipo_documento_id = p_tipo_documento_id, atualizado_em = now()
   WHERE id = p_tipo_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'tipo_nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ============================================================
-- 3.6 leitura para a tela de configuracao (badge honesto — RD-51/58)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_nr_tipos_config_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'nr_codigo'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'tipo_id', ti.id, 'nr_codigo', ti.nr_codigo, 'nome', ti.nome,
      'validade_meses', ti.validade_meses,
      'tipo_documento_id', ti.tipo_documento_id,
      'tipo_documento_nome', td.nome,
      'gera_documento', ti.tipo_documento_id IS NOT NULL,
      'alerta', CASE
        WHEN ti.tipo_documento_id IS NULL THEN 'nao_gera_documento'
        WHEN ti.validade_meses IS NULL AND td.validade_dias_padrao IS NULL THEN 'sem_validade'
        WHEN ti.validade_meses IS NULL THEN 'validade_do_tipo_documento'
        ELSE NULL END,
      'certificados_sem_documento', (
        SELECT count(*) FROM nr_turma_presenca p
          JOIN nr_turma tu ON tu.id = p.turma_id
         WHERE tu.tipo_id = ti.id AND p.company_id = p_company_id
           AND COALESCE(btrim(p.certificado_url),'') <> ''
           AND NOT EXISTS (SELECT 1 FROM compliance_documentos d WHERE d.nr_presenca_id = p.id))
    ) AS x
    FROM nr_treinamento_tipo ti
    LEFT JOIN compliance_tipos_documento td ON td.id = ti.tipo_documento_id
    WHERE ti.company_id = p_company_id AND ti.ativo
  ) s;
  RETURN jsonb_build_object('ok', true, 'tipos', v);
END $function$;

-- fn_nr_sincronizar_documento é INTERNA: só a rota (service_role) e fn_nr_certificado_anexar (owner)
-- a chamam. Não concede a authenticated — não deve ser disparável avulsa pelo cliente.
GRANT EXECUTE ON FUNCTION public.fn_nr_tipo_vincular_documento(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_tipos_config_listar(uuid) TO authenticated;
