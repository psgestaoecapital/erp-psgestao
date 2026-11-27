-- Chamado #11470 ("NÃO ESTÁ SALVANDO AS ALTERAÇÕES") — catálogo de serviços (/dashboard/projetos/catalogo/[id]).
--
-- RAIZ (provada no dado, RD-38): o índice único projetos_servicos_codigo_unico era
--   CREATE UNIQUE INDEX ... ON projetos_servicos (company_id, codigo)   -- SEM filtro de exclusão
-- ou seja, contava também as linhas SOFT-DELETED (deleted_at IS NOT NULL). Serviços excluídos
-- somem da lista (a tela filtra deleted_at IS NULL), mas o código deles continuava "reservado":
-- ao duplicar um serviço e renomear o código para um que só existe num fantasma excluído, o UPDATE
-- caía em 23505 e o usuário via "Não foi possível salvar" sem conseguir entender o porquê.
-- Prova: a empresa do chamado (918c3ea4-…) tem 12 serviços soft-deleted (de 13 no sistema inteiro).
--
-- O índice irmão uq_projetos_servicos_ref_padrao JÁ faz o certo: WHERE deleted_at IS NULL.
-- Alinhamos o índice de código à mesma regra: a unicidade vale só entre serviços VIVOS; o código
-- de um serviço excluído volta a ficar livre, como o usuário espera (ele não vê o excluído).
--
-- Aditiva/idempotente. Tabela pequena (87 linhas); a recriação do índice é instantânea.
-- Não há colisão entre linhas vivas (verificado: 0 grupos (company_id, codigo) com >1 linha viva),
-- então o índice parcial constrói sem erro.

DROP INDEX IF EXISTS public.projetos_servicos_codigo_unico;

CREATE UNIQUE INDEX IF NOT EXISTS projetos_servicos_codigo_unico
  ON public.projetos_servicos (company_id, codigo)
  WHERE (deleted_at IS NULL);

-- A rotina de duplicação também ignorava o soft-delete ao evitar colisão de código: o laço
-- WHILE EXISTS batia nos fantasmas e sujava o código novo com sufixos aleatórios ("-COPIA-473").
-- Alinhamos ao novo índice: só colide com serviço VIVO.
CREATE OR REPLACE FUNCTION public.fn_projetos_duplicar_servico(
  p_servico_id uuid,
  p_novo_codigo text DEFAULT NULL::text,
  p_novo_nome text DEFAULT NULL::text
)
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

  -- Guarda de empresa: o chamador precisa ter acesso à empresa do serviço de origem antes de qualquer
  -- escrita (libera service_role/admin; levanta 42501 para quem não tem acesso).
  PERFORM public.fn__guarda_empresa(v_orig.company_id);

  -- Sugestao de codigo/nome se nao fornecido
  v_codigo := COALESCE(p_novo_codigo, v_orig.codigo || '-COPIA');
  v_nome := COALESCE(p_novo_nome, v_orig.nome || ' (cópia)');

  -- Garantir que codigo nao colide com um serviço VIVO (excluídos não reservam código — alinhado
  -- ao índice parcial projetos_servicos_codigo_unico WHERE deleted_at IS NULL).
  WHILE EXISTS (
    SELECT 1 FROM projetos_servicos
    WHERE company_id = v_orig.company_id AND codigo = v_codigo AND deleted_at IS NULL
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

-- check_fn_guards (Regra 1): toda migration que recria função SECURITY DEFINER reinclui o REVOKE
-- explícito, ancorado na assinatura, espelhando a ACL viva (authenticated, service_role; anon já
-- não tem EXECUTE). O CREATE OR REPLACE acima não reabre nada — estas linhas apenas tornam a ACL explícita.
REVOKE ALL ON FUNCTION public.fn_projetos_duplicar_servico(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_duplicar_servico(uuid, text, text) TO authenticated, service_role;
