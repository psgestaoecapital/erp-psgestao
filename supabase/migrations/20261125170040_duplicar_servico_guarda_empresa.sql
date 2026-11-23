-- conserto-main (RD-94 · segurança núcleo · code-desenvolvedor-3): fn_projetos_duplicar_servico
-- fechava o acesso à empresa (IDOR de escrita cross-tenant).
--
-- CAUSA (provada): a #5953 (migration 20261125170035, autoria desta mesma rotina) recriou
-- fn_projetos_duplicar_servico para copiar o BOM de produto/manual, mas a função — SECURITY DEFINER,
-- logo FORA do RLS — lê `projetos_servicos WHERE id = p_servico_id` a partir de um id vindo do CLIENTE
-- SEM conferir que o serviço é de uma empresa do usuário, e em seguida INSERE a cópia em
-- projetos_servicos / projetos_servicos_bom com o company_id do ORIGINAL. Um usuário logado podia
-- duplicar o serviço PRIVADO de OUTRA empresa só passando o uuid → escrita cross-tenant (check_fn_guards
-- regra 4 · grava_sem_guarda_empresa). A tela que chama (src/app/dashboard/projetos/catalogo/page.tsx)
-- só lista serviços da PRÓPRIA empresa (is_publico=false, company_id=companyId), então a guarda não
-- muda o fluxo real; só fecha a chamada direta à RPC.
--
-- FIX (aditivo, CREATE OR REPLACE lido da definição VIVA de 20261125170035): acrescenta
-- PERFORM public.fn__guarda_empresa(v_orig.company_id) logo após carregar o original. fn__guarda_empresa
-- é no-op para service_role (auth.uid() NULL) e admin; para o usuário logado, exige que a empresa do
-- registro esteja em get_user_company_ids() (senão 42501). Nada mais muda: cópia do BOM, caches, REVOKE/GRANT.
--
-- Ordena DEPOIS de 20261125170035 (banda :40 do dev-3) para a guarda não ser sobrescrita pela versão sem guarda.
-- Não toca dado de cliente. Prova RD-38 (cópia local / @pos): usuário da empresa A não duplica serviço da B
-- (42501); usuário duplica o PRÓPRIO serviço normalmente (BOM de produto/manual preservado, 23514 segue resolvido).

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

  -- Guarda de empresa (conserto-main): o serviço de origem tem de ser de uma empresa do usuário.
  -- SECURITY DEFINER fura o RLS; sem isto a RPC duplica serviço privado de outra empresa (IDOR de escrita).
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
