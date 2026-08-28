-- SPEC NFE-F0 · Fase 0 da paridade OMIE (backend). Destrava a operação sem tocar em tributos (Fase 1).
-- Auditado (RD-38/44/45) na KGF (a462e13f, UF SC): 210 notas, 208 c/ XML, 356 itens, CFOPs 5102(313)/
-- 6102(25)/5656(12)/5101(3)/5405/5910/5949. As 28 regras erp_estoque_cfop_regra são de ENTRADA (1xxx/
-- 2xxx) e os itens gravam a SAÍDA do fornecedor (5xxx/6xxx) → nenhuma casa (gap G13 confirmado).
-- fn_nfe_recebida_gerar_pagar cravava 'Compras / Mercadorias' (literal fora do plano). E0 corrige isso.
-- RD-55: NÃO altera os 2 títulos já gerados nem preços. RD-52: motor único (trigger + helper reutilizados).

-- ══ E0.1 · conversão de CFOP saída → entrada (global; empresa pode sobrepor) ════════════════════════
CREATE TABLE IF NOT EXISTS public.erp_cfop_conversao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid,                       -- NULL = regra global (como as 28 de cfop_regra)
  cfop_saida    text NOT NULL,              -- CFOP do fornecedor
  cfop_entrada_interno text,                -- mesma UF (5xxx → 1xxx)
  cfop_entrada_inter   text,                -- outra UF (6xxx → 2xxx)
  descricao     text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfop_conversao ON public.erp_cfop_conversao (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), cfop_saida);

INSERT INTO public.erp_cfop_conversao (company_id, cfop_saida, cfop_entrada_interno, cfop_entrada_inter, descricao) VALUES
  (NULL,'5101','1101','2101','compra para industrialização'),
  (NULL,'6101','1101','2101','compra para industrialização'),
  (NULL,'5102','1102','2102','compra para comercialização'),
  (NULL,'6102','1102','2102','compra para comercialização'),
  (NULL,'5405','1403','2403','mercadoria adquirida com ST'),
  (NULL,'6405','1403','2403','mercadoria adquirida com ST'),
  (NULL,'5656','1653','2653','combustível/lubrificante'),
  (NULL,'6656','1653','2653','combustível/lubrificante'),
  (NULL,'5910','1910','2910','bonificação/brinde'),
  (NULL,'6910','1910','2910','bonificação/brinde'),
  (NULL,'5949','1949','2949','outra saída/entrada'),
  (NULL,'6949','1949','2949','outra saída/entrada')
ON CONFLICT DO NOTHING;

-- ══ E0.3 · CFOP de entrada → categoria sugerida do plano (global; empresa sobrepõe) ═════════════════
CREATE TABLE IF NOT EXISTS public.erp_cfop_categoria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid,                     -- NULL = sugestão global
  cfop_entrada    text NOT NULL,
  categoria_codigo text NOT NULL,           -- referencia erp_plano_contas.codigo (por empresa)
  descricao       text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfop_categoria ON public.erp_cfop_categoria (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), cfop_entrada);

-- 2.01.01 (Compras/Mercadorias) é padrão do plano-base → global. Combustível é numeração da KGF → específico.
INSERT INTO public.erp_cfop_categoria (company_id, cfop_entrada, categoria_codigo, descricao) VALUES
  (NULL,'1101','2.01.01','compras/mercadorias'),(NULL,'2101','2.01.01','compras/mercadorias'),
  (NULL,'1102','2.01.01','compras/mercadorias'),(NULL,'2102','2.01.01','compras/mercadorias'),
  (NULL,'1403','2.01.01','compras/mercadorias'),(NULL,'2403','2.01.01','compras/mercadorias'),
  ('a462e13f-0f51-4c54-abe8-4474b591633b','1653','2.04.99','combustível (KGF)'),
  ('a462e13f-0f51-4c54-abe8-4474b591633b','2653','2.04.99','combustível (KGF)')
ON CONFLICT DO NOTHING;

-- ══ E0.2/E0.3/E0.4/E1 · colunas novas ══════════════════════════════════════════════════════════════
ALTER TABLE public.erp_nfe_recebidas_itens
  ADD COLUMN IF NOT EXISTS cfop_entrada     text,
  ADD COLUMN IF NOT EXISTS categoria_codigo text;
ALTER TABLE public.erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS emitente_uf      text,       -- extraído do XML (enderEmit/UF) — decide interno/inter
  ADD COLUMN IF NOT EXISTS categoria_codigo text,        -- categoria da NOTA escolhida na tela (fallback)
  ADD COLUMN IF NOT EXISTS concluida_em     timestamptz, -- E1
  ADD COLUMN IF NOT EXISTS concluida_por    uuid,
  ADD COLUMN IF NOT EXISTS observacoes      text;         -- E3/G42

-- helper: CFOP de saída → CFOP de entrada, decidindo interno/inter pela UF (fallback: 1º dígito do CFOP).
CREATE OR REPLACE FUNCTION public.fn_cfop_para_entrada(p_cfop text, p_emit_uf text, p_comp_uf text, p_company_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE v_c text := btrim(COALESCE(p_cfop,'')); v_interno boolean; r record;
BEGIN
  IF v_c = '' THEN RETURN NULL; END IF;
  IF left(v_c,1) IN ('1','2') THEN RETURN v_c; END IF;   -- já é CFOP de entrada
  -- interno se as UFs batem; sem UF confiável, cai no 1º dígito da saída (5 = intra, 6 = inter)
  v_interno := CASE
    WHEN NULLIF(p_emit_uf,'') IS NOT NULL AND NULLIF(p_comp_uf,'') IS NOT NULL THEN upper(p_emit_uf)=upper(p_comp_uf)
    ELSE left(v_c,1)='5' END;
  SELECT cfop_entrada_interno, cfop_entrada_inter INTO r
    FROM erp_cfop_conversao
   WHERE cfop_saida = v_c AND (company_id = p_company_id OR company_id IS NULL)
   ORDER BY company_id NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN CASE WHEN v_interno THEN r.cfop_entrada_interno ELSE r.cfop_entrada_inter END;
END $fn$;

-- helper: CFOP de entrada → categoria (empresa sobrepõe global)
CREATE OR REPLACE FUNCTION public.fn_cfop_categoria(p_cfop_entrada text, p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT categoria_codigo FROM erp_cfop_categoria
   WHERE cfop_entrada = p_cfop_entrada AND (company_id = p_company_id OR company_id IS NULL)
   ORDER BY company_id NULLS LAST LIMIT 1;
$fn$;

-- trigger na NOTA: extrai emitente_uf do XML quando vazio (para novas notas)
CREATE OR REPLACE FUNCTION public.tg_nfe_emitente_uf()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NULLIF(NEW.emitente_uf,'') IS NULL AND NEW.xml_raw IS NOT NULL THEN
    NEW.emitente_uf := substring(NEW.xml_raw from 'enderEmit.*?<UF>([A-Z]{2})</UF>');
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tg_nfe_emitente_uf ON public.erp_nfe_recebidas;
CREATE TRIGGER tg_nfe_emitente_uf BEFORE INSERT OR UPDATE OF xml_raw, emitente_uf ON public.erp_nfe_recebidas
  FOR EACH ROW EXECUTE FUNCTION public.tg_nfe_emitente_uf();

-- trigger no ITEM: preenche cfop_entrada + categoria_codigo na extração (e em qualquer insert/update)
CREATE OR REPLACE FUNCTION public.tg_nfe_item_cfop_entrada()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE v_emit text; v_comp text; v_ent text;
BEGIN
  SELECT n.emitente_uf, upper(btrim(split_part(c.cidade_estado,'/',2)))
    INTO v_emit, v_comp
    FROM erp_nfe_recebidas n JOIN companies c ON c.id = n.company_id
   WHERE n.id = NEW.nfe_recebida_id;
  v_ent := fn_cfop_para_entrada(NEW.cfop, v_emit, v_comp, NEW.company_id);
  NEW.cfop_entrada := v_ent;
  IF v_ent IS NOT NULL THEN NEW.categoria_codigo := fn_cfop_categoria(v_ent, NEW.company_id); END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tg_nfe_item_cfop_entrada ON public.erp_nfe_recebidas_itens;
CREATE TRIGGER tg_nfe_item_cfop_entrada BEFORE INSERT OR UPDATE OF cfop ON public.erp_nfe_recebidas_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_nfe_item_cfop_entrada();

-- ══ BACKFILL (RD-54: contagens no PR) ══════════════════════════════════════════════════════════════
-- 1) emitente_uf das notas com XML
UPDATE public.erp_nfe_recebidas
   SET emitente_uf = substring(xml_raw from 'enderEmit.*?<UF>([A-Z]{2})</UF>')
 WHERE emitente_uf IS NULL AND xml_raw IS NOT NULL;
-- 2) cfop_entrada + categoria dos itens existentes (não dispara trigger — UPDATE explícito e auditável)
UPDATE public.erp_nfe_recebidas_itens i
   SET cfop_entrada = ent.cfop_entrada,
       categoria_codigo = fn_cfop_categoria(ent.cfop_entrada, i.company_id)
  FROM (
    SELECT i2.id,
           fn_cfop_para_entrada(i2.cfop, n.emitente_uf, upper(btrim(split_part(c.cidade_estado,'/',2))), i2.company_id) AS cfop_entrada
      FROM erp_nfe_recebidas_itens i2
      JOIN erp_nfe_recebidas n ON n.id = i2.nfe_recebida_id
      JOIN companies c ON c.id = i2.company_id
  ) ent
 WHERE ent.id = i.id;

-- ══ E0.4 · gerar_pagar deixa de cravar a categoria (usa item predominante → nota → nunca literal) ════
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_gerar_pagar(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; d record;
  v_forn uuid; v_hash text; v_ref text; v_pid uuid;
  v_ndup int := 0; v_criadas int := 0; v_total numeric := 0; v_cnpj text;
  v_categoria text; v_ncat int := 0;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nfe nao encontrada'); END IF;
  IF v.lancado_pagar THEN RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'fornecedor_id', v.fornecedor_id); END IF;

  -- categoria: predominante dos itens (por valor) → categoria da nota → NUNCA um literal
  SELECT categoria_codigo INTO v_categoria FROM (
    SELECT categoria_codigo, sum(COALESCE(valor_total,0)) s FROM erp_nfe_recebidas_itens
     WHERE nfe_recebida_id = v.id AND categoria_codigo IS NOT NULL
     GROUP BY categoria_codigo ORDER BY s DESC LIMIT 1) t;
  v_categoria := COALESCE(v_categoria, v.categoria_codigo);
  SELECT count(DISTINCT categoria_codigo) INTO v_ncat FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id = v.id AND categoria_codigo IS NOT NULL;

  v_cnpj := regexp_replace(COALESCE(v.emitente_cnpj, ''), '\D', '', 'g');
  v_forn := v.fornecedor_id;
  IF v_forn IS NULL AND v_cnpj <> '' THEN
    SELECT id INTO v_forn FROM erp_fornecedores
     WHERE company_id = v.company_id AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_cnpj LIMIT 1;
    IF v_forn IS NULL THEN
      INSERT INTO erp_fornecedores (company_id, nome_fantasia, razao_social, cnpj_cpf, cpf_cnpj, ie, tipo_pessoa, ativo, ref_externa_id, ref_externa_sistema)
      VALUES (v.company_id, COALESCE(v.emitente_razao,'Fornecedor '||v_cnpj), COALESCE(v.emitente_razao,'Fornecedor '||v_cnpj),
              v.emitente_cnpj, v.emitente_cnpj, v.emitente_ie, 'J', true, v.emitente_cnpj, 'nfe_distribuicao')
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
          data_emissao, data_vencimento, data_competencia, status, numero_nf, numero_documento, parcela,
          ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes)
        VALUES (v.company_id, v_forn, v.emitente_razao,
          'NF-e compra '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''),
          v_categoria, d.valor,
          v.data_emissao::date, d.data_vencimento, v.data_emissao::date, 'aberto',
          v.numero, v.chave_acesso, d.numero_dup, v_ref, 'nfe_distribuicao', v_hash, now(),
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
        data_emissao, data_vencimento, data_competencia, status, numero_nf, numero_documento,
        ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes)
      VALUES (v.company_id, v_forn, v.emitente_razao,
        'NF-e compra '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''),
        v_categoria, v.valor_total,
        v.data_emissao::date, COALESCE(v.data_emissao::date, CURRENT_DATE), v.data_emissao::date, 'aberto',
        v.numero, v.chave_acesso, v_ref, 'nfe_distribuicao', v_hash, now(),
        'Gerado automaticamente da NF-e de compra (DF-e), sem duplicatas. Chave '||v.chave_acesso)
      RETURNING id INTO v_pid;
      v_criadas := 1; v_total := COALESCE(v.valor_total, 0);
    END IF;
  END IF;

  UPDATE erp_nfe_recebidas SET lancado_pagar = true, updated_at = now() WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'fornecedor_id', v_forn, 'duplicatas', v_ndup,
    'pagar_criadas', v_criadas, 'valor_total', v_total,
    'categoria', v_categoria, 'categoria_divergente', (v_ncat > 1));
END $function$;

-- ══ E1 · nota concluída (estoque + financeiro num clique, atômico) ══════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_concluir(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v erp_nfe_recebidas%ROWTYPE; v_faltam jsonb; v_est jsonb; v_pag jsonb;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.concluida_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_concluida', true); END IF;

  -- 1) todos os itens resolvidos: vinculados (produto_id) OU marcados como "não entra" (entra_estoque=false)
  SELECT jsonb_agg(jsonb_build_object('item', numero_item, 'descricao', descricao) ORDER BY numero_item)
    INTO v_faltam FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id = v.id AND COALESCE(entra_estoque,false)=true AND produto_id IS NULL;
  IF v_faltam IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'itens_nao_resolvidos', 'faltam', v_faltam); END IF;

  -- 2+3) estoque e financeiro num subbloco atômico: se um falhar, desfaz tudo (nada de meio-concluído)
  BEGIN
    v_est := fn_nfe_recebida_dar_entrada_estoque(v.id);
    IF NOT COALESCE((v_est->>'ok')::boolean,false) THEN RAISE EXCEPTION 'estoque_falhou'; END IF;
    v_pag := fn_nfe_recebida_gerar_pagar(v.id);
    IF NOT COALESCE((v_pag->>'ok')::boolean,false) THEN RAISE EXCEPTION 'financeiro_falhou'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falha_ao_concluir', 'estoque', v_est, 'financeiro', v_pag);
  END;

  UPDATE erp_nfe_recebidas SET concluida_em = now(), concluida_por = auth.uid(), updated_at = now() WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'concluida_em', now(), 'estoque', v_est, 'financeiro', v_pag);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nfe_recebida_concluir(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_concluir(uuid) TO authenticated, service_role;

-- ══ E3 · anexos na NOTA (4º vínculo) — reusa o erp_crm_anexo/<AnexosCard> ════════════════════════════
ALTER TABLE public.erp_crm_anexo
  ADD COLUMN IF NOT EXISTS nfe_recebida_id uuid REFERENCES public.erp_nfe_recebidas(id) ON DELETE CASCADE;
ALTER TABLE public.erp_crm_anexo DROP CONSTRAINT IF EXISTS chk_um_vinculo;
ALTER TABLE public.erp_crm_anexo ADD CONSTRAINT chk_um_vinculo CHECK (
  (proposta_id IS NOT NULL)::int + (oportunidade_id IS NOT NULL)::int
  + (visita_id IS NOT NULL)::int + (nfe_recebida_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS ix_crm_anexo_nfe ON public.erp_crm_anexo (nfe_recebida_id) WHERE deleted_at IS NULL;

-- adicionar: aceita 'nfe' + grava a coluna certa
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_adicionar(
  p_company_id uuid, p_vinculo_tipo text, p_vinculo_id uuid,
  p_tipo text DEFAULT 'arquivo', p_categoria text DEFAULT NULL, p_descricao text DEFAULT NULL,
  p_nome text DEFAULT NULL, p_path text DEFAULT NULL, p_mime text DEFAULT NULL,
  p_tamanho bigint DEFAULT NULL, p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; v_ord int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_vinculo_tipo NOT IN ('proposta','oportunidade','visita','nfe') THEN RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_invalido'); END IF;
  IF p_tipo = 'arquivo' AND NULLIF(btrim(COALESCE(p_path,'')),'') IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_arquivo'); END IF;
  IF p_tipo = 'link'    AND NULLIF(btrim(COALESCE(p_url,'')),'')  IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_url'); END IF;

  SELECT COALESCE(max(ordem),0)+1 INTO v_ord FROM erp_crm_anexo
   WHERE deleted_at IS NULL AND ((p_vinculo_tipo='proposta' AND proposta_id=p_vinculo_id)
      OR (p_vinculo_tipo='oportunidade' AND oportunidade_id=p_vinculo_id)
      OR (p_vinculo_tipo='visita' AND visita_id=p_vinculo_id)
      OR (p_vinculo_tipo='nfe' AND nfe_recebida_id=p_vinculo_id));

  INSERT INTO erp_crm_anexo (company_id, proposta_id, oportunidade_id, visita_id, nfe_recebida_id, tipo, categoria, descricao, ordem,
      nome_arquivo, storage_path, mime_type, tamanho_bytes, url, enviado_por)
  VALUES (p_company_id,
      CASE WHEN p_vinculo_tipo='proposta'     THEN p_vinculo_id END,
      CASE WHEN p_vinculo_tipo='oportunidade' THEN p_vinculo_id END,
      CASE WHEN p_vinculo_tipo='visita'       THEN p_vinculo_id END,
      CASE WHEN p_vinculo_tipo='nfe'          THEN p_vinculo_id END,
      COALESCE(p_tipo,'arquivo'), NULLIF(btrim(COALESCE(p_categoria,'')),''), NULLIF(btrim(COALESCE(p_descricao,'')),''), v_ord,
      NULLIF(btrim(COALESCE(p_nome,'')),''), NULLIF(btrim(COALESCE(p_path,'')),''), NULLIF(btrim(COALESCE(p_mime,'')),''),
      p_tamanho, NULLIF(btrim(COALESCE(p_url,'')),''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ordem', v_ord);
END $fn$;

-- listar: aceita 'nfe'
CREATE OR REPLACE FUNCTION public.fn_crm_anexos_listar(p_vinculo_tipo text, p_vinculo_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object('ok', true, 'anexos', COALESCE(jsonb_agg(a ORDER BY (a->>'ordem')::int, a->>'enviado_em'), '[]'::jsonb))
  FROM (
    SELECT jsonb_build_object('id', x.id, 'tipo', x.tipo, 'categoria', x.categoria, 'descricao', x.descricao,
      'ordem', x.ordem, 'nome_arquivo', x.nome_arquivo, 'storage_path', x.storage_path, 'mime_type', x.mime_type,
      'tamanho_bytes', x.tamanho_bytes, 'url', x.url, 'enviado_em', x.enviado_em) AS a
    FROM erp_crm_anexo x
    WHERE x.deleted_at IS NULL AND x.company_id IN (SELECT get_user_company_ids())
      AND ((p_vinculo_tipo='proposta' AND x.proposta_id=p_vinculo_id)
        OR (p_vinculo_tipo='oportunidade' AND x.oportunidade_id=p_vinculo_id)
        OR (p_vinculo_tipo='visita' AND x.visita_id=p_vinculo_id)
        OR (p_vinculo_tipo='nfe' AND x.nfe_recebida_id=p_vinculo_id))
  ) t;
$fn$;

-- confirmar_lote (ANEXO-2): aceita 'nfe'
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_confirmar_lote(
  p_company_id uuid, p_vinculo_tipo text, p_vinculo_id uuid, p_anexos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a jsonb; v_res jsonb; v_n int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_vinculo_tipo NOT IN ('proposta','oportunidade','visita','nfe') THEN RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_invalido'); END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_anexos,'[]'::jsonb)) LOOP
    BEGIN
      v_res := fn_crm_anexo_adicionar(p_company_id, p_vinculo_tipo, p_vinculo_id,
        COALESCE(NULLIF(a->>'tipo',''),'arquivo'), a->>'categoria', a->>'descricao',
        a->>'nome', a->>'path', a->>'mime', NULLIF(a->>'tamanho','')::bigint, a->>'url');
      IF COALESCE((v_res->>'ok')::boolean, false) THEN v_n := v_n + 1;
      ELSE v_erros := v_erros || jsonb_build_object('nome', a->>'nome', 'erro', COALESCE(v_res->>'erro','falhou')); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros || jsonb_build_object('nome', a->>'nome', 'erro', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'confirmados', v_n, 'erros', v_erros);
END $function$;

-- ══ E6 · produtos com margem negativa (só lista; correção é decisão comercial — RD-55) ══════════════
CREATE OR REPLACE FUNCTION public.fn_nfe_produtos_margem_negativa(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', codigo, 'nome', nome, 'venda', venda, 'custo', custo, 'diferenca', round(custo-venda,2)
    ) ORDER BY (custo-venda) DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT codigo, nome, preco_venda AS venda, COALESCE(NULLIF(preco_custo_medio,0), preco_custo) AS custo
      FROM erp_produtos
     WHERE company_id = p_company_id AND COALESCE(ativo,true)=true
       AND preco_venda > 0 AND COALESCE(NULLIF(preco_custo_medio,0), preco_custo) > 0
       AND preco_venda < COALESCE(NULLIF(preco_custo_medio,0), preco_custo)
  ) t;
  RETURN jsonb_build_object('ok', true, 'total', jsonb_array_length(v_rows), 'produtos', v_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nfe_produtos_margem_negativa(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_produtos_margem_negativa(uuid) TO authenticated, service_role;
