-- Chamado #1755 (Gean) · "Criar produto" a partir do item da NF de entrada não levava os dados fiscais da nota.
-- Prova (07/10, Gean): 149 produtos criados de item de NF; 141 itens tinham CEST na nota e NENHUM chegou ao cadastro;
-- 89 itens de origem estrangeira/nacional-com-conteúdo-importado viraram origem '0'; nenhum ficou com CFOP de compra
-- nem unidade de compra. Causa: fn_nfe_item_criar_produto só passava NCM e fixava origem '0'.
-- Agora o produto nasce com o que a nota traz:
--   • CEST do item (fn_erp_produto_salvar já grava 'cest');
--   • origem do item; numa compra no mercado interno a origem 1 (importação direta, do importador) vira 2
--     (estrangeira adquirida no mercado interno) e 6 vira 7 — tabela A da origem da mercadoria (CST ICMS);
--   • cfop_compra = CFOP de entrada já convertido (cfop_entrada) e unidade_compra = unidade da nota.
-- Só a criação NOVA muda; produtos já existentes não são tocados aqui (acerto dos 149 da Gean é decisão à parte).
-- Mesma assinatura, mesma guarda de acesso, mesmos grants (CREATE OR REPLACE preserva).

CREATE OR REPLACE FUNCTION public.fn_nfe_item_criar_produto(p_item_id uuid, p_dados jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_company uuid; v_codigo text; v_dados jsonb; v_res jsonb; v_novo uuid; v_origem text;
BEGIN
  SELECT i.*, n.company_id AS n_company
    INTO r FROM erp_nfe_recebidas_itens i JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item nao encontrado'); END IF;
  v_company := r.n_company;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao'); END IF;
  IF r.produto_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item ja vinculado', 'produto_id', r.produto_id); END IF;

  -- código do produto: usa o passado, senão o cProd; evita colisão com código já existente na empresa
  v_codigo := COALESCE(NULLIF(btrim(p_dados->>'codigo'),''), NULLIF(btrim(r.codigo_produto),''),
                       'NF-' || left(replace(p_item_id::text,'-',''), 8));
  IF EXISTS (SELECT 1 FROM erp_produtos WHERE company_id = v_company AND upper(btrim(codigo)) = upper(btrim(v_codigo))) THEN
    v_codigo := v_codigo || '-' || left(replace(p_item_id::text,'-',''), 4);
  END IF;

  -- #1755 · origem: a informada, senão a da nota (1→2 e 6→7: quem compra no mercado interno não é o importador), senão '0'
  v_origem := COALESCE(NULLIF(btrim(p_dados->>'origem'),''),
                       CASE btrim(COALESCE(r.origem,'')) WHEN '1' THEN '2' WHEN '6' THEN '7' WHEN '' THEN NULL ELSE btrim(r.origem) END,
                       '0');

  v_dados := jsonb_build_object(
    'codigo', v_codigo,
    'nome', COALESCE(NULLIF(btrim(p_dados->>'nome'),''), NULLIF(btrim(r.descricao),''), v_codigo),
    'unidade', COALESCE(NULLIF(btrim(p_dados->>'unidade'),''), NULLIF(btrim(r.unidade),''), 'UN'),
    'tipo_item_sped', COALESCE(NULLIF(btrim(p_dados->>'tipo_item_sped'),''), '00'),
    'ncm', COALESCE(NULLIF(btrim(p_dados->>'ncm'),''), r.ncm),
    'cest', COALESCE(NULLIF(btrim(p_dados->>'cest'),''), NULLIF(regexp_replace(COALESCE(r.cest,''),'\D','','g'),'')),
    'origem', v_origem
  );

  -- cria via função canônica (RD-26 — sem INSERT direto)
  v_res := public.fn_erp_produto_salvar(v_company, v_dados, NULL);
  IF NOT (v_res->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_criou_produto', 'detalhe', v_res); END IF;
  v_novo := (v_res->>'id')::uuid;

  -- enriquece o que a função canônica não cobre: EAN, custo (base do custo médio), CFOP e unidade de compra (#1755)
  UPDATE erp_produtos
     SET codigo_barras  = COALESCE(NULLIF(regexp_replace(COALESCE(r.codigo_barras,''),'\D','','g'),''), codigo_barras),
         preco_custo    = COALESCE(r.valor_unitario, preco_custo),
         cfop_compra    = COALESCE(cfop_compra, NULLIF(regexp_replace(COALESCE(r.cfop_entrada,''),'\D','','g'),'')),
         unidade_compra = COALESCE(unidade_compra, NULLIF(btrim(r.unidade),'')),
         updated_at     = now()
   WHERE id = v_novo AND company_id = v_company;

  -- vincula o item + grava a de-para (reusa a função que já aprende)
  PERFORM public.fn_nfe_item_vincular(p_item_id, v_novo, true);

  RETURN jsonb_build_object('ok', true, 'produto_id', v_novo, 'item_id', p_item_id, 'codigo', v_codigo, 'criado', true);
END $function$;
