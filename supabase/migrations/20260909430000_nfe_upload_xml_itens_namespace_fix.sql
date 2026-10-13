-- ============================================================
-- NF-e recebida · UPLOAD de XML — corrige itens/duplicatas vindo VAZIOS (chamado #41 KGF)
-- Sintoma (Gean): ao subir o XML (fluxo do #1314), o item entrava sem nome, quantidade, NCM, nada.
--
-- Causa raiz (RD-38, reproduzido na nota SCHERER 6389626f ja no banco): o parse fazia
--   unnest(xpath('//n:det', x, ns))  +  xpath('n:prod/n:cProd/text()', det, ns)
-- ou seja, xpath RELATIVO sobre o fragmento <det> extraido. No PostgreSQL o fragmento extraido
-- PERDE o binding de namespace, entao todo path com prefixo n: casa NADA -> todos os campos NULL
-- (so o @nItem, atributo sem prefixo, as vezes vinha; e caia no fallback ord). Provado:
--   relativo-no-fragmento -> null em cProd/xProd/NCM/qCom
--   absoluto por posicao  -> cProd '148483-0', xProd 'WEGA WKU500 - KIT FILTROS...', NCM '84212300', qCom 1.0000
--
-- Fix: parse por xpath ABSOLUTO indexado (//n:det[i]/n:prod/...) via generate_series 1..N, que
-- preserva o namespace. Mesmo bug/mesmo fix nas duplicatas (//n:cobr/n:dup[i]/...). Resto identico.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_upload_xml(p_company_id uuid, p_xml text, p_aceite_sobrescrever boolean DEFAULT false, p_aceite_divergencia boolean DEFAULT false)
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

  -- itens · FIX #41: xpath ABSOLUTO por posicao (//n:det[i]/...) preserva o namespace.
  -- O unnest+relativo do #1314 perdia o namespace e trazia tudo NULL.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero_item',    COALESCE((xpath('//n:det['||i||']/@nItem', x, ns))[1]::text, i::text),
           'codigo_produto', (xpath('//n:det['||i||']/n:prod/n:cProd/text()',  x, ns))[1]::text,
           'descricao',      (xpath('//n:det['||i||']/n:prod/n:xProd/text()',  x, ns))[1]::text,
           'ncm',            (xpath('//n:det['||i||']/n:prod/n:NCM/text()',    x, ns))[1]::text,
           'cfop',           (xpath('//n:det['||i||']/n:prod/n:CFOP/text()',   x, ns))[1]::text,
           'unidade',        (xpath('//n:det['||i||']/n:prod/n:uCom/text()',   x, ns))[1]::text,
           'quantidade',     NULLIF((xpath('//n:det['||i||']/n:prod/n:qCom/text()',   x, ns))[1]::text,'')::numeric,
           'valor_unitario', NULLIF((xpath('//n:det['||i||']/n:prod/n:vUnCom/text()', x, ns))[1]::text,'')::numeric,
           'valor_total',    NULLIF((xpath('//n:det['||i||']/n:prod/n:vProd/text()',  x, ns))[1]::text,'')::numeric
         ) ORDER BY i), '[]'::jsonb)
    INTO v_itens
    FROM generate_series(1, COALESCE(array_length(xpath('//n:det', x, ns), 1), 0)) AS i;

  -- duplicatas · mesmo fix (absoluto por posicao)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero_dup',      (xpath('//n:cobr/n:dup['||i||']/n:nDup/text()',  x, ns))[1]::text,
           'data_vencimento', (xpath('//n:cobr/n:dup['||i||']/n:dVenc/text()', x, ns))[1]::text,
           'valor',           NULLIF((xpath('//n:cobr/n:dup['||i||']/n:vDup/text()', x, ns))[1]::text,'')::numeric
         ) ORDER BY i), '[]'::jsonb)
    INTO v_dups
    FROM generate_series(1, COALESCE(array_length(xpath('//n:cobr/n:dup', x, ns), 1), 0)) AS i;

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
