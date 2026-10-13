-- Fiscal · NFS-e de obra: CNO OPCIONAL, endereço da obra é o que a prefeitura exige (E0370).
--
-- O Eng. Chefe conferiu em produção: a NFS-e 56 da R.R foi AUTORIZADA em 18/09 com o endereço da obra e
-- SEM CNO — a prefeitura aceita endereço. Mas fn_nfse_validar_emissao barrava com 'obra_sem_cno', deixando
-- o cliente travado mesmo com a obra apontada (a obra da R.R não tem CNO). Aqui a porta única passa a
-- exigir o ENDEREÇO COMPLETO da obra (rua, número, bairro, CEP e município/IBGE) em vez do CNO. O CNO,
-- quando existir, continua indo na nota (a emissão já lê da obra); quando não existir, a nota segue pelo
-- endereço. Genérico para qualquer município; se algum município exigir CNO, isso vira configuração por
-- município num passo futuro. Demais validações preservadas.

CREATE OR REPLACE FUNCTION public.fn_nfse_validar_emissao(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servico record; v_bloqueios jsonb := '[]'::jsonb;
  v_exige_obra jsonb; v_iss jsonb;
  v_obra_id uuid; v_obra_ibge text;
  v_obra_logr text; v_obra_num text; v_obra_bairro text; v_obra_cep text;
  v_ibge text; v_data date := COALESCE((p_dados->>'data_emissao')::date, CURRENT_DATE);
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_servico FROM erp_servicos
   WHERE id = (p_dados->>'servico_id')::uuid AND company_id = p_company_id;
  IF v_servico.id IS NULL THEN
    RETURN jsonb_build_object('pode_emitir', false, 'bloqueios',
      jsonb_build_array(jsonb_build_object(
        'codigo','servico_nao_encontrado',
        'mensagem','Servico nao encontrado para esta empresa.')));
  END IF;

  IF (p_dados->>'obra_id') IS NOT NULL THEN
    SELECT id, codigo_ibge_municipio, endereco, numero_endereco, bairro, cep
      INTO v_obra_id, v_obra_ibge, v_obra_logr, v_obra_num, v_obra_bairro, v_obra_cep
      FROM projetos_obras
     WHERE id = (p_dados->>'obra_id')::uuid AND company_id = p_company_id;
  END IF;

  IF COALESCE(btrim(v_servico.codigo_lc116),'') = '' THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo','servico_sem_lc116',
      'mensagem','O servico nao tem o codigo da LC 116 cadastrado.',
      'acao','Cadastre o codigo no servico antes de emitir.',
      'onde','cadastro do servico');
  END IF;

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
    -- CNO opcional (a prefeitura aceita o endereco). O que o E0370 exige de fato é o endereco completo
    -- da obra: logradouro, numero, bairro, CEP e municipio (IBGE).
    ELSIF COALESCE(btrim(v_obra_logr),'') = ''
       OR COALESCE(btrim(v_obra_num),'')   = ''
       OR COALESCE(btrim(v_obra_bairro),'')= ''
       OR COALESCE(btrim(v_obra_cep),'')   = ''
       OR COALESCE(btrim(v_obra_ibge),'')  = '' THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_endereco_incompleto',
        'mensagem','Complete o endereco da obra (rua, numero, bairro, CEP e municipio).',
        'acao','Complete o endereco da obra.', 'onde','cadastro da obra');
    END IF;
  END IF;

  IF COALESCE(v_servico.iss_no_local_prestacao, false) THEN
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
