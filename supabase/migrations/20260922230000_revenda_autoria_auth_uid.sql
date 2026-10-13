-- Higiene de autoria (Revenda) — a autoria de quem age vem do servidor (auth.uid()), nunca de um
-- parâmetro passado pelo cliente (p_user), que é falsificável. Padroniza as 13 funções de escrita da
-- Revenda que ainda gravavam created_by/updated_by/criado_por/aprovado_por/usuario_id a partir de p_user.
--
-- Regras: assinaturas INALTERADAS (p_user continua aceito, porém IGNORADO para autoria) — nenhum chamador
-- quebra. Cada função deriva `v_autor := auth.uid()` e grava isso. As chamadas internas
-- (fn_veic_reserva_criar/fn_veic_venda_registrar → fn_veic_mudar_situacao) passam v_autor, e o callee
-- também usa o próprio auth.uid(); é o mesmo usuário da sessão. SECURITY DEFINER sem anon (CEO / #1681).
--
-- FORA DESTE LOTE (de propósito): fn_nfse_cancelar — é chamada do servidor via supabaseAdmin (service_role,
-- sem auth.uid()) com o userId já resolvido pela rota; trocar por auth.uid() zeraria cancelado_por (RD-38).

-- ── fn_veic_criar ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_criar(p_company_id uuid, p_veiculo jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_chassi text := NULLIF(trim(p_veiculo->>'chassi'), ''); v_autor uuid := auth.uid();
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
      p_veiculo->>'foto_url', p_veiculo->>'observacao', v_autor, v_autor)
  RETURNING id INTO v_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (p_company_id, v_id, 'entrada', 'Veículo cadastrado', v_autor, jsonb_build_object('situacao', 'em_preparacao'));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- ── fn_veic_custo_salvar ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_custo_salvar(p_veiculo_id uuid, p_custo jsonb, p_gerar_pagar boolean, p_vencimento date, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_modelo text; v_placa text; v_custo_id uuid; v_pagar_id uuid;
        v_cat text := NULLIF(btrim(p_custo->>'categoria'),''); v_desc text := NULLIF(btrim(p_custo->>'descricao'),''); v_valor numeric;
        v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, modelo, placa INTO v_comp, v_modelo, v_placa FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- parse seguro: valor inválido/não-numérico nunca chega ao banco (defesa em profundidade)
  BEGIN v_valor := NULLIF(btrim(p_custo->>'valor'),'')::numeric; EXCEPTION WHEN others THEN v_valor := NULL; END;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'valor'); END IF;
  IF v_cat IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'categoria_obrigatoria', 'campo', 'categoria'); END IF;
  IF v_desc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria', 'campo', 'descricao'); END IF;
  IF p_gerar_pagar AND p_vencimento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo', 'campo', 'vencimento'); END IF;

  INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_id,
      fornecedor_nome, data_custo, entra_base_fiscal, documento, observacao, created_by)
  VALUES (v_comp, p_veiculo_id, v_cat, v_desc, v_valor,
      NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
      COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE),
      CASE WHEN (p_custo->>'entra_base_fiscal') IS NOT NULL THEN (p_custo->>'entra_base_fiscal')::boolean ELSE NULL END,
      p_custo->>'documento', p_custo->>'observacao', v_autor)
  RETURNING id INTO v_custo_id;

  IF p_gerar_pagar THEN
    INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                           fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
    VALUES (v_comp, v_valor, v_cat || ' — ' || COALESCE(v_modelo, '') || ' ' || COALESCE(v_placa, ''),
            p_vencimento, COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE), v_cat,
            NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
            'revenda_veiculos', v_custo_id::text)
    RETURNING id INTO v_pagar_id;
    UPDATE veic_custo SET pagar_id = v_pagar_id WHERE id = v_custo_id;
  END IF;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'custo', 'Custo: ' || v_cat || ' R$ ' || v_valor::text, v_autor,
          jsonb_build_object('categoria', v_cat, 'valor', v_valor, 'pagar_id', v_pagar_id));

  RETURN jsonb_build_object('ok', true, 'custo_id', v_custo_id, 'pagar_id', v_pagar_id);
END $function$;

-- ── fn_veic_modelo_aplicar ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_modelo_aplicar(p_company_id uuid, p_modelo_id uuid, p_veiculo_ids uuid[], p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE m veic_modelo_catalogo; v_n int; v_autor uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO m FROM veic_modelo_catalogo WHERE id = p_modelo_id AND company_id = p_company_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'modelo_nao_encontrado'); END IF;

  WITH alvo AS (
    UPDATE veic_veiculo v SET
      combustivel = COALESCE(v.combustivel, m.combustivel),
      potencia_cv = COALESCE(v.potencia_cv, m.potencia_cv),
      cilindradas = COALESCE(v.cilindradas, m.cilindradas),
      portas      = COALESCE(v.portas, m.portas),
      cambio      = COALESCE(v.cambio, m.cambio),
      updated_by = v_autor, updated_at = now()
    WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
      AND (
        (p_veiculo_ids IS NOT NULL AND v.id = ANY(p_veiculo_ids))
        OR (p_veiculo_ids IS NULL AND lower(btrim(COALESCE(v.marca,''))) = lower(m.marca)
                                  AND lower(btrim(COALESCE(v.modelo,''))) = lower(m.modelo))
      )
      -- só toca quem tem ao menos um campo vazio que o modelo preenche (evita update no-op)
      AND (v.combustivel IS NULL OR v.potencia_cv IS NULL OR v.cilindradas IS NULL OR v.portas IS NULL OR v.cambio IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM alvo;

  RETURN jsonb_build_object('ok', true, 'atualizados', v_n);
END $function$;

-- ── fn_veic_modelo_salvar ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_modelo_salvar(p_company_id uuid, p_modelo jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_marca text := NULLIF(btrim(p_modelo->>'marca'),''); v_modelo text := NULLIF(btrim(p_modelo->>'modelo'),'');
        v_autor uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_marca IS NULL OR v_modelo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'marca_e_modelo_obrigatorios'); END IF;

  INSERT INTO veic_modelo_catalogo (company_id, marca, modelo, versao, combustivel, potencia_cv, cilindradas, portas, cambio, created_by, updated_by)
  VALUES (p_company_id, v_marca, v_modelo, NULLIF(btrim(p_modelo->>'versao'),''),
          NULLIF(btrim(p_modelo->>'combustivel'),''), NULLIF(p_modelo->>'potencia_cv','')::numeric,
          NULLIF(p_modelo->>'cilindradas','')::numeric, NULLIF(p_modelo->>'portas','')::int,
          NULLIF(btrim(p_modelo->>'cambio'),''), v_autor, v_autor)
  ON CONFLICT (company_id, lower(marca), lower(modelo), lower(COALESCE(versao,'')))
  DO UPDATE SET combustivel = COALESCE(EXCLUDED.combustivel, veic_modelo_catalogo.combustivel),
                potencia_cv = COALESCE(EXCLUDED.potencia_cv, veic_modelo_catalogo.potencia_cv),
                cilindradas = COALESCE(EXCLUDED.cilindradas, veic_modelo_catalogo.cilindradas),
                portas      = COALESCE(EXCLUDED.portas, veic_modelo_catalogo.portas),
                cambio      = COALESCE(EXCLUDED.cambio, veic_modelo_catalogo.cambio),
                updated_by = v_autor, updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- ── fn_veic_mudar_situacao ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_mudar_situacao(p_veiculo_id uuid, p_nova text, p_user uuid, p_obs text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_atual text; v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, situacao INTO v_comp, v_atual FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_nova NOT IN ('em_preparacao','disponivel','reservado','vendido','entregue','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida'); END IF;
  IF p_nova = v_atual THEN RETURN jsonb_build_object('ok', true, 'situacao', v_atual, 'sem_mudanca', true); END IF;

  UPDATE veic_veiculo SET situacao = p_nova, updated_by = v_autor WHERE id = p_veiculo_id;
  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'situacao', COALESCE(p_obs, 'Situação: ' || v_atual || ' → ' || p_nova), v_autor,
          jsonb_build_object('de', v_atual, 'para', p_nova));
  RETURN jsonb_build_object('ok', true, 'situacao', p_nova);
END $function$;

-- ── fn_veic_negociacao_aprovar ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_aprovar(p_neg_id uuid, p_motivo text, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_autor uuid := auth.uid();
BEGIN
  SELECT company_id INTO v_comp FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_negociacao SET aprovado_por = v_autor, aprovado_em = now(), aprovacao_motivo = p_motivo, updated_at = now()
   WHERE id = p_neg_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── fn_veic_oportunidade_abrir ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_oportunidade_abrir(p_veiculo_id uuid, p_cliente jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_vec record; v_cli uuid; v_titulo text; v_op uuid; v_aval uuid; v_novo boolean := false;
  v_autor uuid := auth.uid();
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, marca, modelo, ano_modelo, placa INTO v_vec FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_vec.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;

  -- resolve o cliente: usa o informado, ou cria inline (nome + contato)
  v_cli := NULLIF(p_cliente->>'cliente_id','')::uuid;
  IF v_cli IS NULL THEN
    IF NULLIF(btrim(p_cliente->>'nome'),'') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio', 'campo', 'nome'); END IF;
    v_cli := public.fn_cliente_criar_inline(
      v_comp, p_cliente->>'nome', NULLIF(p_cliente->>'cpf_cnpj',''),
      jsonb_build_object('telefone', NULLIF(btrim(p_cliente->>'contato'),'')));
  ELSE
    -- garante que o cliente informado e do tenant do veiculo
    IF NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = v_comp) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'cliente_de_outra_empresa'); END IF;
  END IF;

  -- titulo com a placa (ou o ano se nao houver placa) — ajuda a distinguir carros do mesmo modelo
  v_titulo := COALESCE(NULLIF(btrim(p_cliente->>'titulo'),''),
    NULLIF(btrim(
      btrim(COALESCE(v_vec.marca,'') || ' ' || COALESCE(v_vec.modelo,''))
      || CASE WHEN NULLIF(btrim(v_vec.placa),'') IS NOT NULL THEN ' ' || v_vec.placa
              WHEN v_vec.ano_modelo IS NOT NULL THEN ' ' || v_vec.ano_modelo::text ELSE '' END), ''),
    'Interesse em veiculo');

  v_aval := NULLIF(p_cliente->>'veic_avaliacao_id','')::uuid;

  -- 1) ja existe oportunidade aberta do cliente PARA ESTE veiculo -> reusa
  SELECT id INTO v_op FROM erp_crm_oportunidade
   WHERE cliente_id = v_cli AND deleted_at IS NULL AND etapa NOT IN ('ganho','perdido')
     AND veic_interesse_id = p_veiculo_id
   ORDER BY created_at DESC LIMIT 1;

  -- 2) senao, oportunidade aberta ainda SEM veiculo -> preenche (nao sobrescreve outro carro)
  IF v_op IS NULL THEN
    SELECT id INTO v_op FROM erp_crm_oportunidade
     WHERE cliente_id = v_cli AND deleted_at IS NULL AND etapa NOT IN ('ganho','perdido')
       AND veic_interesse_id IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_op IS NOT NULL THEN
      UPDATE erp_crm_oportunidade SET veic_interesse_id = p_veiculo_id, updated_at = now() WHERE id = v_op;
    END IF;
  END IF;

  -- 3) senao, cria uma NOVA (uma oportunidade por veiculo de interesse) no funil da GE
  IF v_op IS NULL THEN
    INSERT INTO erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, origem, veic_interesse_id, created_by)
    VALUES (v_comp, v_cli, v_titulo, 'prospeccao', 'revenda', p_veiculo_id, v_autor)
    RETURNING id INTO v_op;
    v_novo := true;
  END IF;

  -- avaliacao (troca), quando informada, sem apagar a existente
  IF v_aval IS NOT NULL THEN
    UPDATE erp_crm_oportunidade SET veic_avaliacao_id = v_aval, updated_at = now()
     WHERE id = v_op AND veic_avaliacao_id IS DISTINCT FROM v_aval;
  END IF;

  RETURN jsonb_build_object('ok', true, 'oportunidade_id', v_op, 'cliente_id', v_cli,
    'veiculo_id', p_veiculo_id, 'nova', v_novo);
END $function$;

-- ── fn_veic_perfil_convite_criar ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_criar(p_company_id uuid, p_email text, p_user uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_base_url text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_token text; v_perfil uuid; v_id uuid; v_email text := NULLIF(btrim(p_email),''); v_link text; v_empresa text; v_enfileirado boolean := false;
        v_autor uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_perfil := fn_veic_perfil_rascunho_id(p_company_id, 'contador');
  UPDATE veic_perfil_convite SET status='revogado' WHERE company_id=p_company_id AND status='ativo';
  INSERT INTO veic_perfil_convite (company_id, perfil_id, email_contador, token_hash, expira_em, criado_por, ip_criacao)
  VALUES (p_company_id, v_perfil, v_email, encode(digest(v_token,'sha256'),'hex'), now() + interval '15 days', v_autor, p_ip)
  RETURNING id INTO v_id;

  IF v_email IS NOT NULL THEN
    v_link := COALESCE(rtrim(NULLIF(btrim(p_base_url),''), '/'), '') || '/contador/' || v_token;
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_empresa FROM companies WHERE id = p_company_id;
    BEGIN
      PERFORM fn_enviar_email(v_email, 'revenda_convite_contador',
        jsonb_build_object('empresa', v_empresa, 'link', v_link, 'idempotency_key', v_token, 'company_id', p_company_id::text));
      v_enfileirado := true;
    EXCEPTION WHEN OTHERS THEN v_enfileirado := false;  -- o link volta de qualquer forma
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'convite_id', v_id, 'token', v_token,
    'url_path', '/contador/' || v_token, 'expira_em', now() + interval '15 days',
    'email', v_email, 'email_enfileirado', v_enfileirado);
END $function$;

-- ── fn_veic_preparacao_abrir ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_abrir(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_vec record; v_numero text; v_os_id uuid;
  v_desc text; v_itens_txt text; v_vist_id uuid; v_autor uuid := auth.uid();
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, placa, marca, modelo, ano_modelo, ano_fabricacao, km_atual, chassi
    INTO v_vec FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_vec.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;

  -- descricao: usa a informada; se vazia e houver vistoria concluida, monta dos itens em reparo/troca
  v_desc := NULLIF(btrim(p_dados->>'descricao_servico'), '');
  IF v_desc IS NULL THEN
    SELECT id INTO v_vist_id FROM insp_vistoria
      WHERE alvo_tabela='veic_veiculo' AND alvo_id=p_veiculo_id AND situacao='concluida'
      ORDER BY concluida_em DESC NULLS LAST LIMIT 1;
    IF v_vist_id IS NOT NULL THEN
      SELECT string_agg(
               i.nome
               || COALESCE(' — ' || NULLIF(btrim(resp.descricao),''), '')
               || CASE WHEN resp.gasto_previsto IS NOT NULL
                       THEN ' (prev. R$ ' || resp.gasto_previsto::text || ')' ELSE '' END,
               E'\n' ORDER BY i.ordem)
        INTO v_itens_txt
        FROM insp_resposta resp
        JOIN insp_item i ON i.id = resp.item_id
       WHERE resp.vistoria_id = v_vist_id AND resp.estado IN ('reparo','troca');
    END IF;
    v_desc := 'Preparacao — ' || COALESCE(v_vec.marca,'') || ' ' || COALESCE(v_vec.modelo,'')
              || CASE WHEN v_itens_txt IS NOT NULL THEN E'\n' || v_itens_txt ELSE '' END;
  END IF;

  -- numero por empresa/ano: OS-YYYY-NNNN (UNIQUE(company_id, numero) protege)
  SELECT 'OS-' || to_char(CURRENT_DATE,'YYYY') || '-' ||
         lpad((COALESCE(max((regexp_match(numero, '^OS-\d{4}-(\d+)$'))[1]::int), 0) + 1)::text, 4, '0')
    INTO v_numero
    FROM erp_os
   WHERE company_id = v_comp AND numero ~ ('^OS-' || to_char(CURRENT_DATE,'YYYY') || '-\d+$');

  INSERT INTO erp_os (company_id, numero, descricao_servico, status, prioridade,
      data_abertura, data_prevista, placa, marca, modelo, ano, km, chassi,
      veic_veiculo_id, observacoes_internas, created_by)
  VALUES (v_comp, v_numero, v_desc, 'aberta',
      COALESCE(NULLIF(btrim(p_dados->>'prioridade'),''), 'normal'),
      CURRENT_DATE, NULLIF(p_dados->>'data_prevista','')::date,
      v_vec.placa, v_vec.marca, v_vec.modelo,
      COALESCE(v_vec.ano_modelo, v_vec.ano_fabricacao), v_vec.km_atual::int, v_vec.chassi,
      p_veiculo_id, NULLIF(btrim(p_dados->>'observacoes_internas'),''), v_autor)
  RETURNING id INTO v_os_id;

  INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'preparacao', 'CRIOU OS de preparacao ' || v_numero, v_autor,
          jsonb_build_object('os_id', v_os_id, 'numero', v_numero));

  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_numero, 'status', 'aberta');
END $function$;

-- ── fn_veic_procura_registrar ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_procura_registrar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_marca text; v_modelo text; v_autor uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_marca  := NULLIF(btrim(p_dados->>'marca'), '');
  v_modelo := NULLIF(btrim(p_dados->>'modelo'), '');
  IF v_marca IS NULL AND v_modelo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'marca_ou_modelo_obrigatorio', 'campo', 'modelo'); END IF;

  INSERT INTO veic_procura (company_id, oportunidade_id, cliente_nome, contato, marca, modelo,
      ano_min, ano_max, valor_ate, cambio, observacao, criado_por)
  VALUES (p_company_id, NULLIF(p_dados->>'oportunidade_id','')::uuid,
      NULLIF(btrim(p_dados->>'cliente_nome'),''), NULLIF(btrim(p_dados->>'contato'),''),
      v_marca, v_modelo,
      NULLIF(p_dados->>'ano_min','')::int, NULLIF(p_dados->>'ano_max','')::int,
      NULLIF(p_dados->>'valor_ate','')::numeric, NULLIF(btrim(p_dados->>'cambio'),''),
      NULLIF(btrim(p_dados->>'observacao'),''), v_autor)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'procura_id', v_id);
END $function$;

-- ── fn_veic_proposta_criar ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_proposta_criar(p_company_id uuid, p_veiculo_id uuid, p_proposta jsonb, p_troca jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_prop uuid; v_cli text := NULLIF(btrim(p_proposta->>'cliente_nome'),'');
        v_pedido numeric; v_negociado numeric; v_desconto numeric;
        t_ano_fab int; t_ano_mod int; t_km numeric; t_troca numeric; t_aval numeric;
        v_autor uuid := auth.uid();
BEGIN
  SELECT company_id INTO v_comp FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_obrigatorio', 'campo', 'cliente_nome'); END IF;

  BEGIN v_pedido    := NULLIF(btrim(p_proposta->>'valor_pedido'),'')::numeric;    EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'valor_pedido'); END;
  BEGIN v_negociado := NULLIF(btrim(p_proposta->>'valor_negociado'),'')::numeric; EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'valor_negociado'); END;
  BEGIN v_desconto  := NULLIF(btrim(p_proposta->>'desconto'),'')::numeric;        EXCEPTION WHEN others THEN v_desconto := NULL; END;

  INSERT INTO veic_proposta (company_id, veiculo_id, cliente_id, cliente_nome, cliente_doc,
      valor_pedido, valor_negociado, desconto, validade_ate, vendedor_nome, observacao, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, NULLIF(p_proposta->>'cliente_id','')::uuid, v_cli,
      p_proposta->>'cliente_doc', v_pedido, v_negociado, v_desconto, NULLIF(p_proposta->>'validade_ate','')::date,
      p_proposta->>'vendedor_nome', p_proposta->>'observacao',
      COALESCE(NULLIF(p_proposta->>'situacao',''), 'aberta'), v_autor)
  RETURNING id INTO v_prop;

  IF p_troca IS NOT NULL AND jsonb_typeof(p_troca) = 'object' AND p_troca <> '{}'::jsonb THEN
    BEGIN t_ano_fab := NULLIF(btrim(p_troca->>'ano_fabricacao'),'')::int; EXCEPTION WHEN others THEN t_ano_fab := NULL; END;
    BEGIN t_ano_mod := NULLIF(btrim(p_troca->>'ano_modelo'),'')::int;     EXCEPTION WHEN others THEN t_ano_mod := NULL; END;
    BEGIN t_km      := NULLIF(btrim(p_troca->>'km'),'')::numeric;         EXCEPTION WHEN others THEN t_km := NULL; END;
    BEGIN t_troca   := NULLIF(btrim(p_troca->>'valor_troca'),'')::numeric; EXCEPTION WHEN others THEN t_troca := NULL; END;
    BEGIN t_aval    := NULLIF(btrim(p_troca->>'valor_avaliacao'),'')::numeric; EXCEPTION WHEN others THEN t_aval := NULL; END;
    INSERT INTO veic_proposta_troca (company_id, proposta_id, chassi, placa, marca, modelo,
        ano_fabricacao, ano_modelo, km, valor_troca, valor_avaliacao)
    VALUES (p_company_id, v_prop, NULLIF(btrim(p_troca->>'chassi'),''), NULLIF(p_troca->>'placa',''),
        p_troca->>'marca', p_troca->>'modelo', t_ano_fab, t_ano_mod, t_km, t_troca, t_aval);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_prop);
END $function$;

-- ── fn_veic_reserva_criar ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_reserva_criar(p_company_id uuid, p_veiculo_id uuid, p_reserva jsonb, p_gerar_receber boolean, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_sit text; v_res uuid; v_receber uuid; v_sinal numeric; v_cli text := NULLIF(btrim(p_reserva->>'cliente_nome'),'');
        v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, situacao INTO v_comp, v_sit FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue') THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_ja_vendido'); END IF;
  IF EXISTS (SELECT 1 FROM veic_reserva WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_reservado'); END IF;

  IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_obrigatorio', 'campo', 'cliente_nome'); END IF;
  BEGIN v_sinal := NULLIF(btrim(p_reserva->>'valor_sinal'),'')::numeric; EXCEPTION WHEN others THEN v_sinal := NULL; END;
  IF p_gerar_receber AND COALESCE(v_sinal,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sinal_invalido_para_titulo', 'campo', 'valor_sinal'); END IF;

  INSERT INTO veic_reserva (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome,
      valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, NULLIF(p_reserva->>'proposta_id','')::uuid,
      NULLIF(p_reserva->>'cliente_id','')::uuid, v_cli,
      v_sinal, p_reserva->>'forma_sinal', NULLIF(p_reserva->>'reservado_ate','')::date, 'ativa', v_autor)
  RETURNING id INTO v_res;

  IF p_gerar_receber AND COALESCE(v_sinal,0) > 0 THEN
    v_receber := fn_veic__receber(p_company_id, v_res, 'Sinal de reserva — ' || v_cli, v_sinal,
      NULLIF(p_reserva->>'reservado_ate','')::date, NULLIF(p_reserva->>'cliente_id','')::uuid,
      v_cli, p_reserva->>'forma_sinal', NULL);
    UPDATE veic_reserva SET receber_id = v_receber WHERE id = v_res;
  END IF;

  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'reservado', v_autor, 'Reservado para ' || v_cli);
  RETURN jsonb_build_object('ok', true, 'id', v_res, 'receber_id', v_receber);
END $function$;

-- ── fn_veic_venda_registrar ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_registrar(p_company_id uuid, p_veiculo_id uuid, p_venda jsonb, p_recebimentos jsonb, p_troca jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_sit text; v_modelo text; v_venda uuid; v_prop uuid := NULLIF(p_venda->>'proposta_id','')::uuid;
  v_troca_veic uuid; v_desc numeric := 0; v_troca_val numeric; v_aval numeric; v_troca_chassi text;
  v_rec jsonb; v_rec_id uuid; v_receber uuid; n_titulos int := 0; v_cli_nome text := NULLIF(btrim(p_venda->>'cliente_nome'),''); v_valor_venda numeric;
  v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, situacao, modelo INTO v_comp, v_sit, v_modelo FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_indisponivel', 'situacao', v_sit); END IF;

  IF v_cli_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_obrigatorio', 'campo', 'cliente_nome'); END IF;
  BEGIN v_valor_venda := NULLIF(btrim(p_venda->>'valor_venda'),'')::numeric; EXCEPTION WHEN others THEN v_valor_venda := NULL; END;
  IF v_valor_venda IS NULL OR v_valor_venda <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_venda_invalido', 'campo', 'valor_venda'); END IF;

  IF p_troca IS NOT NULL AND jsonb_typeof(p_troca) = 'object' AND p_troca <> '{}'::jsonb THEN
    -- parse seguro dos valores da troca (não-numérico não estoura o cast)
    BEGIN v_troca_val := NULLIF(btrim(p_troca->>'valor_troca'),'')::numeric; EXCEPTION WHEN others THEN v_troca_val := NULL; END;
    BEGIN v_aval := NULLIF(btrim(p_troca->>'valor_avaliacao'),'')::numeric; EXCEPTION WHEN others THEN v_aval := NULL; END;
    -- sobrepreco so existe com os DOIS valores; sem avaliacao e desconhecido (NULL), nao zero
    IF v_troca_val IS NOT NULL AND v_aval IS NOT NULL THEN
      v_desc := v_troca_val - v_aval;
    ELSE
      v_desc := NULL;
    END IF;
    v_troca_chassi := NULLIF(btrim(p_troca->>'chassi'),'');
  END IF;

  -- o usado da troca entra em veic_veiculo (chassi UNIQUE por empresa). Se já existe no pátio,
  -- avisa ANTES de inserir a venda — senão a venda gravava e a troca estourava 23505 cru.
  IF v_troca_chassi IS NOT NULL AND EXISTS (
      SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND chassi = v_troca_chassi AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'troca_chassi_ja_cadastrado', 'campo', 'troca_chassi'); END IF;

  INSERT INTO veic_venda (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome, cliente_doc,
      data_venda, valor_venda, desconto_embutido_troca, valor_entrada, valor_financiado, banco_nome,
      retorno_banco, vendedor_nome, observacao, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, v_prop, NULLIF(p_venda->>'cliente_id','')::uuid, v_cli_nome,
      p_venda->>'cliente_doc', COALESCE((p_venda->>'data_venda')::date, CURRENT_DATE),
      v_valor_venda, NULLIF(v_desc,0), (p_venda->>'valor_entrada')::numeric,
      (p_venda->>'valor_financiado')::numeric, p_venda->>'banco_nome', (p_venda->>'retorno_banco')::numeric,
      p_venda->>'vendedor_nome', p_venda->>'observacao', 'aberta', v_autor)
  RETURNING id INTO v_venda;

  IF p_recebimentos IS NOT NULL AND jsonb_typeof(p_recebimentos) = 'array' THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_recebimentos) LOOP
      INSERT INTO veic_venda_recebimento (company_id, venda_id, tipo, devedor, valor, data_prevista,
          forma_pagamento, conta_bancaria_id)
      VALUES (p_company_id, v_venda, COALESCE(v_rec->>'tipo','parcela'), COALESCE(v_rec->>'devedor','cliente'),
          (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date, v_rec->>'forma_pagamento',
          NULLIF(v_rec->>'conta_bancaria_id','')::uuid)
      RETURNING id INTO v_rec_id;
      v_receber := fn_veic__receber(p_company_id, v_rec_id,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco'
             THEN 'Repasse banco — ' || COALESCE(p_venda->>'banco_nome','') || ' — ' || COALESCE(v_modelo,'')
             ELSE (COALESCE(v_rec->>'tipo','parcela') || ' — ' || COALESCE(v_modelo,'') || ' — ' || COALESCE(v_cli_nome,'')) END,
        (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN NULL ELSE NULLIF(p_venda->>'cliente_id','')::uuid END,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN p_venda->>'banco_nome' ELSE v_cli_nome END,
        v_rec->>'forma_pagamento', NULLIF(v_rec->>'conta_bancaria_id','')::uuid);
      UPDATE veic_venda_recebimento SET receber_id = v_receber WHERE id = v_rec_id;
      n_titulos := n_titulos + 1;
    END LOOP;
  END IF;

  IF v_troca_chassi IS NOT NULL THEN
    INSERT INTO veic_veiculo (company_id, chassi, placa, marca, modelo, ano_fabricacao, ano_modelo,
        km_entrada, km_atual, origem, valor_aquisicao, created_by, updated_by)
    VALUES (p_company_id, v_troca_chassi, NULLIF(p_troca->>'placa',''), p_troca->>'marca', p_troca->>'modelo',
        (p_troca->>'ano_fabricacao')::int, (p_troca->>'ano_modelo')::int, (p_troca->>'km')::numeric,
        (p_troca->>'km')::numeric, 'troca', v_aval, v_autor, v_autor)
    RETURNING id INTO v_troca_veic;
    INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
    VALUES (p_company_id, v_troca_veic, 'entrada',
        'Recebido em troca (venda) — avaliado em R$ ' || COALESCE(v_aval,0)::text, v_autor,
        jsonb_build_object('origem','troca','valor_troca',v_troca_val,'valor_avaliacao',v_aval,'venda_id',v_venda));
    IF v_prop IS NOT NULL THEN
      UPDATE veic_proposta_troca SET veiculo_id = v_troca_veic WHERE proposta_id = v_prop AND veiculo_id IS NULL;
    END IF;
  END IF;

  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'vendido', v_autor, 'Venda registrada');
  IF v_prop IS NOT NULL THEN UPDATE veic_proposta SET situacao = 'aceita' WHERE id = v_prop AND situacao NOT IN ('cancelada','recusada'); END IF;
  UPDATE veic_reserva SET situacao = 'convertida' WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'id', v_venda, 'desconto_embutido_troca', NULLIF(v_desc,0),
      'troca_veiculo_id', v_troca_veic, 'n_titulos', n_titulos);
END $function$;

-- ── grants: SECURITY DEFINER sem anon (CEO / #1681) — assinaturas idênticas às atuais ──
REVOKE ALL ON FUNCTION public.fn_veic_criar(uuid,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_custo_salvar(uuid,jsonb,boolean,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_modelo_aplicar(uuid,uuid,uuid[],uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_modelo_salvar(uuid,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_mudar_situacao(uuid,text,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_negociacao_aprovar(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_oportunidade_abrir(uuid,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_perfil_convite_criar(uuid,text,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_preparacao_abrir(uuid,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_procura_registrar(uuid,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_proposta_criar(uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_reserva_criar(uuid,uuid,jsonb,boolean,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_venda_registrar(uuid,uuid,jsonb,jsonb,jsonb,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_veic_criar(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_salvar(uuid,jsonb,boolean,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_modelo_aplicar(uuid,uuid,uuid[],uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_modelo_salvar(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_mudar_situacao(uuid,text,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_negociacao_aprovar(uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_oportunidade_abrir(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_criar(uuid,text,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_preparacao_abrir(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_procura_registrar(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_proposta_criar(uuid,uuid,jsonb,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_reserva_criar(uuid,uuid,jsonb,boolean,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_registrar(uuid,uuid,jsonb,jsonb,jsonb,uuid) TO authenticated, service_role;
