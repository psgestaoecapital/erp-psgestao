-- COMPL-TERCEIROS · Funcionários do terceiro com documentos PRÓPRIOS (aplica_a='funcionario_terceiro').
--
-- Auditoria (RD-38/RD-51/RD-26): o cadastro de "funcionário do terceiro" JÁ EXISTE — é
-- compliance_funcionarios.prestador_id (3 já cadastrados) + a aba "Funcionários" no detalhe do
-- prestador + NovoFuncionarioModal. NÃO crio compliance_prestador_funcionario (duplicaria).
-- O BUG real (a "outra tela" da Karol): v_compliance_matriz_funcionarios NÃO olha prestador_id →
-- aplica os 155 exigidos de funcionário PRÓPRIO também aos funcionários do terceiro. Fix: a matriz
-- passa a usar aplica_a='funcionario_terceiro' quando prestador_id IS NOT NULL (próprio segue igual).
-- + novo perfil 'funcionario_terceiro' no CHECK e nas RPCs de exigência (config por perfil).

-- 1) Perfil novo no domínio de aplica_a.
ALTER TABLE public.compliance_documento_exigido DROP CONSTRAINT IF EXISTS compliance_documento_exigido_aplica_a_check;
ALTER TABLE public.compliance_documento_exigido
  ADD CONSTRAINT compliance_documento_exigido_aplica_a_check
  CHECK (aplica_a = ANY (ARRAY['funcionario','prestador','ambos','funcionario_terceiro']::text[]));

-- 2) Matriz de funcionários: perfil-aware. Próprio (prestador_id IS NULL) = funcionario/ambos (igual
--    ao de antes, sem regressão); terceiro (prestador_id NOT NULL) = funcionario_terceiro/ambos, e
--    SEM o fallback de catálogo 'funcionario' (não herda os 155). Colunas de saída inalteradas.
CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios AS
 WITH funcs AS (
         SELECT f_1.id AS funcionario_id, f_1.company_id, f_1.empresa_tomadora_id, f_1.nome_completo,
            f_1.cpf, f_1.cargo, f_1.setor, f_1.empresa_tomadora_nome, f_1.obra_nome,
            f_1.ativo AS funcionario_ativo, f_1.prestador_id
           FROM compliance_funcionarios f_1
          WHERE (f_1.ativo = true)
        ), docs_ativos AS (
         SELECT DISTINCT ON (d_1.funcionario_id, COALESCE((d_1.tipo_documento_id)::text, (d_1.exigido_id)::text)) d_1.funcionario_id,
            d_1.tipo_documento_id, d_1.exigido_id, d_1.id AS documento_id, d_1.data_emissao,
            d_1.data_validade, d_1.status_validade, d_1.dias_para_vencer, d_1.arquivo_url
           FROM compliance_documentos d_1
          WHERE ((d_1.ativo = true) AND (d_1.funcionario_id IS NOT NULL))
          ORDER BY d_1.funcionario_id, COALESCE((d_1.tipo_documento_id)::text, (d_1.exigido_id)::text), d_1.versao DESC
        ), dispensas_func AS (
         SELECT cd.funcionario_id, cd.tipo_documento_id, cd.motivo
           FROM compliance_dispensas cd
          WHERE ((cd.ativo = true) AND (cd.funcionario_id IS NOT NULL))
        )
 SELECT f.funcionario_id, f.company_id, f.empresa_tomadora_id, f.nome_completo, f.cpf, f.cargo,
    f.setor, f.empresa_tomadora_nome, f.obra_nome, f.funcionario_ativo,
    tipos.tipo_documento_id, tipos.tipo_slug, tipos.tipo_nome, tipos.tipo_grupo, tipos.obrigatorio,
    d.documento_id, d.data_emissao, d.data_validade, d.status_validade, d.dias_para_vencer, d.arquivo_url,
        CASE
            WHEN (disp.tipo_documento_id IS NOT NULL) THEN 'nao_se_aplica'::text
            WHEN (d.documento_id IS NULL) THEN 'nao_emitido'::text
            ELSE COALESCE(d.status_validade, 'desconhecido'::text)
        END AS status_final,
    disp.motivo AS dispensa_motivo, tipos.exigido_id, tipos.nome_custom
   FROM (((funcs f
     JOIN LATERAL ( SELECT ex.id AS exigido_id, ex.tipo_documento_id,
            COALESCE(t.slug, ('custom_'::text || ex.id)) AS tipo_slug,
            COALESCE(NULLIF(btrim(ex.nome_custom), ''::text), t.nome) AS tipo_nome,
            COALESCE(t.grupo, 'Documentos próprios'::text) AS tipo_grupo,
            COALESCE(ex.obrigatorio, t.obrigatorio, true) AS obrigatorio,
            NULLIF(btrim(ex.nome_custom), ''::text) AS nome_custom
           FROM (compliance_documento_exigido ex
             LEFT JOIN compliance_tipos_documento t ON ((t.id = ex.tipo_documento_id)))
          WHERE ((ex.company_id = f.company_id) AND ex.ativo
             AND (ex.aplica_a = ANY (CASE WHEN f.prestador_id IS NOT NULL
                        THEN ARRAY['funcionario_terceiro'::text, 'ambos'::text]
                        ELSE ARRAY['funcionario'::text, 'ambos'::text] END)))
        UNION ALL
         SELECT NULL::uuid AS uuid, t.id, t.slug, t.nome, t.grupo, t.obrigatorio, NULL::text AS text
           FROM compliance_tipos_documento t
          WHERE (t.ativo AND (t.categoria = 'funcionario'::text) AND (f.prestador_id IS NULL)
             AND (NOT (EXISTS ( SELECT 1 FROM compliance_documento_exigido e2
                  WHERE ((e2.company_id = f.company_id) AND e2.ativo AND (e2.aplica_a = ANY (ARRAY['funcionario'::text, 'ambos'::text])))))))) tipos ON (true))
     LEFT JOIN docs_ativos d ON (((d.funcionario_id = f.funcionario_id) AND (((tipos.tipo_documento_id IS NOT NULL) AND (d.tipo_documento_id = tipos.tipo_documento_id)) OR ((tipos.tipo_documento_id IS NULL) AND (d.exigido_id = tipos.exigido_id))))))
     LEFT JOIN dispensas_func disp ON (((disp.funcionario_id = f.funcionario_id) AND (disp.tipo_documento_id = tipos.tipo_documento_id))));

-- 3) RPCs de exigência aceitam 'funcionario_terceiro'. No listar, o CATÁLOGO do terceiro reusa os
--    tipos de funcionário (categoria/aplicavel_a='funcionario'); o "marcado" é por aplica_a do perfil.
CREATE OR REPLACE FUNCTION public.fn_compliance_exigidos_listar(p_company_id uuid, p_aplica_a text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cat jsonb; v_custom jsonb; v_cat_match text; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  v_cat_match := CASE WHEN p_aplica_a = 'funcionario_terceiro' THEN 'funcionario' ELSE p_aplica_a END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tipo_documento_id', t.id, 'nome', t.nome, 'grupo', t.grupo, 'base_legal', t.base_legal,
      'validade_dias_padrao', t.validade_dias_padrao, 'obrigatorio', t.obrigatorio, 'codigo_esocial', t.codigo_esocial,
      'marcado', EXISTS (SELECT 1 FROM public.compliance_documento_exigido e WHERE e.company_id=p_company_id AND e.tipo_documento_id=t.id AND e.ativo AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos'))
    ) ORDER BY t.grupo NULLS LAST, t.ordem_exibicao NULLS LAST, t.nome), '[]'::jsonb) INTO v_cat
    FROM public.compliance_tipos_documento t
   WHERE t.ativo AND (t.categoria = v_cat_match OR t.aplicavel_a = v_cat_match);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'exigido_id', e.id, 'nome_custom', e.nome_custom, 'obrigatorio', e.obrigatorio, 'validade_dias', e.validade_dias,
      'alertar_dias_antes', e.alertar_dias_antes, 'aplica_a', e.aplica_a) ORDER BY e.nome_custom), '[]'::jsonb) INTO v_custom
    FROM public.compliance_documento_exigido e
   WHERE e.company_id=p_company_id AND e.ativo AND e.tipo_documento_id IS NULL AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos');
  RETURN jsonb_build_object('ok', true, 'catalogo', v_cat, 'custom', v_custom);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_toggle(p_company_id uuid, p_tipo_id uuid, p_aplica_a text, p_on boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.compliance_tipos_documento; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_aplica_a NOT IN ('funcionario','prestador','ambos','funcionario_terceiro') THEN RAISE EXCEPTION 'aplica_a_invalido'; END IF;
  SELECT * INTO t FROM public.compliance_tipos_documento WHERE id = p_tipo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF p_on THEN
    INSERT INTO public.compliance_documento_exigido (company_id, tipo_documento_id, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
    VALUES (p_company_id, p_tipo_id, p_aplica_a, COALESCE(t.obrigatorio,true), t.validade_dias_padrao, t.alertar_dias_antes)
    ON CONFLICT (company_id, tipo_documento_id, aplica_a) WHERE tipo_documento_id IS NOT NULL DO UPDATE SET ativo = true, atualizado_em = now();
  ELSE
    UPDATE public.compliance_documento_exigido SET ativo = false, atualizado_em = now()
      WHERE company_id=p_company_id AND tipo_documento_id=p_tipo_id AND aplica_a=p_aplica_a;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_custom_salvar(p_company_id uuid, p_nome text, p_aplica_a text, p_obrigatorio boolean DEFAULT true, p_validade_dias integer DEFAULT NULL::integer, p_alertar_dias_antes integer DEFAULT NULL::integer, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.compliance_documento_exigido; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF p_aplica_a NOT IN ('funcionario','prestador','ambos','funcionario_terceiro') THEN RAISE EXCEPTION 'aplica_a_invalido'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.compliance_documento_exigido (company_id, nome_custom, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
    VALUES (p_company_id, btrim(p_nome), p_aplica_a, COALESCE(p_obrigatorio,true), p_validade_dias, p_alertar_dias_antes) RETURNING * INTO r;
  ELSE
    UPDATE public.compliance_documento_exigido SET nome_custom = btrim(p_nome), aplica_a = p_aplica_a,
      obrigatorio = COALESCE(p_obrigatorio, obrigatorio), validade_dias = p_validade_dias, alertar_dias_antes = p_alertar_dias_antes,
      ativo = true, atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id AND tipo_documento_id IS NULL RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'custom_nao_encontrado'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $function$;
