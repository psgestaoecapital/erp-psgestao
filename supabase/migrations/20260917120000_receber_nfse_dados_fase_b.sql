-- 🔴 #90/#82/#18 (Rodrigo/R.R, 16 dias) — a nota não emitia mesmo com a obra apontada.
--
-- Causa (provada, RD-38): a rota /api/fiscal/nfse/emitir chama fn_receber_nfse_dados antes do
-- Focus (o NFSePreviewModal sempre manda servicoId). Essa função carregava uma SEGUNDA validação
-- de obra — a trava "Fase A" legada — que exigia CNO/código municipal e IGNORAVA o endereço:
--     IF cno='' AND codigo_obra_municipal='' THEN erro "sem CNO nem código de obra municipal…"
-- A obra 0002 da R.R tem endereço completo (Rua Marques do Herval 3249, São Miguel do Oeste/SC,
-- IBGE 4217204) mas NÃO tem CNO → caía nessa trava. É contra a regra E0370 (CNO **OU** endereço).
--
-- Duas validações para a mesma regra: fn_nfse_obra_pendente já está correta e provada (aceita CNO
-- OU endereço, com guard IBGE↔UF e a mensagem certa "informe o CNO ou o endereço completo"), mas
-- fn_receber_nfse_dados mantinha a sua própria cópia — que ficou velha. É o mesmo padrão dos 3 CRMs
-- e dos 2 modelos de estoque: quando há duas regras, uma envelhece.
--
-- Correção: APAGA a validação duplicada e DELEGA a fn_nfse_obra_pendente (fonte única). Assim a
-- regra da emissão passa a ser exatamente a mesma da tela, provada, para sempre. O grupo de obra
-- continua sendo montado no payload pela rota + provider Focus (Fase B, entregue no #18/#82).
--
-- Provado no dado: fn_nfse_obra_pendente(R.R, '070202', obra 0002, NULL, NULL)
--   → exige_obra=true, pendente=false, mensagem=null  (deixa passar — endereço basta).
-- (Obs.: o registro de "exige obra" para o código municipal vive em
--  erp_fiscal_servico_obra_obrigatoria — ex.: 070202 —, que é o que fn_nfse_obra_pendente usa.)

CREATE OR REPLACE FUNCTION public.fn_receber_nfse_dados(p_receber_id uuid, p_servico_id uuid, p_obra_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r record; v_s record; v_c record; v_doc text; v_tipo text; v_desc text;
  v_exig jsonb; v_pend jsonb; v_exige_obra boolean;
BEGIN
  SELECT id, company_id, cliente_id, cliente_nome, descricao, valor INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Recebível não encontrado'); END IF;

  SELECT codigo_servico_municipio, codigo_lc116, aliquota_iss, iss_retido, descricao_resumida, descricao_detalhada
    INTO v_s FROM erp_servicos WHERE id = p_servico_id AND company_id = v_r.company_id AND ativo = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Selecione um serviço válido'); END IF;
  IF COALESCE(v_s.codigo_lc116, '') = '' OR COALESCE(v_s.codigo_servico_municipio, '') = '' THEN
    RETURN jsonb_build_object('erro', 'O serviço está sem item LC116 / código municipal — corrija em Cadastros > Serviços'); END IF;

  -- E0370 (Fase B): serviço de construção exige obra com CNO **OU** endereço completo (nunca os dois).
  -- REGRA ÚNICA: fn_nfse_obra_pendente (a mesma da tela). Aqui só perguntamos e liberamos; o grupo
  -- de obra vai no XML pela rota. (fn_nfse_obra_exigencia é usada só p/ o rótulo do subitem quando
  -- falta apontar a obra — paridade com o seletor do modal, que lê os subitens do LC116.)
  v_exig := public.fn_nfse_obra_exigencia(v_s.codigo_lc116);
  v_pend := public.fn_nfse_obra_pendente(v_r.company_id, v_s.codigo_servico_municipio, p_obra_id, NULL, NULL);
  v_exige_obra := COALESCE((v_exig->>'exige')::boolean, false)
               OR COALESCE((v_pend->>'exige_obra')::boolean, false);

  IF v_exige_obra THEN
    IF p_obra_id IS NULL THEN
      RETURN jsonb_build_object('erro',
        'Este serviço exige informação de obra (subitem ' || COALESCE(v_exig->>'subitem_repr', v_s.codigo_lc116) || '). Selecione ou cadastre a obra do tomador.',
        'exige_obra', true, 'subitens', COALESCE(v_exig->'subitens', '[]'::jsonb)); END IF;
    -- verdito de completude vem SÓ da fn_nfse_obra_pendente (CNO OU endereço, guard IBGE↔UF).
    IF COALESCE((v_pend->>'pendente')::boolean, false) THEN
      RETURN jsonb_build_object('erro',
        COALESCE(v_pend->>'mensagem',
          'A obra precisa de CNO OU endereço completo (logradouro, número, município/IBGE, UF e CEP) — complete na ficha da obra.'),
        'exige_obra', true, 'obra_id', p_obra_id); END IF;
    -- obra OK (CNO ou endereço) → NÃO bloqueia: segue o fluxo normal.
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
