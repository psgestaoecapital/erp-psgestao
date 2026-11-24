-- RD-38 · Correção de IDOR cross-tenant WRITE em fn_projetos_duplicar_servico.
--
-- Defeito (escalado ao CEO 24/11): a função é SECURITY DEFINER e carrega o serviço de origem
-- SÓ por id (projetos_servicos.id), SEM conferir se quem chama pertence à empresa daquele serviço.
-- Como ela INSERE a cópia (serviço + BOM) em v_orig.company_id, qualquer usuário autenticado podia
-- passar o id de um serviço de OUTRA empresa e injetar linhas na empresa alheia (write cross-tenant),
-- além de inferir código/nome do serviço vizinho pelo laço anti-colisão.
--
-- Correção mínima e ADITIVA: confere o acesso à empresa do REGISTRO logo após localizá-lo, com o
-- conferidor canônico public.fn__guarda_empresa (libera service_role/admin e sessão sem auth.uid();
-- bloqueia usuário de outra empresa com 42501). Nenhum dado de cliente é apagado/alterado.
--
-- Prova RD-38 (BEGIN…ROLLBACK, statement_timeout curto) rodada na revisão: com um serviço de empresa
-- A e sessão simulada de empresa B, a chamada passa a levantar 42501 (antes copiava para A).

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

  -- Guarda de tenant: só duplica serviço de empresa a que o usuário tem acesso (bloqueia IDOR cross-tenant).
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

REVOKE ALL ON FUNCTION public.fn_projetos_duplicar_servico(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_duplicar_servico(uuid, text, text) TO authenticated, service_role;
