-- RD-38 · Guarda de tenant na família fn_projetos_* do catálogo (mesma classe do IDOR de
-- fn_projetos_duplicar_servico). Cada função abaixo é SECURITY DEFINER, grava (INSERT/UPDATE/DELETE)
-- e localizava o alvo só por id/parâmetro, SEM conferir se quem chama pertence à empresa escrita.
--
-- Diretamente exploráveis por qualquer usuário logado (GRANT authenticated):
--   · fn_projetos_atualizar_preco_insumo  — UPDATE do custo de QUALQUER insumo (dispara recálculo dos
--     serviços da empresa alheia);
--   · fn_projetos_deletar_mao_obra         — DELETE de mão de obra de QUALQUER empresa.
-- Defesa em profundidade (hoje só service_role, mas recebem company_id/id vindos do cliente via edge):
--   · fn_projetos_fork_servico, fn_projetos_atualizar_catalogo_publico_empresa,
--     fn_projetos_sincronizar_catalogo_publico — injetam/sobrescrevem linhas na empresa p_company_id.
--
-- Correção uniforme e ADITIVA: PERFORM public.fn__guarda_empresa(<empresa do write>) antes de gravar.
-- O conferidor canônico libera service_role/admin e sessão sem auth.uid(); levanta 42501 p/ usuário de
-- outra empresa. Corpo idêntico ao vivo salvo a linha de guarda. Nenhum dado de cliente é apagado/alterado.
-- GRANTs preservados exatamente como estão hoje (surface inalterado) + REVOKE PUBLIC/anon (régua fn-guards).

-- 1) UPDATE de custo de insumo — guarda a empresa do REGISTRO ---------------------------------------
CREATE OR REPLACE FUNCTION public.fn_projetos_atualizar_preco_insumo(p_insumo_id uuid, p_novo_preco numeric, p_data_compra date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_insumo record;
BEGIN
  SELECT * INTO v_insumo FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insumo nao encontrado');
  END IF;

  -- Guarda de tenant: só altera preço de insumo de empresa a que o usuário tem acesso.
  PERFORM public.fn__guarda_empresa(v_insumo.company_id);

  -- Mover preco atual para last_cost antes de atualizar
  UPDATE m16_insumos
  SET last_cost = current_cost,
      current_cost = p_novo_preco,
      last_purchase_date = p_data_compra,
      updated_at = now()
  WHERE id = p_insumo_id;

  -- Trigger fn_trg_insumo_custo_alterado vai recalcular servicos automaticamente

  RETURN jsonb_build_object(
    'success', true,
    'insumo', v_insumo.name,
    'preco_anterior', v_insumo.current_cost,
    'preco_novo', p_novo_preco,
    'variacao_pct', CASE WHEN v_insumo.current_cost > 0
      THEN round(((p_novo_preco - v_insumo.current_cost) / v_insumo.current_cost * 100)::numeric, 1)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_atualizar_preco_insumo(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_atualizar_preco_insumo(uuid, numeric, date) TO authenticated, service_role;

-- 2) DELETE de mão de obra — guarda a empresa do REGISTRO ------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_projetos_deletar_mao_obra(p_mo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_mo record;
  v_em_uso int;
BEGIN
  SELECT * INTO v_mo FROM projetos_mao_obra WHERE id = p_mo_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'MO nao encontrada');
  END IF;

  -- Guarda de tenant: só deleta mão de obra de empresa a que o usuário tem acesso.
  PERFORM public.fn__guarda_empresa(v_mo.company_id);

  IF v_mo.is_publico THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nao eh permitido deletar MO publica');
  END IF;

  SELECT count(DISTINCT servico_id) INTO v_em_uso
  FROM projetos_servicos_bom WHERE mao_obra_id = p_mo_id;

  IF v_em_uso > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('MO em uso por %s servicos. Desative ao inves de deletar.', v_em_uso),
      'qtd_servicos_uso', v_em_uso
    );
  END IF;

  INSERT INTO audit_log_global (tabela, operacao, registro_id, dados_anteriores, executado_em, executado_por)
  VALUES ('projetos_mao_obra', 'DELETE', p_mo_id::text, to_jsonb(v_mo), now(), COALESCE(auth.uid()::text, 'service'));

  DELETE FROM projetos_mao_obra WHERE id = p_mo_id;

  RETURN jsonb_build_object('success', true, 'deletado', v_mo.funcao);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_deletar_mao_obra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_deletar_mao_obra(uuid) TO authenticated, service_role;

-- 3) fork de serviço público -> empresa destino — guarda a empresa DESTINO --------------------------
CREATE OR REPLACE FUNCTION public.fn_projetos_fork_servico(p_servico_publico_id uuid, p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_novo_id uuid;
  v_servico_publico record;
  v_codigo_novo text;
  v_existe int;
BEGIN
  -- Guarda de tenant: só forka para empresa a que o usuário tem acesso.
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- Validar que origem eh publica
  SELECT * INTO v_servico_publico
  FROM projetos_servicos
  WHERE id = p_servico_publico_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servico publico % nao encontrado', p_servico_publico_id;
  END IF;

  IF NOT v_servico_publico.is_publico THEN
    RAISE EXCEPTION 'Servico % nao eh publico - nao pode ser forkado', p_servico_publico_id;
  END IF;

  -- Gerar codigo unico para a empresa (evita conflito)
  v_codigo_novo := v_servico_publico.codigo;
  SELECT count(*) INTO v_existe
  FROM projetos_servicos
  WHERE company_id = p_company_id AND codigo = v_codigo_novo;

  IF v_existe > 0 THEN
    v_codigo_novo := v_codigo_novo || '-CUSTOM';
  END IF;

  -- Clonar servico para empresa
  INSERT INTO projetos_servicos (
    company_id, codigo, nome, descricao, unidade, categoria,
    custo_material, custo_mao_obra, custo_equipamento, custo_unitario_total,
    produtividade_unidade_dia, equipe_padrao,
    is_publico, forked_from, source_type, source_ref,
    versao, observacoes
  ) VALUES (
    p_company_id, v_codigo_novo, v_servico_publico.nome, v_servico_publico.descricao,
    v_servico_publico.unidade, v_servico_publico.categoria,
    v_servico_publico.custo_material, v_servico_publico.custo_mao_obra,
    v_servico_publico.custo_equipamento, v_servico_publico.custo_unitario_total,
    v_servico_publico.produtividade_unidade_dia, v_servico_publico.equipe_padrao,
    false,  -- empresa privada
    p_servico_publico_id,  -- referencia origem
    'fork',
    'forked-from-' || p_servico_publico_id::text,
    1,
    'Forkado do catalogo publico em ' || now()::date::text
  )
  RETURNING id INTO v_novo_id;

  -- Clonar BOM do servico publico para o novo
  INSERT INTO projetos_servicos_bom (
    servico_id, tipo, insumo_id, mao_obra_id,
    quantidade, unidade, custo_unitario, custo_total, perda_pct, ordem, observacao
  )
  SELECT
    v_novo_id, bom.tipo, bom.insumo_id, bom.mao_obra_id,
    bom.quantidade, bom.unidade, bom.custo_unitario, bom.custo_total,
    bom.perda_pct, bom.ordem, bom.observacao
  FROM projetos_servicos_bom bom
  WHERE bom.servico_id = p_servico_publico_id;

  -- Recalcular custo do servico clonado
  PERFORM fn_projetos_recalcular_custo_servico(v_novo_id);

  RETURN v_novo_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_fork_servico(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_fork_servico(uuid, uuid) TO service_role;

-- 4) importar catálogo público -> empresa — guarda a empresa DESTINO -------------------------------
CREATE OR REPLACE FUNCTION public.fn_projetos_atualizar_catalogo_publico_empresa(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_insumos_novos int := 0;
  v_mo_novos int := 0;
  v_servicos_novos int := 0;
  v_servico_publico record;
  v_novo_servico_id uuid;
BEGIN
  -- Guarda de tenant: só importa para empresa a que o usuário tem acesso.
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- Insumos novos
  INSERT INTO m16_insumos (
    company_id, erp_code, name, unit, category, current_cost,
    status, source, source_type, source_ref, observacoes, forked_from
  )
  SELECT
    p_company_id,
    pub.erp_code || '-' || substr(p_company_id::text, 1, 8),
    pub.name, pub.unit, pub.category, pub.current_cost,
    'ativo', 'publico', 'fork',
    'forked-from-' || pub.id::text,
    COALESCE(pub.observacoes, '') || ' [Importado em ' || now()::date || ']',
    pub.id
  FROM m16_insumos pub
  WHERE pub.is_publico = true
    AND NOT EXISTS (
      SELECT 1 FROM m16_insumos x
      WHERE x.company_id = p_company_id AND x.forked_from = pub.id
    );
  GET DIAGNOSTICS v_insumos_novos = ROW_COUNT;

  -- MO novas
  INSERT INTO projetos_mao_obra (
    company_id, funcao, codigo, descricao, custo_hora, custo_mes,
    encargos_pct, tipo_contratacao, observacoes, forked_from, source_ref
  )
  SELECT
    p_company_id, pub.funcao,
    pub.codigo || '-' || substr(p_company_id::text, 1, 8),
    pub.descricao, pub.custo_hora, pub.custo_mes,
    pub.encargos_pct, pub.tipo_contratacao,
    COALESCE(pub.observacoes, ''), pub.id, pub.source_ref
  FROM projetos_mao_obra pub
  WHERE pub.is_publico = true
    AND NOT EXISTS (
      SELECT 1 FROM projetos_mao_obra x
      WHERE x.company_id = p_company_id AND x.forked_from = pub.id
    );
  GET DIAGNOSTICS v_mo_novos = ROW_COUNT;

  -- Servicos novos com BOM
  FOR v_servico_publico IN
    SELECT * FROM projetos_servicos
    WHERE is_publico = true
      AND NOT EXISTS (
        SELECT 1 FROM projetos_servicos s
        WHERE s.company_id = p_company_id AND s.forked_from = projetos_servicos.id
      )
    ORDER BY codigo
  LOOP
    INSERT INTO projetos_servicos (
      company_id, codigo, nome, descricao, unidade, categoria,
      produtividade_unidade_dia, equipe_padrao,
      is_publico, forked_from, source_type, source_ref, observacoes
    ) VALUES (
      p_company_id, v_servico_publico.codigo,
      v_servico_publico.nome, v_servico_publico.descricao,
      v_servico_publico.unidade, v_servico_publico.categoria,
      v_servico_publico.produtividade_unidade_dia, v_servico_publico.equipe_padrao,
      false, v_servico_publico.id, 'fork',
      'forked-from-' || v_servico_publico.id::text,
      'Importado da biblioteca publica em ' || now()::date
    )
    RETURNING id INTO v_novo_servico_id;

    INSERT INTO projetos_servicos_bom (
      servico_id, tipo, insumo_id, mao_obra_id,
      quantidade, unidade, perda_pct, ordem, observacao
    )
    SELECT
      v_novo_servico_id, bom_pub.tipo,
      CASE WHEN bom_pub.tipo IN ('insumo', 'equipamento') THEN
        (SELECT i.id FROM m16_insumos i
         WHERE i.company_id = p_company_id AND i.forked_from = bom_pub.insumo_id
         LIMIT 1)
      END,
      CASE WHEN bom_pub.tipo = 'mao_obra' THEN
        (SELECT mo.id FROM projetos_mao_obra mo
         WHERE mo.company_id = p_company_id AND mo.forked_from = bom_pub.mao_obra_id
         LIMIT 1)
      END,
      bom_pub.quantidade, bom_pub.unidade, bom_pub.perda_pct, bom_pub.ordem,
      'Importado'
    FROM projetos_servicos_bom bom_pub
    WHERE bom_pub.servico_id = v_servico_publico.id;

    PERFORM fn_projetos_atualizar_cache_bom(v_novo_servico_id);
    PERFORM fn_projetos_recalcular_custo_servico(v_novo_servico_id);

    v_servicos_novos := v_servicos_novos + 1;
  END LOOP;

  -- Atualizar timestamp
  UPDATE projetos_modulo_config
  SET importou_catalogo_em = now()
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'novos_importados', jsonb_build_object(
      'insumos', v_insumos_novos,
      'mao_obra', v_mo_novos,
      'servicos', v_servicos_novos
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_atualizar_catalogo_publico_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_atualizar_catalogo_publico_empresa(uuid) TO service_role;

-- 5) sincronizar catálogo público -> empresa (modo aplicar grava) — guarda a empresa --------------
CREATE OR REPLACE FUNCTION public.fn_projetos_sincronizar_catalogo_publico(p_company_id uuid, p_modo text DEFAULT 'preview'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_insumos_atualizar jsonb := '[]'::jsonb;
  v_mo_atualizar jsonb := '[]'::jsonb;
  v_insumos_aplicado int := 0;
  v_mo_aplicado int := 0;
  v_item record;
BEGIN
  -- Guarda de tenant: só sincroniza empresa a que o usuário tem acesso (aplicar grava).
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- Insumos: detectar quais foram customizados vs intactos
  FOR v_item IN
    SELECT
      empresa.id AS empresa_id, empresa.name AS empresa_nome, empresa.current_cost AS preco_empresa,
      pub.current_cost AS preco_publico,
      empresa.forked_from
    FROM m16_insumos empresa
    JOIN m16_insumos pub ON pub.id = empresa.forked_from
    WHERE empresa.company_id = p_company_id
      AND empresa.forked_from IS NOT NULL
      AND empresa.current_cost != pub.current_cost  -- difere
  LOOP
    IF v_item.preco_empresa = v_item.preco_publico THEN
      CONTINUE;
    END IF;

    v_insumos_atualizar := v_insumos_atualizar || jsonb_build_object(
      'id', v_item.empresa_id,
      'nome', v_item.empresa_nome,
      'preco_atual_empresa', v_item.preco_empresa,
      'preco_novo_publico', v_item.preco_publico,
      'diff', round((v_item.preco_publico - v_item.preco_empresa)::numeric, 2)
    );

    IF p_modo = 'aplicar' THEN
      UPDATE m16_insumos
      SET current_cost = v_item.preco_publico,
          updated_at = now()
      WHERE id = v_item.empresa_id
        AND COALESCE(observacoes, '') NOT ILIKE '%[customizado]%';

      IF FOUND THEN v_insumos_aplicado := v_insumos_aplicado + 1; END IF;
    END IF;
  END LOOP;

  -- Mao de obra: mesma logica
  FOR v_item IN
    SELECT
      empresa.id AS empresa_id, empresa.funcao AS empresa_nome, empresa.custo_hora AS preco_empresa,
      pub.custo_hora AS preco_publico
    FROM projetos_mao_obra empresa
    JOIN projetos_mao_obra pub ON pub.id = empresa.forked_from
    WHERE empresa.company_id = p_company_id
      AND empresa.forked_from IS NOT NULL
      AND empresa.custo_hora != pub.custo_hora
  LOOP
    v_mo_atualizar := v_mo_atualizar || jsonb_build_object(
      'id', v_item.empresa_id,
      'funcao', v_item.empresa_nome,
      'preco_atual_empresa', v_item.preco_empresa,
      'preco_novo_publico', v_item.preco_publico,
      'diff', round((v_item.preco_publico - v_item.preco_empresa)::numeric, 2)
    );

    IF p_modo = 'aplicar' THEN
      UPDATE projetos_mao_obra
      SET custo_hora = v_item.preco_publico,
          updated_at = now()
      WHERE id = v_item.empresa_id
        AND COALESCE(observacoes, '') NOT ILIKE '%[customizado]%';

      IF FOUND THEN v_mo_aplicado := v_mo_aplicado + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'modo', p_modo,
    'mudancas_disponiveis', jsonb_build_object(
      'insumos', jsonb_array_length(v_insumos_atualizar),
      'mao_obra', jsonb_array_length(v_mo_atualizar)
    ),
    'aplicados', CASE WHEN p_modo='aplicar' THEN
      jsonb_build_object('insumos', v_insumos_aplicado, 'mao_obra', v_mo_aplicado)
    ELSE NULL END,
    'detalhes_insumos', v_insumos_atualizar,
    'detalhes_mao_obra', v_mo_atualizar
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_sincronizar_catalogo_publico(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_sincronizar_catalogo_publico(uuid, text) TO service_role;
