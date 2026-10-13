-- Revenda de Veículos · Ondas 1-2 · RPCs + view do pátio.
-- Situação só muda por RPC (com evento). Custo dispara erp_pagar via ref_externa (opcional).
-- Dias em pátio e custo acumulado são DERIVADOS (view security_invoker), nunca coluna (RD-52).

-- criar veículo + evento de entrada (autor no evento — resolve movimentações sem autor §2.2)
CREATE OR REPLACE FUNCTION public.fn_veic_criar(p_company_id uuid, p_veiculo jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_chassi text := NULLIF(trim(p_veiculo->>'chassi'), '');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_chassi IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'chassi_obrigatorio'); END IF;
  IF EXISTS (SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND chassi = v_chassi AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chassi_ja_cadastrado'); END IF;

  -- colunas explícitas (situacao/data_entrada/ativo/created_at usam DEFAULT quando ausentes)
  INSERT INTO veic_veiculo (company_id, chassi, placa, renavam, marca, modelo, versao,
      ano_fabricacao, ano_modelo, cor, combustivel, potencia_cv, cilindradas, portas, cambio,
      km_entrada, km_atual, origem, data_entrada, fornecedor_id, fornecedor_nome, valor_aquisicao,
      foto_url, observacao, created_by, updated_by)
  VALUES (p_company_id, v_chassi, NULLIF(p_veiculo->>'placa',''), NULLIF(p_veiculo->>'renavam',''),
      p_veiculo->>'marca', p_veiculo->>'modelo', p_veiculo->>'versao',
      (p_veiculo->>'ano_fabricacao')::int, (p_veiculo->>'ano_modelo')::int, p_veiculo->>'cor',
      p_veiculo->>'combustivel', (p_veiculo->>'potencia_cv')::numeric, (p_veiculo->>'cilindradas')::numeric,
      (p_veiculo->>'portas')::int, p_veiculo->>'cambio', (p_veiculo->>'km_entrada')::numeric,
      (p_veiculo->>'km_atual')::numeric, NULLIF(p_veiculo->>'origem',''),
      COALESCE((p_veiculo->>'data_entrada')::date, CURRENT_DATE), NULLIF(p_veiculo->>'fornecedor_id','')::uuid,
      p_veiculo->>'fornecedor_nome', (p_veiculo->>'valor_aquisicao')::numeric,
      p_veiculo->>'foto_url', p_veiculo->>'observacao', p_user, p_user)
  RETURNING id INTO v_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (p_company_id, v_id, 'entrada', 'Veículo cadastrado', p_user, jsonb_build_object('situacao', 'em_preparacao'));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- mudar situação (único caminho — a tela não escreve direto) + evento
CREATE OR REPLACE FUNCTION public.fn_veic_mudar_situacao(p_veiculo_id uuid, p_nova text, p_user uuid, p_obs text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_atual text;
BEGIN
  SELECT company_id, situacao INTO v_comp, v_atual FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_nova NOT IN ('em_preparacao','disponivel','reservado','vendido','entregue','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida'); END IF;
  IF p_nova = v_atual THEN RETURN jsonb_build_object('ok', true, 'situacao', v_atual, 'sem_mudanca', true); END IF;

  UPDATE veic_veiculo SET situacao = p_nova, updated_by = p_user WHERE id = p_veiculo_id;
  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'situacao', COALESCE(p_obs, 'Situação: ' || v_atual || ' → ' || p_nova), p_user,
          jsonb_build_object('de', v_atual, 'para', p_nova));
  RETURN jsonb_build_object('ok', true, 'situacao', p_nova);
END $function$;

-- salvar custo + evento + (opcional) título em erp_pagar pelo gancho ref_externa
CREATE OR REPLACE FUNCTION public.fn_veic_custo_salvar(
  p_veiculo_id uuid, p_custo jsonb, p_gerar_pagar boolean, p_vencimento date, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_modelo text; v_placa text; v_custo_id uuid; v_pagar_id uuid;
        v_cat text := p_custo->>'categoria'; v_valor numeric := (p_custo->>'valor')::numeric;
BEGIN
  SELECT company_id, modelo, placa INTO v_comp, v_modelo, v_placa FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_gerar_pagar AND p_vencimento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo'); END IF;

  IF p_gerar_pagar THEN
    INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                           fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
    VALUES (v_comp, v_valor,
            v_cat || ' — ' || COALESCE(v_modelo, '') || ' ' || COALESCE(v_placa, ''),
            p_vencimento, COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE), v_cat,
            NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
            'revenda_veiculos', p_veiculo_id::text)
    RETURNING id INTO v_pagar_id;
  END IF;

  -- entra_base_fiscal fica NULL quando ausente (aguarda contador §3.2)
  INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_id,
      fornecedor_nome, data_custo, entra_base_fiscal, pagar_id, documento, observacao, created_by)
  VALUES (v_comp, p_veiculo_id, v_cat, p_custo->>'descricao', v_valor,
      NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
      COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE),
      CASE WHEN (p_custo->>'entra_base_fiscal') IS NOT NULL THEN (p_custo->>'entra_base_fiscal')::boolean ELSE NULL END,
      v_pagar_id, p_custo->>'documento', p_custo->>'observacao', p_user)
  RETURNING id INTO v_custo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'custo', 'Custo: ' || v_cat || ' R$ ' || v_valor::text, p_user,
          jsonb_build_object('categoria', v_cat, 'valor', v_valor, 'pagar_id', v_pagar_id));

  RETURN jsonb_build_object('ok', true, 'custo_id', v_custo_id, 'pagar_id', v_pagar_id);
END $function$;

-- excluir custo (soft-delete) — NÃO exclui o título; devolve se havia, p/ a tela avisar (§5#4)
CREATE OR REPLACE FUNCTION public.fn_veic_custo_excluir(p_custo_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_pagar uuid;
BEGIN
  SELECT company_id, veiculo_id, pagar_id INTO v_comp, v_veic, v_pagar FROM veic_custo WHERE id = p_custo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'custo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_custo SET deleted_at = now() WHERE id = p_custo_id;
  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, v_veic, 'custo_excluido', 'Custo excluído', p_user, jsonb_build_object('custo_id', p_custo_id, 'pagar_id', v_pagar));
  RETURN jsonb_build_object('ok', true, 'tinha_titulo', v_pagar IS NOT NULL, 'pagar_id', v_pagar);
END $function$;

-- view do pátio: dias parados + custo acumulado + semáforo (faixas da empresa) — tudo derivado
CREATE OR REPLACE VIEW public.v_veic_patio WITH (security_invoker=on) AS
SELECT v.id, v.company_id, v.chassi, v.placa, v.marca, v.modelo, v.versao, v.ano_modelo, v.cor,
       v.situacao, v.origem, v.data_entrada, v.foto_url, v.valor_aquisicao,
       (CURRENT_DATE - v.data_entrada) AS dias_patio,
       (COALESCE(v.valor_aquisicao, 0) + COALESCE((SELECT SUM(c.valor) FROM veic_custo c WHERE c.veiculo_id = v.id AND c.deleted_at IS NULL), 0)) AS custo_acumulado,
       COALESCE(cfg.margem_alvo_pct, 20) AS margem_alvo_pct,
       CASE
         WHEN (CURRENT_DATE - v.data_entrada) <= COALESCE(cfg.semaforo_verde_ate_dias, 30) THEN 'verde'
         WHEN (CURRENT_DATE - v.data_entrada) <= COALESCE(cfg.semaforo_amarelo_ate_dias, 60) THEN 'amarelo'
         ELSE 'vermelho' END AS semaforo
FROM public.veic_veiculo v
LEFT JOIN public.veic_config cfg ON cfg.company_id = v.company_id
WHERE v.deleted_at IS NULL;

REVOKE ALL ON FUNCTION public.fn_veic_criar(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_mudar_situacao(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_custo_salvar(uuid, jsonb, boolean, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_custo_excluir(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_veic_criar(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_mudar_situacao(uuid, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_salvar(uuid, jsonb, boolean, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_excluir(uuid, uuid) TO authenticated, service_role;
GRANT SELECT ON public.v_veic_patio TO authenticated, service_role;
