-- ============================================================
-- Subir o XML da nota por upload, sem esperar o SEFAZ.
-- Dor: nota em aguardando_xml; a SEFAZ leva ate 2h, mas o fornecedor ja mandou o arquivo.
--
-- RD-26: o upload NAO cria caminho novo de gravacao. Parseia com fn_xml_txt/num/has (parser
-- de XML ja existente no banco) e chama a MESMA fn_nfe_recebida_aplicar_xml que o SEFAZ aciona
-- (mesmo formato de p_dados: emitente/ide/totais/itens/duplicatas/manifestacao).
--
-- Aceitar XML de arquivo e aceitar dado que NAO veio do fisco -> 5 travas obrigatorias:
--   1. CNPJ do destinatario no XML = CNPJ da empresa. Nao bateu, recusa.
--   2. Chave valida: 44 digitos + digito verificador (modulo 11).
--   3. Se a nota ja existe, a chave tem que ser a mesma (garantido: achamos a nota PELA chave
--      do proprio XML - nunca gravamos XML da nota X sobre a Y).
--   4. Nao sobrescrever XML do SEFAZ sem aceite explicito (grava quem/quando).
--   5. Valor total confere com o resumo; divergiu, avisa com os dois numeros e exige aceite
--      (nao bloqueia - pode ser ajuste legitimo).
-- ============================================================

-- Procedencia gravada
ALTER TABLE public.erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS xml_origem text,
  ADD COLUMN IF NOT EXISTS xml_enviado_por uuid,
  ADD COLUMN IF NOT EXISTS xml_enviado_em timestamptz;

COMMENT ON COLUMN public.erp_nfe_recebidas.xml_origem IS
  'sefaz = distribuicao DF-e (fonte fiscal). upload = enviado por arquivo.';

-- ------------------------------------------------------------
-- Digito verificador da chave de acesso (modulo 11, pesos 2..9 da direita p/ esquerda)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_chave_dv_ok(p_chave text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  c text := regexp_replace(coalesce(p_chave,''),'\D','','g');
  soma int := 0; peso int := 2; i int; dv int;
BEGIN
  IF length(c) <> 44 THEN RETURN false; END IF;
  -- percorre os 43 primeiros digitos, da direita p/ esquerda
  FOR i IN REVERSE 43..1 LOOP
    soma := soma + substr(c, i, 1)::int * peso;
    peso := CASE WHEN peso = 9 THEN 2 ELSE peso + 1 END;
  END LOOP;
  dv := 11 - (soma % 11);
  IF dv >= 10 THEN dv := 0; END IF;   -- resto 0 ou 1 -> dv = 0
  RETURN dv = substr(c, 44, 1)::int;
END $function$;

-- ------------------------------------------------------------
-- Upload do XML: valida, parseia e aplica pela MESMA fn_nfe_recebida_aplicar_xml.
-- Casos: A = nota ja existe em aguardando_xml (completa na hora);
--        B = nota ainda nao apareceu (o upload CRIA a nota).
-- Aceites: p_aceite_sobrescrever (trava 4), p_aceite_divergencia (trava 5).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_upload_xml(
  p_company_id uuid,
  p_xml text,
  p_aceite_sobrescrever boolean DEFAULT false,
  p_aceite_divergencia  boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ns CONSTANT text[] := ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']];
  v_uid  uuid := auth.uid();
  x      xml;
  v_emp_cnpj  text;
  v_dest_cnpj text;
  v_chave     text;
  v_emit_cnpj text; v_emit_razao text; v_emit_ie text; v_emit_uf text;
  v_numero text; v_serie text; v_modelo text; v_natop text; v_demi text;
  v_vnf numeric; v_vprod numeric;
  v_nota erp_nfe_recebidas%ROWTYPE;
  v_existe boolean := false;
  v_id uuid;
  v_forn_id uuid;
  v_itens jsonb;
  v_dups  jsonb;
  v_dados jsonb;
  r jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- parse (tolera BOM/espaco a esquerda)
  BEGIN
    x := regexp_replace(coalesce(p_xml,''), '^﻿', '')::xml;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'xml_invalido');
  END;

  v_emp_cnpj  := (SELECT regexp_replace(coalesce(cnpj,''),'\D','','g') FROM companies WHERE id = p_company_id);
  v_dest_cnpj := regexp_replace(coalesce(fn_xml_txt(x,'//n:dest/n:CNPJ'),''),'\D','','g');
  v_chave     := regexp_replace(coalesce(
                   fn_xml_txt(x,'//n:protNFe/n:infProt/n:chNFe'),
                   (xpath('//n:infNFe/@Id', x, ns))[1]::text
                 ,''),'\D','','g');

  -- TRAVA 2 · chave 44 digitos + DV
  IF length(v_chave) <> 44 OR NOT fn_nfe_chave_dv_ok(v_chave) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chave_invalida', 'chave', v_chave); END IF;

  -- TRAVA 1 · destinatario tem que ser a empresa
  IF v_emp_cnpj IS NULL OR v_emp_cnpj = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_sem_cnpj'); END IF;
  IF v_dest_cnpj IS DISTINCT FROM v_emp_cnpj THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cnpj_destinatario_diverge',
      'cnpj_no_xml', v_dest_cnpj, 'cnpj_empresa', v_emp_cnpj); END IF;

  -- extrai cabecalho
  v_emit_cnpj  := regexp_replace(coalesce(fn_xml_txt(x,'//n:emit/n:CNPJ'),''),'\D','','g');
  v_emit_razao := fn_xml_txt(x,'//n:emit/n:xNome');
  v_emit_ie    := fn_xml_txt(x,'//n:emit/n:IE');
  v_emit_uf    := fn_xml_txt(x,'//n:emit/n:enderEmit/n:UF');
  v_numero     := fn_xml_txt(x,'//n:ide/n:nNF');
  v_serie      := fn_xml_txt(x,'//n:ide/n:serie');
  v_modelo     := fn_xml_txt(x,'//n:ide/n:mod');
  v_natop      := fn_xml_txt(x,'//n:ide/n:natOp');
  v_demi       := coalesce(fn_xml_txt(x,'//n:ide/n:dhEmi'), fn_xml_txt(x,'//n:ide/n:dEmi'));
  v_vnf        := fn_xml_num(x,'//n:total/n:ICMSTot/n:vNF');
  v_vprod      := fn_xml_num(x,'//n:total/n:ICMSTot/n:vProd');

  -- itens (mesma forma que a edge monta p/ aplicar_xml)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero_item',    COALESCE((xpath('@nItem', det, ns))[1]::text, ord::text),
           'codigo_produto', (xpath('n:prod/n:cProd/text()',  det, ns))[1]::text,
           'descricao',      (xpath('n:prod/n:xProd/text()',  det, ns))[1]::text,
           'ncm',            (xpath('n:prod/n:NCM/text()',    det, ns))[1]::text,
           'cfop',           (xpath('n:prod/n:CFOP/text()',   det, ns))[1]::text,
           'unidade',        (xpath('n:prod/n:uCom/text()',   det, ns))[1]::text,
           'quantidade',     NULLIF((xpath('n:prod/n:qCom/text()',   det, ns))[1]::text,'')::numeric,
           'valor_unitario', NULLIF((xpath('n:prod/n:vUnCom/text()', det, ns))[1]::text,'')::numeric,
           'valor_total',    NULLIF((xpath('n:prod/n:vProd/text()',  det, ns))[1]::text,'')::numeric
         ) ORDER BY ord), '[]'::jsonb)
    INTO v_itens
    FROM unnest(xpath('//n:det', x, ns)) WITH ORDINALITY AS t(det, ord);

  -- duplicatas
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero_dup',      (xpath('n:nDup/text()',  dup, ns))[1]::text,
           'data_vencimento', (xpath('n:dVenc/text()', dup, ns))[1]::text,
           'valor',           NULLIF((xpath('n:vDup/text()', dup, ns))[1]::text,'')::numeric
         )), '[]'::jsonb)
    INTO v_dups
    FROM unnest(xpath('//n:cobr/n:dup', x, ns)) AS d(dup);

  -- localiza a nota PELA chave do proprio XML (garante trava 3)
  SELECT * INTO v_nota FROM erp_nfe_recebidas
   WHERE company_id = p_company_id
     AND regexp_replace(chave_acesso,'\D','','g') = v_chave;
  v_existe := FOUND;

  IF v_existe THEN
    -- CASO A · nota ja na lista
    -- TRAVA 4 · nao sobrescrever XML do SEFAZ sem aceite
    IF coalesce(v_nota.xml_origem,'') <> 'upload' AND v_nota.xml_raw IS NOT NULL THEN
      IF NOT p_aceite_sobrescrever THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'requer_aceite',
          'motivo', 'sobrescrever_sefaz',
          'xml_atual_origem', coalesce(v_nota.xml_origem,'sefaz')); END IF;
    END IF;
    -- TRAVA 5 · valor confere com o resumo
    IF v_nota.valor_total IS NOT NULL AND v_vnf IS NOT NULL
       AND abs(v_nota.valor_total - v_vnf) > 0.01 THEN
      IF NOT p_aceite_divergencia THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'requer_aceite',
          'motivo', 'divergencia_valor',
          'valor_resumo', v_nota.valor_total, 'valor_xml', v_vnf); END IF;
    END IF;
    v_id := v_nota.id;
  ELSE
    -- CASO B · o upload CRIA a nota
    SELECT id INTO v_forn_id FROM erp_fornecedores
     WHERE company_id = p_company_id
       AND regexp_replace(coalesce(cnpj_cpf, cpf_cnpj, ''),'\D','','g') = v_emit_cnpj
     LIMIT 1;
    INSERT INTO erp_nfe_recebidas (
      company_id, chave_acesso, modelo, status, status_manifestacao,
      origem, fornecedor_id, data_emissao, emitente_uf, created_by
    ) VALUES (
      p_company_id, v_chave, coalesce(v_modelo,'55'), 'aguardando_xml', 'pendente',
      'upload', v_forn_id, NULLIF(v_demi,'')::timestamptz, NULLIF(v_emit_uf,''), v_uid
    ) RETURNING id INTO v_id;
  END IF;

  -- monta p_dados no MESMO formato do SEFAZ e aplica pela MESMA funcao
  v_dados := jsonb_build_object(
    'emitente',   jsonb_build_object('cnpj', NULLIF(v_emit_cnpj,''), 'razao', v_emit_razao, 'ie', v_emit_ie),
    'ide',        jsonb_build_object('numero', v_numero, 'serie', v_serie, 'modelo', v_modelo,
                                     'natureza_operacao', v_natop),
    'totais',     jsonb_build_object('valor_total', v_vnf, 'valor_produtos', v_vprod),
    'itens',      v_itens,
    'duplicatas', v_dups,
    'manifestacao', COALESCE(v_nota.status_manifestacao, 'ciencia')
  );

  r := fn_nfe_recebida_aplicar_xml(v_id, p_xml, v_dados);
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aplicar_xml_falhou', 'detalhe', r); END IF;

  -- procedencia + campos que a aplicar_xml nao grava (data_emissao, uf, fornecedor)
  UPDATE erp_nfe_recebidas SET
    xml_origem      = 'upload',
    xml_enviado_por = v_uid,
    xml_enviado_em  = now(),
    data_emissao    = COALESCE(NULLIF(v_demi,'')::timestamptz, data_emissao),
    emitente_uf     = COALESCE(NULLIF(v_emit_uf,''), emitente_uf),
    fornecedor_id   = COALESCE(fornecedor_id, v_forn_id)
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'caso', CASE WHEN v_existe THEN 'A' ELSE 'B' END,
    'criada', NOT v_existe,
    'chave', v_chave,
    'itens', r->'itens',
    'duplicatas', r->'duplicatas',
    'valor_total', v_vnf
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebida_upload_xml(uuid, text, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_upload_xml(uuid, text, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nfe_chave_dv_ok(text) TO authenticated, service_role;
