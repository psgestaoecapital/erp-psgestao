-- 🔴 #90/#82/#18 (Rodrigo/R.R, 16 dias) — a nota não emitia mesmo com a obra apontada.
-- Causa (provada): fn_receber_nfse_dados (chamada pela rota /api/fiscal/nfse/emitir antes do Focus)
-- carregava uma trava "Fase A" legada que (a) exigia CNO ou código de obra municipal e (b) mesmo
-- com a obra completa, BLOQUEAVA toda NFS-e de construção ("Fase B na próxima versão"). A obra 0002
-- da R.R tem endereço completo mas NÃO tem CNO → caía no erro "sem CNO nem código de obra municipal".
-- Mas a Fase B JÁ está implementada no caminho de emissão (#18/#82): o grupo de obra (endereço/CNO)
-- vai no payload ao Focus e o cLocIncid usa o IBGE da obra. A regra correta (E0370) é CNO **OU**
-- endereço — exigir CNO é bug.
--
-- Correção: aceita CNO OU endereço completo (logradouro+CEP+IBGE) e NÃO bloqueia mais — segue para
-- a emissão normalmente (o grupo de obra é montado pela rota + provider Focus).

CREATE OR REPLACE FUNCTION public.fn_receber_nfse_dados(p_receber_id uuid, p_servico_id uuid, p_obra_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r record; v_s record; v_c record; v_doc text; v_tipo text; v_desc text;
  v_exig jsonb; v_ob record; v_tem_cno boolean; v_tem_end boolean;
BEGIN
  SELECT id, company_id, cliente_id, cliente_nome, descricao, valor INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Recebível não encontrado'); END IF;

  SELECT codigo_servico_municipio, codigo_lc116, aliquota_iss, iss_retido, descricao_resumida, descricao_detalhada
    INTO v_s FROM erp_servicos WHERE id = p_servico_id AND company_id = v_r.company_id AND ativo = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Selecione um serviço válido'); END IF;
  IF COALESCE(v_s.codigo_lc116, '') = '' OR COALESCE(v_s.codigo_servico_municipio, '') = '' THEN
    RETURN jsonb_build_object('erro', 'O serviço está sem item LC116 / código municipal — corrija em Cadastros > Serviços'); END IF;

  -- E0370 (Fase B): serviço de construção exige obra com CNO **OU** endereço completo. Qualquer um
  -- basta (nunca os dois). O grupo de obra é enviado no XML pela rota; aqui só validamos e liberamos.
  v_exig := public.fn_nfse_obra_exigencia(v_s.codigo_lc116);
  IF (v_exig->>'exige')::boolean THEN
    IF p_obra_id IS NULL THEN
      RETURN jsonb_build_object('erro',
        'Este serviço exige informação de obra (subitem ' || (v_exig->>'subitem_repr') || '). Selecione ou cadastre a obra do tomador.',
        'exige_obra', true, 'subitens', v_exig->'subitens'); END IF;
    SELECT id, nome, endereco, numero_endereco, bairro, cidade, uf, cep, codigo_ibge_municipio, cno, art, codigo_obra_municipal
      INTO v_ob FROM projetos_obras WHERE id = p_obra_id AND company_id = v_r.company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Obra não encontrada nesta empresa.', 'exige_obra', true); END IF;
    v_tem_cno := COALESCE(v_ob.cno,'') <> '' OR COALESCE(v_ob.codigo_obra_municipal,'') <> '';
    v_tem_end := COALESCE(v_ob.endereco,'') <> '' AND COALESCE(v_ob.cep,'') <> '' AND COALESCE(v_ob.codigo_ibge_municipio,'') <> '';
    IF NOT v_tem_cno AND NOT v_tem_end THEN
      RETURN jsonb_build_object('erro',
        'A obra "' || v_ob.nome || '" precisa de CNO OU endereço completo (logradouro, CEP e código IBGE) — complete na ficha da obra.',
        'exige_obra', true, 'obra_id', v_ob.id); END IF;
    -- obra OK (CNO ou endereço) → NÃO bloqueia: o grupo de obra vai no XML (Fase B). Segue o fluxo.
  END IF;

  SELECT COALESCE(cnpj_cpf, cpf_cnpj) AS doc, email, razao_social INTO v_c FROM erp_clientes WHERE id = v_r.cliente_id;
  v_doc := regexp_replace(COALESCE(v_c.doc, ''), '[^0-9]', '', 'g');
  v_tipo := CASE WHEN length(v_doc) = 11 THEN 'cpf' WHEN length(v_doc) = 14 THEN 'cnpj' ELSE 'indefinido' END;
  IF v_doc = '' THEN
    RETURN jsonb_build_object('erro',
      'O tomador (' || COALESCE(v_r.cliente_nome, 'cliente') || ') está sem CNPJ/CPF — preencha no cadastro do cliente'); END IF;

  v_desc := COALESCE(NULLIF(v_s.descricao_detalhada, ''), v_s.descricao_resumida, v_r.descricao);
  RETURN jsonb_build_object(
    'ok', true, 'receber_id', v_r.id, 'company_id', v_r.company_id, 'valor', v_r.valor,
    'tomador', jsonb_build_object('documento', v_doc, 'tipo', v_tipo, 'nome', COALESCE(v_c.razao_social, v_r.cliente_nome), 'email', v_c.email),
    'servico', jsonb_build_object('descricao', v_desc, 'valor', v_r.valor,
      'codigo_tributacao_nacional_iss', v_s.codigo_servico_municipio, 'aliquota_iss', COALESCE(v_s.aliquota_iss, 0),
      'iss_retido', COALESCE(v_s.iss_retido, false),
      'codigo_servico_municipio', v_s.codigo_servico_municipio, 'codigo_lc116', v_s.codigo_lc116)
  );
END $function$;
