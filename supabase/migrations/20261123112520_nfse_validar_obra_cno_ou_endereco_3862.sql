-- Chamado #3862 (AJUSTE) — NFS-e de obra (07.05 / E0370): a nota deve ser liberada com CNO OU endereço
-- completo da obra. Um dos dois basta; informado um, o outro NÃO pode ser exigido.
--
-- CAUSA (provada em produção 19/11/2026, FC Pisos b202b50f-37cb-462e-accf-126869de49f0, serviço 07.05
-- f212fdb7-0a5e-4052-8f88-d45fdcbc4594): a porta única fn_nfse_validar_emissao só lia o endereço da obra
-- pela tabela projetos_obras via p_dados->>'obra_id'. Quando o usuário digita o endereço no quadro
-- "Serviço de construção civil" SEM vincular uma obra cadastrada (obra_id NULL), a função devolvia
-- 'obra_obrigatoria' (pode_emitir=false) — ignorando o endereço digitado e sem nenhum caminho de CNO.
-- Resultado: o quadro verde dizia "endereço pronto" e o vermelho exigia obra (contradição do print).
--
-- CORREÇÃO (aditiva, CREATE OR REPLACE):
--  1. A função passa a aceitar, em p_dados, o endereço/CNO digitados na própria nota (obra_cno,
--     obra_logradouro, obra_numero, obra_bairro, obra_cep, obra_codigo_ibge) além da obra cadastrada.
--  2. Para o serviço que exige obra, libera quando houver CNO (informado na nota OU da obra cadastrada)
--     OU endereço COMPLETO (idem). Número "sn" (sem número) conta como número preenchido.
--  3. Só bloqueia quando não há nenhum dos dois; a mensagem pede "o CNO OU o endereço".
--  4. O município (IBGE) digitado no quadro também alimenta a resolução do ISS no local da prestação.
-- Nada mais da função muda. SECURITY DEFINER + search_path=public mantidos; só leitura.

CREATE OR REPLACE FUNCTION public.fn_nfse_validar_emissao(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servico record; v_bloqueios jsonb := '[]'::jsonb;
  v_exige_obra jsonb; v_iss jsonb;
  v_obra_id uuid; v_obra_ibge text; v_obra_cno text;
  v_obra_logr text; v_obra_num text; v_obra_bairro text; v_obra_cep text;
  v_ibge text; v_data date := COALESCE((p_dados->>'data_emissao')::date, CURRENT_DATE);
  -- #3862 · valores efetivos (obra cadastrada OU digitados na nota) para a regra "CNO ou endereço".
  v_cno text; v_logr text; v_num text; v_bairro text; v_cep text; v_ibge_obra text;
  v_tem_cno boolean; v_end_completo boolean; v_end_algum boolean;
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
    SELECT id, cno, codigo_ibge_municipio, endereco, numero_endereco, bairro, cep
      INTO v_obra_id, v_obra_cno, v_obra_ibge, v_obra_logr, v_obra_num, v_obra_bairro, v_obra_cep
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
    -- #3862 · fontes do CNO e do endereço: obra cadastrada (obra_id) OU digitados na nota (p_dados).
    -- Basta UM — CNO ou endereço completo. Número "sn" conta como número preenchido.
    v_cno       := COALESCE(NULLIF(btrim(p_dados->>'obra_cno'),''),        NULLIF(btrim(v_obra_cno),''));
    v_logr      := COALESCE(NULLIF(btrim(p_dados->>'obra_logradouro'),''), NULLIF(btrim(v_obra_logr),''));
    v_num       := COALESCE(NULLIF(btrim(p_dados->>'obra_numero'),''),     NULLIF(btrim(v_obra_num),''));
    v_bairro    := COALESCE(NULLIF(btrim(p_dados->>'obra_bairro'),''),     NULLIF(btrim(v_obra_bairro),''));
    v_cep       := COALESCE(NULLIF(btrim(p_dados->>'obra_cep'),''),        NULLIF(btrim(v_obra_cep),''));
    v_ibge_obra := COALESCE(NULLIF(btrim(p_dados->>'obra_codigo_ibge'),''),NULLIF(btrim(v_obra_ibge),''));
    v_tem_cno      := v_cno IS NOT NULL;
    v_end_completo := v_logr IS NOT NULL AND v_num IS NOT NULL AND v_bairro IS NOT NULL
                      AND v_cep IS NOT NULL AND v_ibge_obra IS NOT NULL;
    v_end_algum    := COALESCE(v_logr, v_num, v_bairro, v_cep, v_ibge_obra) IS NOT NULL;

    IF v_tem_cno OR v_end_completo THEN
      NULL; -- obra atendida: CNO ou endereco completo basta
    ELSIF (p_dados->>'obra_id') IS NOT NULL AND v_obra_id IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_nao_encontrada',
        'mensagem','A obra informada nao foi encontrada para esta empresa.',
        'acao','Escolha uma obra valida.', 'onde','faturamento');
    ELSIF v_end_algum THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_endereco_incompleto',
        'mensagem','Complete o endereco da obra (rua, numero, bairro, CEP e municipio) ou informe o CNO.',
        'acao','Complete o endereco da obra ou informe o CNO.', 'onde','cadastro da obra');
    ELSE
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo','obra_obrigatoria',
        'mensagem','O servico ' || COALESCE(v_exige_obra->>'subitem_repr', v_servico.codigo_lc116)
                   || ' exige informacao de obra na nota.',
        'acao','Informe o CNO ou o endereco completo da obra.',
        'onde','faturamento');
    END IF;
  END IF;

  IF COALESCE(v_servico.iss_no_local_prestacao, false) THEN
    -- #3862 · o IBGE da obra pode vir da obra cadastrada OU do municipio digitado no quadro.
    v_ibge := COALESCE(v_obra_ibge, NULLIF(btrim(p_dados->>'obra_codigo_ibge'),''), p_dados->>'municipio_prestacao_ibge');
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

REVOKE ALL ON FUNCTION public.fn_nfse_validar_emissao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_validar_emissao(uuid, jsonb) TO authenticated, service_role;
