-- conserto-main · check_fn_guards VERMELHO na main (bloqueia a fila para toda PR que já contém a
-- migration 20261125140035). A função SECURITY DEFINER fn_projetos_duplicar_servico LÊ o serviço de
-- origem por id SEM conferir o acesso do chamador à empresa do registro e então GRAVA uma cópia para
-- essa empresa (INSERT em projetos_servicos e projetos_servicos_bom) -> [grava_sem_guarda_empresa].
-- Risco real: um usuário autenticado poderia passar o id de um serviço de OUTRA empresa e duplicá-lo.
--
-- Conserto (aditivo, mínimo): logo após carregar v_orig (e a guarda de NOT FOUND), conferimos a empresa
-- do registro com public.fn__guarda_empresa(v_orig.company_id) — que libera service_role/admin e levanta
-- 42501 para quem não tem acesso à empresa. Nada mais muda: o corpo é BYTE A BYTE a definição viva
-- (a mesma da 20261125140035), apenas com a linha de guarda acrescentada. CREATE OR REPLACE; REVOKE/GRANT
-- reaplicados (a ACL é resetada no replace).

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

  -- Guarda de empresa: o chamador precisa ter acesso à empresa do serviço de origem antes de qualquer
  -- escrita (libera service_role/admin; levanta 42501 para quem não tem acesso).
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
