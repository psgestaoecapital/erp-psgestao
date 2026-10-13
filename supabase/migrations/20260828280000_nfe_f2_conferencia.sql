-- SPEC NFE-F2 · conferência de verdade. Comparar o que a nota diz com o que chegou.
-- Depende de F0 (cfop_entrada) e F1 (custo real, helpers fn_xml_*). Reusa (RD-26/52): de-para, erp_compras,
-- duplicatas, e os helpers de XML da F1. Auditado (RD-38) na KGF: <transp> tem modFrete + transporta/xNome.

-- ── ENTREGA 1 · quantidade recebida + motivo de divergência ─────────────────────────────────────────
ALTER TABLE public.erp_nfe_recebidas_itens
  ADD COLUMN IF NOT EXISTS quantidade_recebida numeric(14,4),
  ADD COLUMN IF NOT EXISTS divergencia_motivo  text,
  ADD COLUMN IF NOT EXISTS gera_financeiro     boolean NOT NULL DEFAULT true,   -- E6
  ADD COLUMN IF NOT EXISTS pedido_compra_id    uuid REFERENCES public.erp_compras(id),  -- E4
  ADD COLUMN IF NOT EXISTS pedido_item_id      uuid;
-- nasce igual à quantidade da nota (o caso normal não dá trabalho)
UPDATE public.erp_nfe_recebidas_itens SET quantidade_recebida = quantidade WHERE quantidade_recebida IS NULL;

-- ── ENTREGA 2 · conversão de unidade no de-para (fator=1 por padrão: nada muda p/ quem já funciona) ──
ALTER TABLE public.erp_produto_depara_fornecedor
  ADD COLUMN IF NOT EXISTS unidade_fornecedor text,
  ADD COLUMN IF NOT EXISTS fator_conversao    numeric(14,6) DEFAULT 1;

-- ── ENTREGA 4/5 · pedido + logística na nota ────────────────────────────────────────────────────────
ALTER TABLE public.erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS pedido_compra_id uuid REFERENCES public.erp_compras(id),
  ADD COLUMN IF NOT EXISTS previsao_entrega date,
  ADD COLUMN IF NOT EXISTS recebida_em      date,
  ADD COLUMN IF NOT EXISTS transportadora   text,
  ADD COLUMN IF NOT EXISTS frete_modalidade text,
  ADD COLUMN IF NOT EXISTS peso_bruto       numeric(14,4),
  ADD COLUMN IF NOT EXISTS volumes_qtd      int,
  ADD COLUMN IF NOT EXISTS sem_financeiro   boolean NOT NULL DEFAULT false;   -- E6

-- ── ENTREGA 5 · extrair <transp> do XML (reusa helpers da F1) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_extrair_transp(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v erp_nfe_recebidas%ROWTYPE; x xml;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_id;
  IF NOT FOUND OR v.xml_raw IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','sem_xml'); END IF;
  BEGIN x := v.xml_raw::xml; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'erro','xml_invalido'); END;
  UPDATE erp_nfe_recebidas SET
    transportadora   = COALESCE(NULLIF(btrim(transportadora),''), fn_xml_txt(x,'//n:transp/n:transporta/n:xNome')),
    frete_modalidade = COALESCE(NULLIF(btrim(frete_modalidade),''), fn_xml_txt(x,'//n:transp/n:modFrete')),
    peso_bruto       = COALESCE(peso_bruto, fn_xml_num(x,'//n:transp/n:vol/n:pesoB')),
    volumes_qtd      = COALESCE(volumes_qtd, fn_xml_num(x,'//n:transp/n:vol/n:qVol')::int),
    updated_at = now()
  WHERE id=v.id;
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- ── ENTREGA 1 · conferir item (qtd recebida, motivo, gera_financeiro) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_item_conferir(
  p_item_id uuid, p_qtd_recebida numeric DEFAULT NULL, p_motivo text DEFAULT NULL, p_gera_financeiro boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE i erp_nfe_recebidas_itens%ROWTYPE; v_qtd numeric; v_div boolean;
BEGIN
  SELECT * INTO i FROM erp_nfe_recebidas_itens WHERE id=p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','item_nao_encontrado'); END IF;
  IF i.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  v_qtd := COALESCE(p_qtd_recebida, i.quantidade_recebida, i.quantidade);
  v_div := v_qtd IS DISTINCT FROM i.quantidade;
  IF v_div AND NULLIF(btrim(COALESCE(p_motivo, i.divergencia_motivo,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','motivo_obrigatorio','esperado', i.quantidade, 'recebido', v_qtd); END IF;
  UPDATE erp_nfe_recebidas_itens SET
    quantidade_recebida = v_qtd,
    divergencia_motivo  = CASE WHEN v_div THEN COALESCE(NULLIF(btrim(p_motivo),''), divergencia_motivo) ELSE NULL END,
    gera_financeiro     = COALESCE(p_gera_financeiro, gera_financeiro)
  WHERE id=i.id;
  RETURN jsonb_build_object('ok',true,'divergencia',v_div,'esperado',i.quantidade,'recebido',v_qtd);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_item_conferir(uuid,numeric,text,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_conferir(uuid,numeric,text,boolean) TO authenticated, service_role;

-- ── ENTREGA 2 · gravar o fator de conversão no de-para (pergunta uma vez, vale sempre) ──────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_depara_fator_set(
  p_company_id uuid, p_fornecedor_cnpj text, p_produto_id uuid, p_codigo_fornecedor text,
  p_unidade_fornecedor text, p_fator numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_cnpj text := regexp_replace(COALESCE(p_fornecedor_cnpj,''),'\D','','g'); v_id uuid; v_fator numeric := GREATEST(COALESCE(p_fator,1), 0.000001);
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT id INTO v_id FROM erp_produto_depara_fornecedor
   WHERE company_id=p_company_id AND regexp_replace(COALESCE(fornecedor_cnpj,''),'\D','','g')=v_cnpj
     AND (produto_id=p_produto_id OR (p_produto_id IS NULL AND codigo_fornecedor=p_codigo_fornecedor)) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO erp_produto_depara_fornecedor (company_id, fornecedor_cnpj, codigo_fornecedor, produto_id, unidade_fornecedor, fator_conversao, criado_por)
    VALUES (p_company_id, v_cnpj, p_codigo_fornecedor, p_produto_id, p_unidade_fornecedor, v_fator, auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE erp_produto_depara_fornecedor SET unidade_fornecedor=COALESCE(p_unidade_fornecedor,unidade_fornecedor), fator_conversao=v_fator WHERE id=v_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',v_id,'fator',v_fator);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_depara_fator_set(uuid,text,uuid,text,text,numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_depara_fator_set(uuid,text,uuid,text,text,numeric) TO authenticated, service_role;

-- helper: fator do item (de-para por fornecedor+produto; default 1)
CREATE OR REPLACE FUNCTION public.fn_nfe_item_fator(p_company_id uuid, p_fornecedor_cnpj text, p_produto_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT COALESCE((SELECT fator_conversao FROM erp_produto_depara_fornecedor
    WHERE company_id=p_company_id AND regexp_replace(COALESCE(fornecedor_cnpj,''),'\D','','g')=regexp_replace(COALESCE(p_fornecedor_cnpj,''),'\D','','g')
      AND produto_id=p_produto_id AND fator_conversao IS NOT NULL LIMIT 1), 1)
$fn$;

-- ── ENTREGA 3 · editar/refazer parcelas antes de gerar (soma tem que bater; não editar depois de gerado) ──
CREATE OR REPLACE FUNCTION public.fn_nfe_duplicatas_editar(p_nfe_id uuid, p_parcelas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v erp_nfe_recebidas%ROWTYPE; e jsonb; v_soma numeric := 0; v_n int := 0;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota_nao_encontrada'); END IF;
  IF v.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v.lancado_pagar THEN RETURN jsonb_build_object('ok',false,'erro','ja_lancado'); END IF;   -- depois de gerado é na tela de contas a pagar
  SELECT COALESCE(sum((x->>'valor')::numeric),0) INTO v_soma FROM jsonb_array_elements(COALESCE(p_parcelas,'[]'::jsonb)) x;
  IF abs(v_soma - COALESCE(v.valor_total,0)) > 0.02 THEN
    RETURN jsonb_build_object('ok',false,'erro','soma_nao_bate','soma_parcelas',v_soma,'valor_nota',v.valor_total); END IF;
  DELETE FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id=v.id AND pagar_id IS NULL;   -- só as ainda não geradas
  FOR e IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    INSERT INTO erp_nfe_recebidas_duplicatas (nfe_recebida_id, company_id, numero_dup, data_vencimento, valor)
    VALUES (v.id, v.company_id, COALESCE(NULLIF(e->>'numero',''), v_n::text), (e->>'vencimento')::date, (e->>'valor')::numeric);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'parcelas',v_n,'soma',v_soma);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_duplicatas_editar(uuid,jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_duplicatas_editar(uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nfe_duplicatas_refazer(p_nfe_id uuid, p_num_parcelas int, p_primeiro_venc date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v erp_nfe_recebidas%ROWTYPE; v_n int := GREATEST(COALESCE(p_num_parcelas,1),1); v_val numeric; v_parc numeric; v_acc numeric := 0; i int; v_venc date; v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota_nao_encontrada'); END IF;
  IF v.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v.lancado_pagar THEN RETURN jsonb_build_object('ok',false,'erro','ja_lancado'); END IF;
  v_val := COALESCE(v.valor_total,0); v_parc := round(v_val / v_n, 2);
  DELETE FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id=v.id AND pagar_id IS NULL;
  FOR i IN 1..v_n LOOP
    v_venc := COALESCE(p_primeiro_venc, v.data_emissao::date, CURRENT_DATE) + ((i-1)*30);
    IF i = v_n THEN v_parc := round(v_val - v_acc, 2); END IF;   -- última acerta o arredondamento
    v_acc := v_acc + v_parc;
    INSERT INTO erp_nfe_recebidas_duplicatas (nfe_recebida_id, company_id, numero_dup, data_vencimento, valor)
    VALUES (v.id, v.company_id, i::text, v_venc, v_parc);
    v_out := v_out || jsonb_build_object('numero',i,'vencimento',v_venc,'valor',v_parc);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'parcelas',v_out,'soma',v_acc);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_duplicatas_refazer(uuid,int,date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_duplicatas_refazer(uuid,int,date) TO authenticated, service_role;

-- ── ENTREGA 4 · sugerir pedido de compra (sugere, não vincula sozinho) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_sugerir_pedido(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v erp_nfe_recebidas%ROWTYPE; v_cnpj text; v_rows jsonb;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota_nao_encontrada'); END IF;
  IF v.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  v_cnpj := regexp_replace(COALESCE(v.emitente_cnpj,''),'\D','','g');
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'proximidade')::numeric ASC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('id',c.id,'numero',c.numero,'data_pedido',c.data_pedido,'total',c.total,'status',c.status,
      'proximidade', abs(COALESCE(c.total,0) - COALESCE(v.valor_total,0))) AS x
    FROM erp_compras c
    WHERE c.company_id=v.company_id
      AND regexp_replace(COALESCE(c.fornecedor_cnpj,''),'\D','','g') = v_cnpj
      AND COALESCE(c.status,'') NOT IN ('cancelado','recebido','concluido')
      AND (c.data_pedido IS NULL OR c.data_pedido <= COALESCE(v.data_emissao::date, CURRENT_DATE) + 5)
    ORDER BY abs(COALESCE(c.total,0) - COALESCE(v.valor_total,0)) ASC LIMIT 5
  ) s;
  RETURN jsonb_build_object('ok',true,'pedidos',v_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_sugerir_pedido(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_sugerir_pedido(uuid) TO authenticated, service_role;

-- ── ENTREGA 1/2 · a entrada de estoque usa a QUANTIDADE RECEBIDA × FATOR e custo ÷ fator ─────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_dar_entrada_estoque(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; v_local uuid; r record; v_mov uuid;
  v_movidos int := 0; v_valor numeric := 0; v_pend_vinculo int := 0; v_custo numeric;
  v_cnpj text; v_fator numeric; v_qtd numeric;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_recebida_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;
  v_cnpj := regexp_replace(COALESCE(v.emitente_cnpj,''),'\D','','g');

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
    PERFORM fn_nfe_item_custo_real_core(r.id);
    SELECT custo_unitario_real INTO v_custo FROM erp_nfe_recebidas_itens WHERE id=r.id;
    v_custo := COALESCE(v_custo, r.valor_unitario);
    v_fator := GREATEST(fn_nfe_item_fator(v.company_id, v_cnpj, r.produto_id), 0.000001);   -- E2 · CX→UN
    v_qtd   := COALESCE(r.quantidade_recebida, r.quantidade);                                -- E1 · o que chegou
    v_mov := fn_movimentar_estoque(
      p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'entrada',
      p_quantidade := v_qtd * v_fator,               -- ⭐ recebido × fator (na unidade do produto)
      p_custo_unitario := v_custo / v_fator,          -- ⭐ custo por unidade do produto (÷ fator)
      p_motivo := 'Entrada NF-e compra',
      p_observacoes := 'NF-e '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''),
      p_ref_tipo := 'nfe_recebida', p_ref_id := v.id, p_ref_numero := v.numero);
    UPDATE erp_nfe_recebidas_itens SET estoque_movimentado=true, movimentacao_id=v_mov WHERE id=r.id;
    v_movidos := v_movidos + 1; v_valor := v_valor + COALESCE(v_custo,0)*COALESCE(v_qtd,0);
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

-- ── ENTREGA 6 · gerar_pagar respeita gera_financeiro (todos false → sem título, marca "sem financeiro") ──
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_gerar_pagar(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; d record; v_forn uuid; v_hash text; v_ref text; v_pid uuid;
  v_ndup int := 0; v_criadas int := 0; v_total numeric := 0; v_cnpj text; v_categoria text; v_ncat int := 0;
  v_itens int := 0; v_com_fin int := 0;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nfe nao encontrada'); END IF;
  IF v.lancado_pagar THEN RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'fornecedor_id', v.fornecedor_id); END IF;

  -- E6 · se a nota TEM itens e NENHUM gera financeiro (bonificação/brinde/frete embutido) → sem título
  SELECT count(*), count(*) FILTER (WHERE COALESCE(gera_financeiro,true)) INTO v_itens, v_com_fin
    FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id = v.id;
  IF v_itens > 0 AND v_com_fin = 0 THEN
    UPDATE erp_nfe_recebidas SET sem_financeiro=true, lancado_pagar=true, updated_at=now() WHERE id=v.id;
    RETURN jsonb_build_object('ok', true, 'sem_financeiro', true, 'pagar_criadas', 0); END IF;

  SELECT categoria_codigo INTO v_categoria FROM (
    SELECT categoria_codigo, sum(COALESCE(valor_total,0)) s FROM erp_nfe_recebidas_itens
     WHERE nfe_recebida_id = v.id AND categoria_codigo IS NOT NULL GROUP BY categoria_codigo ORDER BY s DESC LIMIT 1) t;
  v_categoria := COALESCE(v_categoria, v.categoria_codigo);
  SELECT count(DISTINCT categoria_codigo) INTO v_ncat FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id = v.id AND categoria_codigo IS NOT NULL;

  v_cnpj := regexp_replace(COALESCE(v.emitente_cnpj, ''), '\D', '', 'g');
  v_forn := v.fornecedor_id;
  IF v_forn IS NULL AND v_cnpj <> '' THEN
    SELECT id INTO v_forn FROM erp_fornecedores WHERE company_id = v.company_id AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_cnpj LIMIT 1;
    IF v_forn IS NULL THEN
      INSERT INTO erp_fornecedores (company_id, nome_fantasia, razao_social, cnpj_cpf, cpf_cnpj, ie, tipo_pessoa, ativo, ref_externa_id, ref_externa_sistema)
      VALUES (v.company_id, COALESCE(v.emitente_razao,'Fornecedor '||v_cnpj), COALESCE(v.emitente_razao,'Fornecedor '||v_cnpj), v.emitente_cnpj, v.emitente_cnpj, v.emitente_ie, 'J', true, v.emitente_cnpj, 'nfe_distribuicao')
      RETURNING id INTO v_forn;
    END IF;
    UPDATE erp_nfe_recebidas SET fornecedor_id = v_forn WHERE id = v.id;
  END IF;

  SELECT count(*) INTO v_ndup FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id = v.id;
  IF v_ndup > 0 THEN
    FOR d IN SELECT * FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id = v.id ORDER BY numero_dup LOOP
      v_hash := 'nfe:'||v.chave_acesso||':dup:'||COALESCE(d.numero_dup, d.id::text);
      v_ref  := v.chave_acesso||':'||COALESCE(d.numero_dup, d.id::text);
      SELECT id INTO v_pid FROM erp_pagar WHERE company_id = v.company_id AND import_hash = v_hash LIMIT 1;
      IF v_pid IS NULL THEN
        INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, descricao, categoria, valor,
          data_emissao, data_vencimento, data_competencia, status, numero_nf, numero_documento, parcela, ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes)
        VALUES (v.company_id, v_forn, v.emitente_razao, 'NF-e compra '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''), v_categoria, d.valor,
          v.data_emissao::date, d.data_vencimento, v.data_emissao::date, 'aberto', v.numero, v.chave_acesso, d.numero_dup, v_ref, 'nfe_distribuicao', v_hash, now(),
          'Gerado automaticamente da NF-e de compra (DF-e). Chave '||v.chave_acesso)
        RETURNING id INTO v_pid;
        v_criadas := v_criadas + 1; v_total := v_total + COALESCE(d.valor, 0);
      END IF;
      UPDATE erp_nfe_recebidas_duplicatas SET pagar_id = v_pid WHERE id = d.id;
    END LOOP;
  ELSE
    v_hash := 'nfe:'||v.chave_acesso||':total'; v_ref := v.chave_acesso||':total';
    SELECT id INTO v_pid FROM erp_pagar WHERE company_id = v.company_id AND import_hash = v_hash LIMIT 1;
    IF v_pid IS NULL THEN
      INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, descricao, categoria, valor,
        data_emissao, data_vencimento, data_competencia, status, numero_nf, numero_documento, ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes)
      VALUES (v.company_id, v_forn, v.emitente_razao, 'NF-e compra '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''), v_categoria, v.valor_total,
        v.data_emissao::date, COALESCE(v.data_emissao::date, CURRENT_DATE), v.data_emissao::date, 'aberto', v.numero, v.chave_acesso, v_ref, 'nfe_distribuicao', v_hash, now(),
        'Gerado automaticamente da NF-e de compra (DF-e), sem duplicatas. Chave '||v.chave_acesso)
      RETURNING id INTO v_pid;
      v_criadas := 1; v_total := COALESCE(v.valor_total, 0);
    END IF;
  END IF;

  UPDATE erp_nfe_recebidas SET lancado_pagar = true, updated_at = now() WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'fornecedor_id', v_forn, 'duplicatas', v_ndup, 'pagar_criadas', v_criadas, 'valor_total', v_total, 'categoria', v_categoria, 'categoria_divergente', (v_ncat > 1));
END $function$;

-- ── BACKFILL · quantidade_recebida (feito acima) + <transp> das 208 notas (RD-54) ───────────────────
DO $bf$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM erp_nfe_recebidas WHERE xml_raw IS NOT NULL LOOP
    BEGIN PERFORM fn_nfe_extrair_transp(r.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $bf$;
