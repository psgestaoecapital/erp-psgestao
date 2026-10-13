-- SPEC NFE-F1 · a corrente do custo. O PS passa a saber quanto a peça custou de verdade.
-- Auditado (RD-38) na KGF (simples_nacional): xml_raw namespace portalfiscal; ICMS com filho de nome
-- variável (ICMS00/ICMS40/ICMSSN102) → `<orig>`/`<CST|CSOSN>` DENTRO do grupo (não em prod/orig, como
-- a SPEC supôs — RD-44/45). CEST em prod. PIS/COFINS CST 04 = monofásico (via PISNT, sem valor).
-- 🔴 IBS/CBS JÁ vêm no XML (200/208 notas) — a Reforma está viva. Motor: xpath (não regex). Idempotente.

-- ── helpers de XML (namespace NF-e embutido; RD-52 reuso) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_xml_txt(p_node xml, p_elpath text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (xpath(p_elpath || '/text()', p_node, ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']]))[1]::text
$$;
CREATE OR REPLACE FUNCTION public.fn_xml_num(p_node xml, p_elpath text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim((xpath(p_elpath || '/text()', p_node, ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']]))[1]::text),'')::numeric
$$;
CREATE OR REPLACE FUNCTION public.fn_xml_has(p_node xml, p_path text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT array_length(xpath(p_path, p_node, ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']]),1) IS NOT NULL
$$;

-- ── ENTREGA 1 · tabela filha de tributos + campos do item ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_nfe_recebidas_itens_tributo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  item_id        uuid NOT NULL REFERENCES public.erp_nfe_recebidas_itens(id) ON DELETE CASCADE,
  tributo        text NOT NULL,        -- icms · icms_st · ipi · pis · cofins · ibs · cbs · is
  cst            text, modalidade_bc text,
  base_calculo   numeric(14,2), reducao_bc_pct numeric(9,4), aliquota_pct numeric(9,4),
  mva_pct        numeric(9,4), qtd_tributavel numeric(14,4), valor_por_unid numeric(14,6),
  valor          numeric(14,2), enquadramento text, extra jsonb,
  UNIQUE (item_id, tributo)            -- idempotente: reprocessar não duplica
);
CREATE INDEX IF NOT EXISTS ix_nfe_item_tributo_item ON public.erp_nfe_recebidas_itens_tributo (item_id);
ALTER TABLE public.erp_nfe_recebidas_itens_tributo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfe_item_tributo_rw ON public.erp_nfe_recebidas_itens_tributo;
CREATE POLICY nfe_item_tributo_rw ON public.erp_nfe_recebidas_itens_tributo FOR ALL
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

ALTER TABLE public.erp_nfe_recebidas_itens
  ADD COLUMN IF NOT EXISTS cest text, ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS valor_desconto numeric(14,2), ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_seguro numeric(14,2), ADD COLUMN IF NOT EXISTS valor_outras numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_trib_aprox numeric(14,2), ADD COLUMN IF NOT EXISTS peso_liquido numeric(14,4),
  ADD COLUMN IF NOT EXISTS peso_bruto numeric(14,4), ADD COLUMN IF NOT EXISTS custo_unitario_real numeric(14,6);

-- ── ENTREGA 2 · totais fiscais da nota (IBS/CBS/IS entram agora, mesmo vazios) ───────────────────────
ALTER TABLE public.erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS valor_bc_icms numeric(14,2), ADD COLUMN IF NOT EXISTS valor_icms numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_icms_deson numeric(14,2), ADD COLUMN IF NOT EXISTS valor_bc_st numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_st numeric(14,2), ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_seguro numeric(14,2), ADD COLUMN IF NOT EXISTS valor_outras numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_ipi numeric(14,2), ADD COLUMN IF NOT EXISTS valor_desconto numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_pis numeric(14,2), ADD COLUMN IF NOT EXISTS valor_cofins numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_trib_aprox numeric(14,2), ADD COLUMN IF NOT EXISTS valor_ibs numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_cbs numeric(14,2), ADD COLUMN IF NOT EXISTS valor_is numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_confere boolean;   -- validação vProd+vIPI+vST+vFrete+vSeg+vOutro-vDesc=vNF

-- ── ENTREGA 4 · configuração de custo por empresa e natureza ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_custo_estoque_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
  natureza text NOT NULL,   -- revenda | industrializacao | uso_consumo | imobilizado | default
  icms_e_custo boolean NOT NULL DEFAULT false, st_e_custo boolean NOT NULL DEFAULT true,
  ipi_e_custo boolean NOT NULL DEFAULT true, pis_e_custo boolean NOT NULL DEFAULT false,
  cofins_e_custo boolean NOT NULL DEFAULT false, frete_e_custo boolean NOT NULL DEFAULT true,
  seguro_e_custo boolean NOT NULL DEFAULT true, outras_e_custo boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, natureza)
);
ALTER TABLE public.erp_custo_estoque_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custo_config_rw ON public.erp_custo_estoque_config;
CREATE POLICY custo_config_rw ON public.erp_custo_estoque_config FOR ALL
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- Seed KGF (simples_nacional, monofásico): não credita nada → os 8 são custo (= print do OMIE).
INSERT INTO public.erp_custo_estoque_config
  (company_id, natureza, icms_e_custo, st_e_custo, ipi_e_custo, pis_e_custo, cofins_e_custo, frete_e_custo, seguro_e_custo, outras_e_custo)
VALUES ('a462e13f-0f51-4c54-abe8-4474b591633b','revenda', true,true,true,true,true,true,true,true)
ON CONFLICT (company_id, natureza) DO NOTHING;

-- natureza a partir do cfop_entrada (criado na Fase 0)
CREATE OR REPLACE FUNCTION public.fn_cfop_natureza(p_cfop_entrada text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_cfop_entrada IN ('1102','2102','1403','2403') THEN 'revenda'
    WHEN p_cfop_entrada IN ('1101','2101')               THEN 'industrializacao'
    WHEN p_cfop_entrada IN ('1556','2556','1653','2653') THEN 'uso_consumo'
    WHEN p_cfop_entrada IN ('1551','2551')               THEN 'imobilizado'
    ELSE 'default' END
$$;

-- ── ENTREGA 3 · extração dos tributos (core sem gate p/ backfill; wrapper com gate p/ a tela) ────────
CREATE OR REPLACE FUNCTION public.fn_nfe_extrair_tributos_core(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; v_xml xml; det xml; v_nitem text; v_item uuid; v_comp uuid;
  v_icms xml; v_ipi xml; v_pis xml; v_cofins xml; v_ibscbs xml;
  v_linhas int := 0; v_itens int := 0; v_sem int := 0; v_tem_trib boolean;
  v_vprod numeric; v_vipi numeric; v_vst numeric; v_vfrete numeric; v_vseg numeric; v_voutro numeric; v_vdesc numeric; v_vnf numeric; v_confere boolean;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_id;
  IF NOT FOUND OR v.xml_raw IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_xml'); END IF;
  v_comp := v.company_id;
  BEGIN v_xml := v.xml_raw::xml; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'erro', 'xml_invalido'); END;

  -- totais fiscais
  v_vprod := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vProd');
  v_vipi  := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vIPI');
  v_vst   := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vST');
  v_vfrete:= fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vFrete');
  v_vseg  := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vSeg');
  v_voutro:= fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vOutro');
  v_vdesc := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vDesc');
  v_vnf   := fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vNF');
  v_confere := (v_vnf IS NULL) OR (abs(COALESCE(v_vprod,0)+COALESCE(v_vipi,0)+COALESCE(v_vst,0)+COALESCE(v_vfrete,0)+COALESCE(v_vseg,0)+COALESCE(v_voutro,0)-COALESCE(v_vdesc,0) - v_vnf) <= 0.02);
  UPDATE erp_nfe_recebidas SET
    valor_bc_icms=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vBC'), valor_icms=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vICMS'),
    valor_icms_deson=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vICMSDeson'), valor_bc_st=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vBCST'),
    valor_st=v_vst, valor_frete=v_vfrete, valor_seguro=v_vseg, valor_outras=v_voutro, valor_ipi=v_vipi, valor_desconto=v_vdesc,
    valor_pis=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vPIS'), valor_cofins=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vCOFINS'),
    valor_trib_aprox=fn_xml_num(v_xml,'//n:total/n:ICMSTot/n:vTotTrib'),
    valor_ibs=fn_xml_num(v_xml,'//n:total//n:vIBS'), valor_cbs=fn_xml_num(v_xml,'//n:total//n:vCBS'), valor_is=fn_xml_num(v_xml,'//n:total//n:vIS'),
    total_confere=v_confere, updated_at=now()
  WHERE id = v.id;

  FOR det IN SELECT unnest(xpath('//n:det', v_xml, ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']])) LOOP
    v_nitem := (xpath('/n:det/@nItem', det, ARRAY[ARRAY['n','http://www.portalfiscal.inf.br/nfe']]))[1]::text;
    SELECT id INTO v_item FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND numero_item = NULLIF(v_nitem,'')::int;
    IF v_item IS NULL THEN CONTINUE; END IF;
    v_itens := v_itens + 1; v_tem_trib := false;

    -- campos do item (prod)
    UPDATE erp_nfe_recebidas_itens SET
      cest = fn_xml_txt(det,'n:det/n:prod/n:CEST'),
      origem = fn_xml_txt(det,'n:det/n:imposto/n:ICMS/*/n:orig'),
      valor_desconto = fn_xml_num(det,'n:det/n:prod/n:vDesc'),
      valor_frete = fn_xml_num(det,'n:det/n:prod/n:vFrete'),
      valor_seguro = fn_xml_num(det,'n:det/n:prod/n:vSeg'),
      valor_outras = fn_xml_num(det,'n:det/n:prod/n:vOutro'),
      valor_trib_aprox = fn_xml_num(det,'n:det/n:imposto/n:vTotTrib')
    WHERE id = v_item;

    -- ICMS (filho de nome variável)
    IF fn_xml_has(det,'n:det/n:imposto/n:ICMS/*') THEN
      v_tem_trib := true;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,cst,modalidade_bc,base_calculo,reducao_bc_pct,aliquota_pct,valor)
      VALUES (v_comp,v_item,'icms',
        COALESCE(fn_xml_txt(det,'n:det/n:imposto/n:ICMS/*/n:CST'), fn_xml_txt(det,'n:det/n:imposto/n:ICMS/*/n:CSOSN')),
        fn_xml_txt(det,'n:det/n:imposto/n:ICMS/*/n:modBC'), fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vBC'),
        fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:pRedBC'), fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:pICMS'),
        fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vICMS'))
      ON CONFLICT (item_id,tributo) DO UPDATE SET cst=EXCLUDED.cst,modalidade_bc=EXCLUDED.modalidade_bc,base_calculo=EXCLUDED.base_calculo,reducao_bc_pct=EXCLUDED.reducao_bc_pct,aliquota_pct=EXCLUDED.aliquota_pct,valor=EXCLUDED.valor;
      v_linhas := v_linhas + 1;
      -- ST (só se veio)
      IF fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vICMSST') IS NOT NULL OR fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vBCST') IS NOT NULL THEN
        INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,base_calculo,mva_pct,aliquota_pct,valor)
        VALUES (v_comp,v_item,'icms_st', fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vBCST'),
          fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:pMVAST'), fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:pICMSST'), fn_xml_num(det,'n:det/n:imposto/n:ICMS/*/n:vICMSST'))
        ON CONFLICT (item_id,tributo) DO UPDATE SET base_calculo=EXCLUDED.base_calculo,mva_pct=EXCLUDED.mva_pct,aliquota_pct=EXCLUDED.aliquota_pct,valor=EXCLUDED.valor;
        v_linhas := v_linhas + 1;
      END IF;
    END IF;

    -- IPI
    IF fn_xml_has(det,'n:det/n:imposto/n:IPI') THEN
      v_tem_trib := true;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,cst,enquadramento,base_calculo,aliquota_pct,qtd_tributavel,valor_por_unid,valor)
      VALUES (v_comp,v_item,'ipi', fn_xml_txt(det,'n:det/n:imposto/n:IPI/*/n:CST'), fn_xml_txt(det,'n:det/n:imposto/n:IPI/n:cEnq'),
        fn_xml_num(det,'n:det/n:imposto/n:IPI/*/n:vBC'), fn_xml_num(det,'n:det/n:imposto/n:IPI/*/n:pIPI'),
        fn_xml_num(det,'n:det/n:imposto/n:IPI/*/n:qUnid'), fn_xml_num(det,'n:det/n:imposto/n:IPI/*/n:vUnid'), fn_xml_num(det,'n:det/n:imposto/n:IPI/*/n:vIPI'))
      ON CONFLICT (item_id,tributo) DO UPDATE SET cst=EXCLUDED.cst,enquadramento=EXCLUDED.enquadramento,base_calculo=EXCLUDED.base_calculo,aliquota_pct=EXCLUDED.aliquota_pct,qtd_tributavel=EXCLUDED.qtd_tributavel,valor_por_unid=EXCLUDED.valor_por_unid,valor=EXCLUDED.valor;
      v_linhas := v_linhas + 1;
    END IF;

    -- PIS (mesmo NT: registra o CST, ex.: 04 monofásico)
    IF fn_xml_has(det,'n:det/n:imposto/n:PIS/*') THEN
      v_tem_trib := true;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,cst,base_calculo,aliquota_pct,qtd_tributavel,valor_por_unid,valor)
      VALUES (v_comp,v_item,'pis', fn_xml_txt(det,'n:det/n:imposto/n:PIS/*/n:CST'),
        fn_xml_num(det,'n:det/n:imposto/n:PIS/*/n:vBC'), fn_xml_num(det,'n:det/n:imposto/n:PIS/*/n:pPIS'),
        fn_xml_num(det,'n:det/n:imposto/n:PIS/*/n:qBCProd'), fn_xml_num(det,'n:det/n:imposto/n:PIS/*/n:vAliqProd'), fn_xml_num(det,'n:det/n:imposto/n:PIS/*/n:vPIS'))
      ON CONFLICT (item_id,tributo) DO UPDATE SET cst=EXCLUDED.cst,base_calculo=EXCLUDED.base_calculo,aliquota_pct=EXCLUDED.aliquota_pct,qtd_tributavel=EXCLUDED.qtd_tributavel,valor_por_unid=EXCLUDED.valor_por_unid,valor=EXCLUDED.valor;
      v_linhas := v_linhas + 1;
    END IF;

    -- COFINS
    IF fn_xml_has(det,'n:det/n:imposto/n:COFINS/*') THEN
      v_tem_trib := true;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,cst,base_calculo,aliquota_pct,qtd_tributavel,valor_por_unid,valor)
      VALUES (v_comp,v_item,'cofins', fn_xml_txt(det,'n:det/n:imposto/n:COFINS/*/n:CST'),
        fn_xml_num(det,'n:det/n:imposto/n:COFINS/*/n:vBC'), fn_xml_num(det,'n:det/n:imposto/n:COFINS/*/n:pCOFINS'),
        fn_xml_num(det,'n:det/n:imposto/n:COFINS/*/n:qBCProd'), fn_xml_num(det,'n:det/n:imposto/n:COFINS/*/n:vAliqProd'), fn_xml_num(det,'n:det/n:imposto/n:COFINS/*/n:vCOFINS'))
      ON CONFLICT (item_id,tributo) DO UPDATE SET cst=EXCLUDED.cst,base_calculo=EXCLUDED.base_calculo,aliquota_pct=EXCLUDED.aliquota_pct,qtd_tributavel=EXCLUDED.qtd_tributavel,valor_por_unid=EXCLUDED.valor_por_unid,valor=EXCLUDED.valor;
      v_linhas := v_linhas + 1;
    END IF;

    -- IBS / CBS (Reforma — já vem no XML)
    IF fn_xml_has(det,'n:det/n:imposto/n:IBSCBS') THEN
      v_tem_trib := true;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,cst,base_calculo,aliquota_pct,valor,extra)
      VALUES (v_comp,v_item,'ibs', fn_xml_txt(det,'n:det/n:imposto/n:IBSCBS/n:CST'),
        fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:vBC'), fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:gIBSUF/n:pIBSUF'),
        fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:vIBS'),
        jsonb_build_object('cClassTrib', fn_xml_txt(det,'n:det/n:imposto/n:IBSCBS/n:cClassTrib'), 'vIBSMun', fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:gIBSMun/n:vIBSMun')))
      ON CONFLICT (item_id,tributo) DO UPDATE SET cst=EXCLUDED.cst,base_calculo=EXCLUDED.base_calculo,aliquota_pct=EXCLUDED.aliquota_pct,valor=EXCLUDED.valor,extra=EXCLUDED.extra;
      INSERT INTO erp_nfe_recebidas_itens_tributo (company_id,item_id,tributo,base_calculo,aliquota_pct,valor)
      VALUES (v_comp,v_item,'cbs', fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:vBC'),
        fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:gCBS/n:pCBS'), fn_xml_num(det,'n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:gCBS/n:vCBS'))
      ON CONFLICT (item_id,tributo) DO UPDATE SET base_calculo=EXCLUDED.base_calculo,aliquota_pct=EXCLUDED.aliquota_pct,valor=EXCLUDED.valor;
      v_linhas := v_linhas + 2;
    END IF;

    IF NOT v_tem_trib THEN v_sem := v_sem + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'itens', v_itens, 'linhas', v_linhas, 'itens_sem_tributo', v_sem, 'total_confere', v_confere);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_nfe_extrair_tributos(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM erp_nfe_recebidas WHERE id = p_nfe_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN fn_nfe_extrair_tributos_core(p_nfe_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_extrair_tributos(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_extrair_tributos(uuid) TO authenticated, service_role;

-- ── ENTREGA 5 · custo real por item (core sem gate; wrapper com gate) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_item_custo_real_core(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  i erp_nfe_recebidas_itens%ROWTYPE; n erp_nfe_recebidas%ROWTYPE; cfg erp_custo_estoque_config%ROWTYPE;
  v_nat text; v_share numeric := 0; v_rateio numeric := 0; v_trib numeric := 0; v_base numeric; v_custo numeric;
  v_icms numeric; v_st numeric; v_ipi numeric; v_pis numeric; v_cofins numeric; v_aviso text := NULL;
BEGIN
  SELECT * INTO i FROM erp_nfe_recebidas_itens WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  SELECT * INTO n FROM erp_nfe_recebidas WHERE id = i.nfe_recebida_id;

  v_nat := fn_cfop_natureza(i.cfop_entrada);
  SELECT * INTO cfg FROM erp_custo_estoque_config WHERE company_id = i.company_id AND natureza = v_nat;
  IF NOT FOUND THEN SELECT * INTO cfg FROM erp_custo_estoque_config WHERE company_id = i.company_id AND natureza = 'default'; END IF;
  IF NOT FOUND THEN  -- sem config: default conservador (ST/IPI/frete/seguro/outras) e avisa
    cfg.icms_e_custo:=false; cfg.st_e_custo:=true; cfg.ipi_e_custo:=true; cfg.pis_e_custo:=false; cfg.cofins_e_custo:=false;
    cfg.frete_e_custo:=true; cfg.seguro_e_custo:=true; cfg.outras_e_custo:=true; v_aviso := 'usando_padrao';
  END IF;

  SELECT COALESCE(sum(valor) FILTER (WHERE tributo='icms'),0), COALESCE(sum(valor) FILTER (WHERE tributo='icms_st'),0),
         COALESCE(sum(valor) FILTER (WHERE tributo='ipi'),0), COALESCE(sum(valor) FILTER (WHERE tributo='pis'),0),
         COALESCE(sum(valor) FILTER (WHERE tributo='cofins'),0)
    INTO v_icms, v_st, v_ipi, v_pis, v_cofins
    FROM erp_nfe_recebidas_itens_tributo WHERE item_id = i.id;

  v_trib := (CASE WHEN cfg.icms_e_custo THEN v_icms ELSE 0 END) + (CASE WHEN cfg.st_e_custo THEN v_st ELSE 0 END)
          + (CASE WHEN cfg.ipi_e_custo THEN v_ipi ELSE 0 END) + (CASE WHEN cfg.pis_e_custo THEN v_pis ELSE 0 END)
          + (CASE WHEN cfg.cofins_e_custo THEN v_cofins ELSE 0 END);

  -- rateio do frete/seguro/outras da NOTA, proporcional ao valor do item sobre vProd
  IF COALESCE(n.valor_produtos,0) > 0 THEN
    v_share := COALESCE(i.valor_total,0) / n.valor_produtos;
    v_rateio := v_share * ((CASE WHEN cfg.frete_e_custo THEN COALESCE(n.valor_frete,0) ELSE 0 END)
                         + (CASE WHEN cfg.seguro_e_custo THEN COALESCE(n.valor_seguro,0) ELSE 0 END)
                         + (CASE WHEN cfg.outras_e_custo THEN COALESCE(n.valor_outras,0) ELSE 0 END));
  ELSIF (COALESCE(n.valor_frete,0)+COALESCE(n.valor_seguro,0)+COALESCE(n.valor_outras,0)) > 0 THEN
    v_aviso := COALESCE(v_aviso,'sem_vprod_nao_rateia');
  END IF;

  v_base := COALESCE(i.valor_total,0) + v_trib + v_rateio - COALESCE(i.valor_desconto,0);
  v_custo := CASE WHEN COALESCE(i.quantidade,0) > 0 THEN v_base / i.quantidade ELSE NULL END;
  UPDATE erp_nfe_recebidas_itens SET custo_unitario_real = v_custo WHERE id = i.id;

  RETURN jsonb_build_object('ok', true, 'natureza', v_nat, 'aviso', v_aviso,
    'custo_unitario_real', v_custo,
    'memoria', jsonb_build_object('valor_item', i.valor_total, 'tributos_custo', v_trib, 'rateio', round(v_rateio,4),
      'desconto', i.valor_desconto, 'quantidade', i.quantidade,
      'detalhe', jsonb_build_object('icms',v_icms,'st',v_st,'ipi',v_ipi,'pis',v_pis,'cofins',v_cofins,
        'config', jsonb_build_object('icms',cfg.icms_e_custo,'st',cfg.st_e_custo,'ipi',cfg.ipi_e_custo,'pis',cfg.pis_e_custo,'cofins',cfg.cofins_e_custo,'frete',cfg.frete_e_custo,'seguro',cfg.seguro_e_custo,'outras',cfg.outras_e_custo))));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_nfe_item_custo_real(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM erp_nfe_recebidas_itens WHERE id = p_item_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN fn_nfe_item_custo_real_core(p_item_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_item_custo_real(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_custo_real(uuid) TO authenticated, service_role;

-- ── ENTREGA 5.1 · a entrada de estoque passa a usar o custo REAL (não altera fn_movimentar_estoque) ──
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_dar_entrada_estoque(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; v_local uuid; r record; v_mov uuid;
  v_movidos int := 0; v_valor numeric := 0; v_pend_vinculo int := 0; v_custo numeric;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_recebida_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;

  -- garante tributos extraídos (idempotente) para o custo real ficar correto
  BEGIN PERFORM fn_nfe_extrair_tributos_core(v.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  v_local := fn_estoque_local_principal(v.company_id);
  SELECT count(*) INTO v_pend_vinculo FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true AND produto_id IS NULL;

  FOR r IN
    SELECT i.* FROM erp_nfe_recebidas_itens i
     WHERE i.nfe_recebida_id=v.id AND i.produto_id IS NOT NULL
       AND COALESCE(i.entra_estoque,false)=true AND COALESCE(i.estoque_movimentado,false)=false
       AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id=i.produto_id AND p.company_id=v.company_id)
  LOOP
    PERFORM fn_nfe_item_custo_real_core(r.id);                       -- calcula custo real do item
    SELECT custo_unitario_real INTO v_custo FROM erp_nfe_recebidas_itens WHERE id=r.id;
    v_custo := COALESCE(v_custo, r.valor_unitario);                  -- fallback: nunca quebra a entrada
    v_mov := fn_movimentar_estoque(
      p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'entrada',
      p_quantidade := r.quantidade, p_custo_unitario := v_custo,     -- ⭐ custo REAL, não o cru
      p_motivo := 'Entrada NF-e compra',
      p_observacoes := 'NF-e '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''),
      p_ref_tipo := 'nfe_recebida', p_ref_id := v.id, p_ref_numero := v.numero);
    UPDATE erp_nfe_recebidas_itens SET estoque_movimentado=true, movimentacao_id=v_mov WHERE id=r.id;
    v_movidos := v_movidos + 1; v_valor := v_valor + COALESCE(v_custo,0)*COALESCE(r.quantidade,0);
  END LOOP;

  UPDATE erp_nfe_recebidas SET
    estoque_status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true) THEN 'nao_aplicavel'
      WHEN EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true AND COALESCE(estoque_movimentado,false)=false) THEN 'parcial'
      ELSE 'completo' END,
    estoque_dado_em = CASE WHEN v_movidos>0 THEN now() ELSE estoque_dado_em END, updated_at = now()
  WHERE id=v.id;

  RETURN jsonb_build_object('ok',true,'itens_movidos',v_movidos,'valor_entrada',v_valor,'pendentes_vinculo',v_pend_vinculo,'local_id',v_local);
END $function$;

-- ── ENTREGA 6 · SIMULAÇÃO (só relatório — NÃO grava custo médio; RD-55) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_custo_simular(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- último custo real conhecido por produto (via itens já vinculados) vs custo atual do cadastro
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'diferenca')::numeric DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'produto_id', p.id, 'codigo', p.codigo, 'nome', p.nome,
      'custo_hoje', p.custo, 'custo_real', cr.custo_real, 'diferenca', round(cr.custo_real - p.custo, 4),
      'preco_venda', p.preco_venda,
      'margem_hoje_pct', CASE WHEN p.preco_venda>0 THEN round((p.preco_venda - p.custo)/p.preco_venda*100,2) END,
      'margem_real_pct', CASE WHEN p.preco_venda>0 THEN round((p.preco_venda - cr.custo_real)/p.preco_venda*100,2) END
    ) AS x
    FROM (SELECT id, codigo, nome, preco_venda, COALESCE(NULLIF(preco_custo_medio,0),preco_custo) AS custo
            FROM erp_produtos WHERE company_id=p_company_id AND COALESCE(ativo,true)=true) p
    JOIN LATERAL (
      SELECT it.custo_unitario_real AS custo_real
        FROM erp_nfe_recebidas_itens it
       WHERE it.produto_id = p.id AND it.custo_unitario_real IS NOT NULL
       ORDER BY it.id DESC LIMIT 1
    ) cr ON true
    WHERE abs(cr.custo_real - p.custo) >= 0.01
  ) t;
  RETURN jsonb_build_object('ok', true, 'total', jsonb_array_length(v_rows), 'produtos', v_rows,
    'aviso', 'Simulação — nada foi gravado. Aplicar o custo médio histórico exige autorização do CEO (RD-55).');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_custo_simular(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_custo_simular(uuid) TO authenticated, service_role;

-- ── BACKFILL (RD-54: em transação, com contagem) — extrai tributos e calcula custo real dos existentes ──
DO $backfill$
DECLARE r record; res jsonb;
BEGIN
  FOR r IN SELECT id FROM erp_nfe_recebidas WHERE xml_raw IS NOT NULL LOOP
    BEGIN res := fn_nfe_extrair_tributos_core(r.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR r IN SELECT id FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id IN (SELECT id FROM erp_nfe_recebidas WHERE xml_raw IS NOT NULL) LOOP
    BEGIN res := fn_nfe_item_custo_real_core(r.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $backfill$;
