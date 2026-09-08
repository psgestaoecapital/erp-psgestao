-- ============================================================
-- #32 fase 2 · uma porta so para validar emissao de NFS-e
-- Duas travas do MESMO momento (a emissao) por UMA porta: a de obra (LC116 que exige obra/CNO,
-- ja existente em fn_nfse_obra_exigencia) e a de ISS no local da prestacao (fn_fiscal_iss_resolver,
-- fase 1). Se ficarem separadas, a nota passa por uma e escapa pela outra. RD-26: reusa as duas
-- funcoes, nao reimplementa a logica delas.
-- NOTA (RD-38): o SPEC literal lia v_obra (record) incondicionalmente na trava de ISS, mas so o
-- atribuia dentro do IF de obra — um record nao-atribuido lanca "is not assigned yet" quando o
-- servico e iss_no_local=true sem obra (ou sem exigencia de obra). Trocado por variaveis escalares
-- carregadas UMA vez (mesma logica, mesmos bloqueios) + escopo de company_id na obra.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_nfse_validar_emissao(
  p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_servico record; v_bloqueios jsonb := '[]'::jsonb;
  v_exige_obra jsonb; v_iss jsonb;
  v_obra_id uuid; v_obra_cno text; v_obra_ibge text;
  v_ibge text; v_data date := COALESCE((p_dados->>'data_emissao')::date, CURRENT_DATE);
BEGIN
  SELECT * INTO v_servico FROM erp_servicos
   WHERE id = (p_dados->>'servico_id')::uuid AND company_id = p_company_id;
  IF v_servico.id IS NULL THEN
    RETURN jsonb_build_object('pode_emitir', false, 'bloqueios',
      jsonb_build_array(jsonb_build_object(
        'codigo','servico_nao_encontrado',
        'mensagem','Servico nao encontrado para esta empresa.')));
  END IF;

  -- carrega a obra UMA vez (se veio na nota), da propria empresa — assim os v_obra_* ficam
  -- sempre definidos (NULL quando nao ha obra), sem depender do fluxo abaixo.
  IF (p_dados->>'obra_id') IS NOT NULL THEN
    SELECT id, cno, codigo_ibge_municipio INTO v_obra_id, v_obra_cno, v_obra_ibge
      FROM projetos_obras
     WHERE id = (p_dados->>'obra_id')::uuid AND company_id = p_company_id;
  END IF;

  -- 2.1 o servico tem LC116? sem isso nada mais e verificavel
  IF COALESCE(btrim(v_servico.codigo_lc116),'') = '' THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo','servico_sem_lc116',
      'mensagem','O servico nao tem o codigo da LC 116 cadastrado.',
      'acao','Cadastre o codigo no servico antes de emitir.',
      'onde','cadastro do servico');
  END IF;

  -- 2.2 TRAVA DE OBRA (ja existe: reusa fn_nfse_obra_exigencia)
  v_exige_obra := public.fn_nfse_obra_exigencia(v_servico.codigo_lc116);
  IF COALESCE((v_exige_obra->>'exige')::boolean, false) THEN
    IF (p_dados->>'obra_id') IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_obrigatoria',
        'mensagem','O servico ' || COALESCE(v_exige_obra->>'subitem_repr', v_servico.codigo_lc116)
                   || ' exige informacao de obra na nota.',
        'acao','Vincule a nota a uma obra.',
        'onde','faturamento');
    ELSIF v_obra_id IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_nao_encontrada',
        'mensagem','A obra informada nao foi encontrada para esta empresa.',
        'acao','Escolha uma obra valida.', 'onde','faturamento');
    ELSIF COALESCE(btrim(v_obra_cno),'') = '' THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_sem_cno',
        'mensagem','A obra nao tem CNO cadastrado.',
        'acao','Informe o CNO na obra.', 'onde','cadastro da obra');
    END IF;
  END IF;

  -- 2.3 TRAVA DE ISS (nova)
  IF COALESCE(v_servico.iss_no_local_prestacao, false) THEN
    -- o municipio vem da obra quando houver; senao, do que o usuario escolheu
    v_ibge := COALESCE(v_obra_ibge, p_dados->>'municipio_prestacao_ibge');
    IF COALESCE(btrim(v_ibge),'') = '' THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','municipio_prestacao_ausente',
        'mensagem','Este servico tem ISS devido no municipio da execucao.',
        'acao','Informe onde o servico foi prestado.', 'onde','faturamento');
    ELSE
      v_iss := public.fn_fiscal_iss_resolver(
        p_company_id, v_ibge, v_servico.codigo_lc116, v_data);
      IF NOT COALESCE((v_iss->>'ok')::boolean, false) THEN
        v_bloqueios := v_bloqueios || jsonb_build_object(
          'codigo','aliquota_iss_desconhecida',
          'mensagem','A aliquota de ISS de ' || COALESCE(v_iss->>'municipio', v_ibge)
                     || ' para o servico ' || v_servico.codigo_lc116 || ' nao esta cadastrada.',
          'acao','Cadastre a aliquota ou consulte o contador.',
          'onde','configuracoes/fiscal/iss-municipios',
          'municipio_ibge', v_ibge, 'codigo_lc116', v_servico.codigo_lc116);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pode_emitir', jsonb_array_length(v_bloqueios) = 0,
    'bloqueios', v_bloqueios,
    'iss', v_iss,
    'municipio_prestacao_ibge', v_ibge,
    'exige_obra', COALESCE((v_exige_obra->>'exige')::boolean, false));
END $function$;
