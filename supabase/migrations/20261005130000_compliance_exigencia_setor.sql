-- ============================================================
-- Compliance · Treinamentos/documentos exigidos POR SETOR (chamado #42, Frioeste)
-- ============================================================
-- Decisão do Eng. Chefe: obrigatório = UNIÃO de (escopo atual por cargo/setor) + (setor parametrizado) + (marcação manual
-- da pessoa). Aditivo (RD-55): nada que já é exigido deixa de ser. Fonte única (RD-65): a view da matriz e a função da aba
-- Documentos do funcionário leem a MESMA tabela nova. Definições vivas lidas com pg_get_functiondef/pg_get_viewdef.

CREATE TABLE IF NOT EXISTS public.compliance_exigencia_setor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  setor_id      uuid NOT NULL,
  exigido_id    uuid NOT NULL REFERENCES public.compliance_documento_exigido(id) ON DELETE CASCADE,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  ativo         boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exig_setor ON public.compliance_exigencia_setor (setor_id, exigido_id);
CREATE INDEX IF NOT EXISTS ix_exig_setor_company ON public.compliance_exigencia_setor (company_id, setor_id, ativo);
ALTER TABLE public.compliance_exigencia_setor ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_exigencia_setor' AND policyname='p_exig_setor_tenant') THEN
    CREATE POLICY p_exig_setor_tenant ON public.compliance_exigencia_setor FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_exigencia_setor TO authenticated;

-- View da matriz: igual à viva, só acrescenta "OR setor parametrizado" ao critério de escopo.
CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios AS
 WITH funcs AS (
         SELECT f_1.id AS funcionario_id, f_1.company_id, f_1.empresa_tomadora_id, f_1.nome_completo, f_1.cpf, f_1.cargo, f_1.setor,
            f_1.empresa_tomadora_nome, f_1.obra_nome, f_1.ativo AS funcionario_ativo, f_1.prestador_id, f_1.funcao, f_1.setor_id
           FROM compliance_funcionarios f_1
          WHERE f_1.ativo = true
        ), docs_ativos AS (
         SELECT DISTINCT ON (d_1.funcionario_id, (COALESCE(d_1.tipo_documento_id::text, d_1.exigido_id::text))) d_1.funcionario_id,
            d_1.tipo_documento_id, d_1.exigido_id, d_1.id AS documento_id, d_1.data_emissao, d_1.data_validade, d_1.status_validade,
            d_1.dias_para_vencer, d_1.arquivo_url
           FROM compliance_documentos d_1
          WHERE d_1.ativo = true AND d_1.funcionario_id IS NOT NULL
          ORDER BY d_1.funcionario_id, (COALESCE(d_1.tipo_documento_id::text, d_1.exigido_id::text)), d_1.versao DESC
        ), dispensas_func AS (
         SELECT cd.funcionario_id, cd.tipo_documento_id, cd.motivo
           FROM compliance_dispensas cd
          WHERE cd.ativo = true AND cd.funcionario_id IS NOT NULL
        )
 SELECT f.funcionario_id, f.company_id, f.empresa_tomadora_id, f.nome_completo, f.cpf, f.cargo, f.setor, f.empresa_tomadora_nome,
    f.obra_nome, f.funcionario_ativo, tipos.tipo_documento_id, tipos.tipo_slug, tipos.tipo_nome, tipos.tipo_grupo, tipos.obrigatorio,
    d.documento_id, d.data_emissao, d.data_validade, d.status_validade, d.dias_para_vencer, d.arquivo_url,
        CASE
            WHEN disp.tipo_documento_id IS NOT NULL THEN 'nao_se_aplica'::text
            WHEN d.documento_id IS NULL THEN 'nao_emitido'::text
            ELSE COALESCE(d.status_validade, 'desconhecido'::text)
        END AS status_final,
    disp.motivo AS dispensa_motivo, tipos.exigido_id, tipos.nome_custom
   FROM funcs f
     JOIN LATERAL ( SELECT ex.id AS exigido_id, ex.tipo_documento_id,
            COALESCE(t.slug, 'custom_'::text || ex.id) AS tipo_slug,
            COALESCE(NULLIF(btrim(ex.nome_custom), ''::text), t.nome) AS tipo_nome,
            COALESCE(t.grupo, 'Documentos próprios'::text) AS tipo_grupo,
            COALESCE(ex.obrigatorio, t.obrigatorio, true) AS obrigatorio,
            NULLIF(btrim(ex.nome_custom), ''::text) AS nome_custom
           FROM compliance_documento_exigido ex
             LEFT JOIN compliance_tipos_documento t ON t.id = ex.tipo_documento_id
          WHERE ex.company_id = f.company_id AND ex.ativo AND (ex.aplica_a = ANY (
                CASE
                    WHEN f.prestador_id IS NOT NULL THEN ARRAY['funcionario_terceiro'::text, 'ambos'::text]
                    ELSE ARRAY['funcionario'::text, 'ambos'::text]
                END)) AND ((ex.funcao IS NULL OR (lower(btrim(ex.funcao)) = ANY (ARRAY[lower(btrim(COALESCE(f.funcao, ''::text))), lower(btrim(COALESCE(f.cargo, ''::text)))]))) AND (ex.setor_id IS NULL OR ex.setor_id = f.setor_id) OR (EXISTS ( SELECT 1
                   FROM compliance_exigencia_pessoa ip
                  WHERE ip.funcionario_id = f.funcionario_id AND ip.exigido_id = ex.id AND ip.ativo)) OR (EXISTS ( SELECT 1
                   FROM compliance_exigencia_setor es
                  WHERE es.setor_id = f.setor_id AND es.exigido_id = ex.id AND es.ativo)))
        UNION ALL
         SELECT NULL::uuid AS uuid, t.id, t.slug, t.nome, t.grupo, t.obrigatorio, NULL::text AS text
           FROM compliance_tipos_documento t
          WHERE t.ativo AND t.categoria = 'funcionario'::text AND f.prestador_id IS NULL AND NOT (EXISTS ( SELECT 1
                   FROM compliance_documento_exigido e2
                  WHERE e2.company_id = f.company_id AND e2.ativo AND (e2.aplica_a = ANY (ARRAY['funcionario'::text, 'ambos'::text]))))) tipos ON true
     LEFT JOIN docs_ativos d ON d.funcionario_id = f.funcionario_id AND (tipos.tipo_documento_id IS NOT NULL AND d.tipo_documento_id = tipos.tipo_documento_id OR tipos.tipo_documento_id IS NULL AND d.exigido_id = tipos.exigido_id)
     LEFT JOIN dispensas_func disp ON disp.funcionario_id = f.funcionario_id AND disp.tipo_documento_id = tipos.tipo_documento_id;

-- Aba Documentos do funcionário: mesma regra (união) + motivo em linguagem simples.
CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_docs(p_company_id uuid, p_funcionario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_f record; v jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT id, funcao, cargo, setor_id, nome_completo INTO v_f
    FROM public.compliance_funcionarios WHERE id=p_funcionario_id AND company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'funcionario_invalido'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tipo_grupo') NULLS LAST, (x->>'tipo_nome')), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'exigido_id', ex.id, 'tipo_documento_id', ex.tipo_documento_id,
      'tipo_nome', COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome),
      'tipo_grupo', COALESCE(t.grupo, 'Documentos próprios'),
      'escopo_funcao', ex.funcao, 'escopo_setor_id', ex.setor_id,
      'em_escopo', (d.em_escopo OR d.por_setor), 'incluido', d.incluido, 'dispensado', d.dispensado,
      'aplica', ((d.em_escopo OR d.por_setor OR d.incluido) AND NOT d.dispensado),
      'dispensa', CASE WHEN d.dispensado THEN jsonb_build_object('em', d.disp_em, 'por', d.disp_por) ELSE NULL END,
      'motivo', CASE
        WHEN d.dispensado THEN 'Dispensado' || COALESCE(' em ' || to_char(d.disp_em, 'DD/MM/YYYY'), '') || COALESCE(' por ' || d.disp_por, '')
        WHEN d.incluido THEN 'Marcado manualmente para esta pessoa'
        WHEN d.por_setor THEN 'Exigido para o setor ' || COALESCE((SELECT setor FROM public.compliance_funcionarios s WHERE s.setor_id=v_f.setor_id AND s.company_id=p_company_id LIMIT 1), 'definido')
        WHEN d.em_escopo AND ex.funcao IS NOT NULL THEN 'Exigido para o cargo ' || ex.funcao
        WHEN d.em_escopo AND ex.setor_id IS NOT NULL THEN 'Exigido para o setor ' || COALESCE((SELECT setor FROM public.compliance_funcionarios s WHERE s.setor_id=ex.setor_id AND s.company_id=p_company_id LIMIT 1), 'definido')
        WHEN d.em_escopo THEN 'Exigido para todos (sem restrição de cargo/setor)'
        ELSE 'Não se aplica a este cargo/setor'
      END
    ) AS x
    FROM public.compliance_documento_exigido ex
    LEFT JOIN public.compliance_tipos_documento t ON t.id = ex.tipo_documento_id
    CROSS JOIN LATERAL (
      SELECT
        ((ex.funcao IS NULL OR lower(btrim(ex.funcao)) = ANY (ARRAY[lower(btrim(COALESCE(v_f.funcao,''))), lower(btrim(COALESCE(v_f.cargo,'')))]))
          AND (ex.setor_id IS NULL OR ex.setor_id = v_f.setor_id)) AS em_escopo,
        EXISTS (SELECT 1 FROM public.compliance_exigencia_setor es WHERE es.setor_id=v_f.setor_id AND es.exigido_id=ex.id AND es.ativo) AS por_setor,
        EXISTS (SELECT 1 FROM public.compliance_exigencia_pessoa ip WHERE ip.funcionario_id=p_funcionario_id AND ip.exigido_id=ex.id AND ip.ativo) AS incluido,
        (ex.tipo_documento_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.compliance_dispensas cd WHERE cd.funcionario_id=p_funcionario_id AND cd.tipo_documento_id=ex.tipo_documento_id AND cd.ativo)) AS dispensado,
        (SELECT cd.dispensado_em FROM public.compliance_dispensas cd WHERE cd.funcionario_id=p_funcionario_id AND cd.tipo_documento_id=ex.tipo_documento_id AND cd.ativo ORDER BY cd.dispensado_em DESC LIMIT 1) AS disp_em,
        (SELECT u.email FROM public.compliance_dispensas cd LEFT JOIN public.users u ON u.id=cd.dispensado_por WHERE cd.funcionario_id=p_funcionario_id AND cd.tipo_documento_id=ex.tipo_documento_id AND cd.ativo ORDER BY cd.dispensado_em DESC LIMIT 1) AS disp_por
    ) d
    WHERE ex.company_id = p_company_id AND ex.ativo AND ex.aplica_a IN ('funcionario','ambos')
  ) s;

  RETURN jsonb_build_object('ok', true,
    'funcionario', jsonb_build_object('id', v_f.id, 'nome', v_f.nome_completo, 'funcao', v_f.funcao, 'cargo', v_f.cargo, 'setor_id', v_f.setor_id),
    'documentos', v);
END $function$;

-- Tela "setor → marcar treinamentos": lista os exigidos da empresa com a marca do setor.
CREATE OR REPLACE FUNCTION public.fn_compliance_setor_exigencias_listar(p_company_id uuid, p_setor_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'exigido_id', ex.id,
      'nome', COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome),
      'grupo', COALESCE(t.grupo, 'Documentos próprios'),
      'marcado_setor', EXISTS (SELECT 1 FROM public.compliance_exigencia_setor es WHERE es.setor_id=p_setor_id AND es.exigido_id=ex.id AND es.ativo),
      'ja_exigido_por_escopo', (ex.funcao IS NULL AND ex.setor_id IS NULL) OR ex.setor_id = p_setor_id
    ) ORDER BY COALESCE(t.grupo,'Documentos próprios'), COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome)), '[]'::jsonb) INTO v
    FROM public.compliance_documento_exigido ex
    LEFT JOIN public.compliance_tipos_documento t ON t.id = ex.tipo_documento_id
   WHERE ex.company_id = p_company_id AND ex.ativo AND ex.aplica_a IN ('funcionario','ambos');
  RETURN jsonb_build_object('ok', true, 'exigencias', v);
END $function$;

-- Salva a marcação de um setor. Só mexe nas marcas do setor (nunca em exigido/escopo atual): aditivo.
CREATE OR REPLACE FUNCTION public.fn_compliance_setor_exigencias_salvar(p_company_id uuid, p_setor_id uuid, p_exigido_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_marcadas int; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_setor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios WHERE company_id=p_company_id AND setor_id=p_setor_id) THEN
    RAISE EXCEPTION 'setor_invalido';
  END IF;
  SELECT COALESCE(array_agg(ex.id), '{}') INTO v_ids FROM public.compliance_documento_exigido ex
   WHERE ex.company_id=p_company_id AND ex.ativo AND ex.aplica_a IN ('funcionario','ambos') AND ex.id = ANY (COALESCE(p_exigido_ids,'{}'));
  INSERT INTO public.compliance_exigencia_setor (company_id, setor_id, exigido_id, criado_por)
    SELECT p_company_id, p_setor_id, i, auth.uid() FROM unnest(v_ids) i
    ON CONFLICT (setor_id, exigido_id) DO UPDATE SET ativo=true, atualizado_em=now();
  UPDATE public.compliance_exigencia_setor SET ativo=false, atualizado_em=now()
   WHERE company_id=p_company_id AND setor_id=p_setor_id AND ativo AND NOT (exigido_id = ANY (v_ids));
  SELECT count(*) INTO v_marcadas FROM public.compliance_exigencia_setor WHERE company_id=p_company_id AND setor_id=p_setor_id AND ativo;
  RETURN jsonb_build_object('ok', true, 'marcadas', v_marcadas);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_compliance_setor_exigencias_listar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_setor_exigencias_salvar(uuid, uuid, uuid[]) TO authenticated;
