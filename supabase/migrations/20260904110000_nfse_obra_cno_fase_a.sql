-- Chamado #18 · E0370 (obra e CNO na NFS-e) — FASE A: captura + trava (não emite ainda).
--
-- O Fisco rejeita (E0370) NFS-e de construção civil sem o "grupo de informações de obra". Todo serviço
-- de construção cai nos 13 subitens da mensagem. A H3 do CEO: a NOTA aponta para a OBRA (endereço/CNO
-- vêm da obra, sem digitar). Fase A junta o dado e BLOQUEIA antes de enviar (não queima numeração);
-- Fase B leva o grupo de obra ao XML (Focus construcao_civil) e aí autoriza.
--
-- Regra de casamento (RD-38): o serviço da R.R tem codigo_lc116 '07.02' (2 níveis) e o Fisco lista
-- subitens de 3 níveis (07.02.01…). Igualdade nunca casaria. Casa por PREFIXO, e GUARDA o subitem que
-- casou — se um dia o serviço cadastrar '07.02.01' direto, o casamento fica exato e a mensagem melhora.

-- 1 · A obra ganha os campos fiscais (endereço já existe; CEP e IBGE são exigidos pelo leiaute nacional).
ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS cno text,
  ADD COLUMN IF NOT EXISTS art text,
  ADD COLUMN IF NOT EXISTS codigo_obra_municipal text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS numero_endereco text,
  ADD COLUMN IF NOT EXISTS codigo_ibge_municipio text;

-- 2 · A nota APONTA para a obra (não copia endereço — o dado vive na obra, corrigir a obra corrige a próxima nota).
ALTER TABLE public.erp_nfse_emitidas
  ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.projetos_obras(id);

-- 3 · Quais subitens exigem obra — TABELA, não lista em código (o Fisco muda; lista em código exige deploy).
CREATE TABLE IF NOT EXISTS public.fiscal_lc116_exige_obra (
  subitem text PRIMARY KEY,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.fiscal_lc116_exige_obra FROM PUBLIC;
GRANT SELECT ON public.fiscal_lc116_exige_obra TO authenticated, service_role;
INSERT INTO public.fiscal_lc116_exige_obra (subitem, descricao) VALUES
  ('07.02.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.02.02','Construção civil — exige grupo de obra (E0370)'),
  ('07.04.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.05.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.05.02','Construção civil — exige grupo de obra (E0370)'),
  ('07.06.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.06.02','Construção civil — exige grupo de obra (E0370)'),
  ('07.07.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.08.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.17.01','Construção civil — exige grupo de obra (E0370)'),
  ('07.19.01','Construção civil — exige grupo de obra (E0370)'),
  ('14.14.03','Construção civil — exige grupo de obra (E0370)'),
  ('14.14.04','Construção civil — exige grupo de obra (E0370)')
ON CONFLICT (subitem) DO NOTHING;

-- 4 · A exigência: casa por prefixo e devolve os subitens que casaram.
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_exigencia(p_codigo_lc116 text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lc text; v_sub text[]; BEGIN
  v_lc := btrim(COALESCE(p_codigo_lc116, ''));
  IF v_lc = '' THEN RETURN jsonb_build_object('exige', false); END IF;
  SELECT array_agg(subitem ORDER BY subitem) INTO v_sub
    FROM fiscal_lc116_exige_obra
   WHERE ativo AND (subitem = v_lc OR subitem LIKE v_lc || '.%');
  RETURN jsonb_build_object(
    'exige', v_sub IS NOT NULL,
    'subitens', COALESCE(to_jsonb(v_sub), '[]'::jsonb),
    'subitem_repr', CASE
        WHEN v_sub IS NULL THEN NULL
        WHEN array_length(v_sub,1) = 1 THEN v_sub[1]
        ELSE v_lc || ' (subitens ' || array_to_string(v_sub, ', ') || ')' END
  );
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_exigencia(text) TO authenticated;

-- 5 · fn_receber_nfse_dados ganha a obra + a TRAVA. Como muda a assinatura (3º arg), dropa a antiga
--     de 2 args para não deixar overload ambíguo; o novo p_obra_id tem default (chamadas antigas seguem).
DROP FUNCTION IF EXISTS public.fn_receber_nfse_dados(uuid, uuid);
CREATE OR REPLACE FUNCTION public.fn_receber_nfse_dados(p_receber_id uuid, p_servico_id uuid, p_obra_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_r record; v_s record; v_c record; v_doc text; v_tipo text; v_desc text;
  v_exig jsonb; v_ob record; v_falta_end boolean;
BEGIN
  SELECT id, company_id, cliente_id, cliente_nome, descricao, valor INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Recebível não encontrado'); END IF;

  SELECT codigo_servico_municipio, codigo_lc116, aliquota_iss, iss_retido, descricao_resumida, descricao_detalhada
    INTO v_s FROM erp_servicos WHERE id = p_servico_id AND company_id = v_r.company_id AND ativo = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Selecione um serviço válido'); END IF;
  IF COALESCE(v_s.codigo_lc116, '') = '' OR COALESCE(v_s.codigo_servico_municipio, '') = '' THEN
    RETURN jsonb_build_object('erro', 'O serviço está sem item LC116 / código municipal — corrija em Cadastros > Serviços'); END IF;

  -- TRAVA E0370 (Fase A): serviço de construção exige obra. Em Fase A o XML ainda não leva o grupo,
  -- então BLOQUEIA antes de enviar (não queima numeração). A mensagem escala pela completude.
  v_exig := public.fn_nfse_obra_exigencia(v_s.codigo_lc116);
  IF (v_exig->>'exige')::boolean THEN
    IF p_obra_id IS NULL THEN
      RETURN jsonb_build_object('erro',
        'Este serviço exige informação de obra (subitem ' || (v_exig->>'subitem_repr') || '). Selecione ou cadastre a obra do tomador.',
        'exige_obra', true, 'subitens', v_exig->'subitens'); END IF;
    SELECT id, nome, endereco, numero_endereco, bairro, cidade, uf, cep, codigo_ibge_municipio, cno, art, codigo_obra_municipal
      INTO v_ob FROM projetos_obras WHERE id = p_obra_id AND company_id = v_r.company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Obra não encontrada nesta empresa.', 'exige_obra', true); END IF;
    IF COALESCE(v_ob.cno,'') = '' AND COALESCE(v_ob.codigo_obra_municipal,'') = '' THEN
      RETURN jsonb_build_object('erro',
        'A obra "' || v_ob.nome || '" está sem CNO nem código de obra municipal — complete na ficha da obra.',
        'exige_obra', true, 'obra_id', v_ob.id); END IF;
    v_falta_end := COALESCE(v_ob.endereco,'')='' OR COALESCE(v_ob.cep,'')='' OR COALESCE(v_ob.codigo_ibge_municipio,'')='';
    IF v_falta_end THEN
      RETURN jsonb_build_object('erro',
        'A obra "' || v_ob.nome || '" está sem endereço completo (logradouro/CEP/código IBGE) — complete na ficha da obra.',
        'exige_obra', true, 'obra_id', v_ob.id); END IF;
    -- obra completa: em Fase A ainda não há como levar o grupo ao XML → não emite (evita rejeição).
    RETURN jsonb_build_object('erro',
      'Obra "' || v_ob.nome || '" pronta (CNO + endereço). A emissão da NFS-e de construção com o grupo de obra entra na próxima versão (Fase B) — por ora não é enviada para não queimar numeração.',
      'exige_obra', true, 'obra_pronta', true, 'obra_id', v_ob.id);
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
GRANT EXECUTE ON FUNCTION public.fn_receber_nfse_dados(uuid, uuid, uuid) TO authenticated, service_role;
