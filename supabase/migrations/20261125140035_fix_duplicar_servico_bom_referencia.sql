-- #11035 (Tryo Gessos · Catálogo de Serviços do Hub) — DUPLICAR SERVIÇO quebrava com "Algum valor está fora do
-- permitido" (erroAmigavel → Postgres 23514, check_violation) quando o BOM tinha item de PRODUTO (material) ou item
-- MANUAL. Causa raiz (provada no dado): fn_projetos_duplicar_servico copiava o BOM só com insumo_id e mao_obra_id;
-- a linha de produto/manual ficava com ZERO referências e violava a constraint
--   bom_uma_referencia = CHECK( (mao_obra_id IS NOT NULL)::int + (insumo_id IS NOT NULL)::int
--                               + (produto_id IS NOT NULL)::int + (item_nome_manual IS NOT NULL)::int = 1 ).
-- Por isso era intermitente: serviço só com insumo/mão de obra duplicava; com material/manual, estourava.
--
-- Conserto: a cópia do BOM passa a incluir produto_id, item_nome_manual, custo_unitario_manual e local_id. O
-- custo_unitario_manual é obrigatório — é o preço do item manual que o fn_projetos_atualizar_cache_bom lê
-- (COALESCE(custo_unitario_manual,0)); sem ele, o item manual duplicaria com custo 0. custo_unitario/custo_total NÃO
-- são copiados (são cache, recalculados logo abaixo). local_id aponta para erp_estoque_locais (nível empresa), então
-- copiar é fiel. Todo o resto da função é BYTE A BYTE a definição VIVA (pg_get_functiondef); nada mais muda
-- (source_type='duplicado', dedup de código, cache + recálculo de custo). CREATE OR REPLACE, aditivo.

CREATE OR REPLACE FUNCTION public.fn_projetos_duplicar_servico(p_servico_id uuid, p_novo_codigo text DEFAULT NULL::text, p_novo_nome text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_novo_id uuid;
  v_orig record;
  v_codigo text;
  v_nome text;
BEGIN
  SELECT * INTO v_orig FROM projetos_servicos WHERE id = p_servico_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servico % nao encontrado', p_servico_id;
  END IF;
  -- check-fn-guards: SECURITY DEFINER que grava confere o acesso a empresa do servico antes de gravar.
  PERFORM public.fn__guarda_empresa(v_orig.company_id);

  -- Sugestao de codigo/nome se nao fornecido
  v_codigo := COALESCE(p_novo_codigo, v_orig.codigo || '-COPIA');
  v_nome := COALESCE(p_novo_nome, v_orig.nome || ' (cópia)');

  -- Garantir que codigo nao colide
  WHILE EXISTS (
    SELECT 1 FROM projetos_servicos
    WHERE company_id = v_orig.company_id AND codigo = v_codigo
  ) LOOP
    v_codigo := v_codigo || '-' || floor(random()*1000)::text;
  END LOOP;

  -- Criar copia
  INSERT INTO projetos_servicos (
    company_id, codigo, nome, descricao, unidade, categoria,
    produtividade_unidade_dia, equipe_padrao,
    is_publico, source_type, observacoes
  ) VALUES (
    v_orig.company_id, v_codigo, v_nome, v_orig.descricao,
    v_orig.unidade, v_orig.categoria,
    v_orig.produtividade_unidade_dia, v_orig.equipe_padrao,
    false, 'duplicado',
    'Duplicado de ' || v_orig.codigo || ' em ' || now()::date
  )
  RETURNING id INTO v_novo_id;

  -- Copiar BOM (inclui produto_id, item_nome_manual, custo_unitario_manual e local_id p/ não violar
  -- bom_uma_referencia e preservar o custo do item manual; custo_unitario/custo_total são cache e são recalculados)
  INSERT INTO projetos_servicos_bom (
    servico_id, tipo, insumo_id, mao_obra_id, produto_id, item_nome_manual, custo_unitario_manual, local_id,
    quantidade, unidade, perda_pct, ordem, observacao
  )
  SELECT
    v_novo_id, tipo, insumo_id, mao_obra_id, produto_id, item_nome_manual, custo_unitario_manual, local_id,
    quantidade, unidade, perda_pct, ordem, observacao
  FROM projetos_servicos_bom
  WHERE servico_id = p_servico_id;

  -- Calcular caches
  PERFORM fn_projetos_atualizar_cache_bom(v_novo_id);
  PERFORM fn_projetos_recalcular_custo_servico(v_novo_id);

  RETURN v_novo_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_duplicar_servico(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_duplicar_servico(uuid,text,text) TO authenticated, service_role;
