-- ============================================================
-- Compliance · Aplicabilidade — suporte às TELAS (#27/#42/#47, parte 2: front)
-- ============================================================
-- O backend (20260910190000) já filtra a ficha por escopo cargo/setor + inclusão/dispensa por pessoa.
-- Aqui só ENRIQUECEMOS os RPCs de leitura pra as duas telas — sem tocar a view nem a regra:
--   1) fn_compliance_exigidos_listar: cada item do catálogo devolve exigido_id + escopo (funcao/setor_id),
--      pra tela "Documentos Exigidos" definir o escopo por cargo/setor.
--   2) fn_compliance_pessoa_docs: devolve MOTIVO legível + aplica + detalhe da dispensa, pra a marcação
--      no cadastro do funcionário MOSTRAR POR QUE cada doc aparece ou não (cuidado do CEO):
--      "Exigido para o cargo Motorista" / "Marcado manualmente" / "Dispensado em 10/09 por X".
--   3) fn_compliance_cargos_setores: alimenta os seletores (cargos e setores distintos da empresa).
-- Tudo aditivo (CREATE OR REPLACE / função nova). Não altera comportamento da apuração.

-- 1) exigidos_listar + exigido_id/escopo por item de catálogo
CREATE OR REPLACE FUNCTION public.fn_compliance_exigidos_listar(p_company_id uuid, p_aplica_a text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cat jsonb; v_custom jsonb; v_cat_match text; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  v_cat_match := CASE WHEN p_aplica_a = 'funcionario_terceiro' THEN 'funcionario' ELSE p_aplica_a END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tipo_documento_id', t.id, 'nome', t.nome, 'grupo', t.grupo, 'base_legal', t.base_legal,
      'validade_dias_padrao', t.validade_dias_padrao, 'obrigatorio', t.obrigatorio, 'codigo_esocial', t.codigo_esocial,
      'marcado', (ex.id IS NOT NULL),
      'exigido_id', ex.id, 'escopo_funcao', ex.funcao, 'escopo_setor_id', ex.setor_id
    ) ORDER BY t.grupo NULLS LAST, t.ordem_exibicao NULLS LAST, t.nome), '[]'::jsonb) INTO v_cat
    FROM public.compliance_tipos_documento t
    LEFT JOIN LATERAL (
      SELECT e.id, e.funcao, e.setor_id FROM public.compliance_documento_exigido e
       WHERE e.company_id=p_company_id AND e.tipo_documento_id=t.id AND e.ativo AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos')
       ORDER BY (e.aplica_a=p_aplica_a) DESC LIMIT 1
    ) ex ON true
   WHERE t.ativo AND (t.categoria = v_cat_match OR t.aplicavel_a = v_cat_match);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'exigido_id', e.id, 'nome_custom', e.nome_custom, 'obrigatorio', e.obrigatorio, 'validade_dias', e.validade_dias,
      'alertar_dias_antes', e.alertar_dias_antes, 'aplica_a', e.aplica_a,
      'escopo_funcao', e.funcao, 'escopo_setor_id', e.setor_id) ORDER BY e.nome_custom), '[]'::jsonb) INTO v_custom
    FROM public.compliance_documento_exigido e
   WHERE e.company_id=p_company_id AND e.ativo AND e.tipo_documento_id IS NULL AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos');
  RETURN jsonb_build_object('ok', true, 'catalogo', v_cat, 'custom', v_custom);
END $function$;

-- 2) pessoa_docs + MOTIVO/aplica/dispensa (o "por que" da tela)
CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_docs(p_company_id uuid, p_funcionario_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
      'em_escopo', d.em_escopo, 'incluido', d.incluido, 'dispensado', d.dispensado,
      'aplica', ((d.em_escopo OR d.incluido) AND NOT d.dispensado),
      'dispensa', CASE WHEN d.dispensado THEN jsonb_build_object('em', d.disp_em, 'por', d.disp_por) ELSE NULL END,
      'motivo', CASE
        WHEN d.dispensado THEN 'Dispensado' || COALESCE(' em ' || to_char(d.disp_em, 'DD/MM/YYYY'), '') || COALESCE(' por ' || d.disp_por, '')
        WHEN d.incluido THEN 'Marcado manualmente para esta pessoa'
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

-- 3) cargos e setores distintos da empresa (alimenta os seletores de escopo)
CREATE OR REPLACE FUNCTION public.fn_compliance_cargos_setores(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cargos jsonb; v_setores jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(DISTINCT c ORDER BY c), '[]'::jsonb) INTO v_cargos
    FROM (SELECT NULLIF(btrim(cargo),'') AS c FROM public.compliance_funcionarios WHERE company_id=p_company_id AND ativo) q
   WHERE c IS NOT NULL;
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'setor'), '[]'::jsonb) INTO v_setores
    FROM (SELECT DISTINCT jsonb_build_object('setor', setor, 'setor_id', setor_id) AS s
            FROM public.compliance_funcionarios WHERE company_id=p_company_id AND ativo AND setor_id IS NOT NULL) q;
  RETURN jsonb_build_object('ok', true, 'cargos', v_cargos, 'setores', v_setores);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_compliance_cargos_setores(uuid) TO authenticated;
