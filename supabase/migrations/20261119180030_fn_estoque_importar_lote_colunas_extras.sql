-- #9667 / #8621 (parte B) — importação de estoque em LOTE (server-side), SUPERSET da fn mergeada em #5370.
--
-- A fn_estoque_importar_lote (migration 20261119173030) grava em lote codigo/nome/unidade/categoria/ncm/
-- preco_venda/preco_custo/saldo. Mas o importador compartilhado (/dashboard/cadastros/produtos/importar,
-- reusado por /dashboard/commerce/estoque/importar) mapeia MAIS colunas que a fn descartava — trocar o loop
-- item-a-item (que depende do foco da aba) pela fn mergeada, do jeito que estava, PERDERIA: estoque_minimo,
-- marca, fornecedor_padrao_nome, localizacao, codigo_barras, cest, origem, tipo_item_sped, preco_custo_medio
-- e custo_medio_origem. Esta migration estende a fn como SUPERSET ESTRITO (mesma assinatura, mesmo contrato
-- de linha/resultado — o spec estoque-importar-lote-9667 continua válido), só ADICIONANDO as colunas extras
-- no INSERT (produto novo) e no UPDATE (produto existente, sempre com COALESCE: nunca sobrescreve com null).
--
-- Mudança de 1 comportamento, documentada: o registro próprio em erp_importacoes passa a sair só quando
-- p_arquivo IS NOT NULL (antes: sempre que NOT dry_run). O cliente chama a fn em BLOCOS e gere UM único
-- registro de histórico por importação — com p_arquivo=null a fn NÃO cria um registro por bloco (evitaria
-- dezenas de linhas de histórico por importação). Quem quiser histórico gerido pela fn passa p_arquivo.
-- Nenhum caller em src/ dependia do histórico da fn (ela não tinha chamador cliente ainda).
--
-- Núcleo fiscal/estoque + CREATE OR REPLACE de função existente → via revisada (revisao-eng-chefe).
-- Aditiva: não altera dado de cliente; só amplia o que a importação grava. RLS/guarda multi-tenant idêntica.

CREATE OR REPLACE FUNCTION public.fn_estoque_importar_lote(
  p_company_id uuid, p_rows jsonb, p_dry_run boolean DEFAULT true,
  p_user_id uuid DEFAULT NULL::uuid, p_arquivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb; v_raw text;
  v_codigo text; v_nome text; v_unidade text; v_categoria text; v_ncm text;
  v_preco_venda numeric; v_preco_custo numeric; v_saldo numeric; v_delta numeric;
  -- SUPERSET #9667/#8621: colunas extras do importador
  v_preco_custo_medio numeric; v_custo_origem text; v_estoque_minimo numeric;
  v_marca text; v_forn text; v_local_txt text; v_cod_barras text; v_cest text;
  v_origem text; v_tipo_sped text;
  v_prod RECORD; v_novo_id uuid; v_local uuid;
  v_total int := 0; v_novos int := 0; v_atualizados int := 0; v_erros int := 0;
  v_saldos_ajustados int := 0; v_valor_total_estoque numeric := 0;
  v_importacao_id uuid; v_erros_detalhe jsonb := '[]'::jsonb; v_falta text;
BEGIN
  -- Guarda multi-tenant (padrão da fiscal): sem usuário = serviço/cron passa; usuário só na própria empresa.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio'); END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'rows vazias'); END IF;

  v_local := fn_estoque_local_principal(p_company_id);

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_codigo   := btrim(COALESCE(v_row->>'codigo',''));
    v_nome     := btrim(COALESCE(v_row->>'nome',''));
    v_unidade  := NULLIF(btrim(COALESCE(v_row->>'unidade','')),'');
    v_categoria:= NULLIF(btrim(COALESCE(v_row->>'categoria','')),'');
    v_ncm      := NULLIF(regexp_replace(COALESCE(v_row->>'ncm',''), '\D', '', 'g'),'');
    -- números tolerantes a vírgula (padrão da fiscal) — valores inválidos ficam NULL (não inflam)
    v_preco_venda := NULL; v_preco_custo := NULL; v_saldo := NULL; v_preco_custo_medio := NULL; v_estoque_minimo := NULL;
    v_raw := btrim(COALESCE(v_row->>'preco_venda','')); IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_venda := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'preco_custo','')); IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_custo := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'saldo',''));       IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_saldo       := replace(v_raw, ',', '.')::numeric; END IF;
    -- SUPERSET: colunas extras (strings tolerantes; NULLIF/vazio preserva o que já existe no UPDATE via COALESCE)
    v_raw := btrim(COALESCE(v_row->>'preco_custo_medio','')); IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_custo_medio := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'estoque_minimo',''));    IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_estoque_minimo    := replace(v_raw, ',', '.')::numeric; END IF;
    v_custo_origem := NULLIF(btrim(COALESCE(v_row->>'custo_medio_origem','')),'');
    v_marca      := NULLIF(btrim(COALESCE(v_row->>'marca','')),'');
    v_forn       := NULLIF(btrim(COALESCE(v_row->>'fornecedor_padrao_nome','')),'');
    v_local_txt  := NULLIF(btrim(COALESCE(v_row->>'localizacao','')),'');
    v_cod_barras := NULLIF(btrim(COALESCE(v_row->>'codigo_barras','')),'');
    v_cest       := NULLIF(regexp_replace(COALESCE(v_row->>'cest',''), '\D', '', 'g'),'');
    v_origem     := NULLIF(btrim(COALESCE(v_row->>'origem','')),'');
    v_tipo_sped  := NULLIF(btrim(COALESCE(v_row->>'tipo_item_sped','')),'');

    -- Obrigatórios da linha: codigo, nome, unidade. Erro reportado; NÃO aborta o lote.
    IF v_codigo = '' OR v_nome = '' OR v_unidade IS NULL THEN
      v_erros := v_erros + 1;
      v_falta := concat_ws(', ', CASE WHEN v_codigo='' THEN 'codigo' END, CASE WHEN v_nome='' THEN 'nome' END, CASE WHEN v_unidade IS NULL THEN 'unidade' END);
      IF jsonb_array_length(v_erros_detalhe) < 200 THEN
        v_erros_detalhe := v_erros_detalhe || jsonb_build_object('linha', v_total, 'codigo', NULLIF(v_codigo,''), 'msg', 'Linha sem ' || v_falta);
      END IF;
      CONTINUE;
    END IF;

    SELECT id, estoque_atual INTO v_prod FROM erp_produtos
      WHERE company_id = p_company_id AND codigo = v_codigo LIMIT 1;

    IF v_prod.id IS NULL THEN
      -- CÓDIGO NOVO → cria o produto (+ saldo inicial se > 0)
      v_novos := v_novos + 1;
      IF COALESCE(v_saldo,0) <> 0 THEN v_saldos_ajustados := v_saldos_ajustados + 1; END IF;
      IF NOT p_dry_run THEN
        INSERT INTO erp_produtos (company_id, codigo, nome, unidade, categoria, ncm, preco_venda, preco_custo,
          estoque_atual, ativo, preco_custo_medio, custo_medio_origem, estoque_minimo, marca,
          fornecedor_padrao_nome, localizacao, codigo_barras, cest, origem, tipo_item_sped)
        VALUES (p_company_id, v_codigo, v_nome, v_unidade, v_categoria, v_ncm, v_preco_venda, v_preco_custo,
          0, true, v_preco_custo_medio, v_custo_origem, v_estoque_minimo, v_marca,
          v_forn, v_local_txt, v_cod_barras, v_cest, v_origem, v_tipo_sped)
        ON CONFLICT (company_id, codigo) DO NOTHING
        RETURNING id INTO v_novo_id;
        -- v_novo_id NULL = conflito (já existia por corrida/edge) -> não movimenta, evita duplicar
        IF v_novo_id IS NOT NULL AND COALESCE(v_saldo,0) > 0 THEN
          PERFORM fn_movimentar_estoque(
            p_produto_id := v_novo_id, p_local_id := v_local, p_tipo := 'entrada',
            p_quantidade := v_saldo, p_custo_unitario := COALESCE(v_preco_custo, 0),
            p_motivo := 'Saldo inicial - importação em lote', p_ref_tipo := 'importacao');
        END IF;
      END IF;
    ELSE
      -- CÓDIGO EXISTENTE → atualiza + ajusta saldo pelo delta (como a fiscal). COALESCE: nunca apaga o que já existe.
      v_atualizados := v_atualizados + 1;
      v_delta := CASE WHEN v_saldo IS NOT NULL THEN v_saldo - COALESCE(v_prod.estoque_atual,0) ELSE NULL END;
      IF v_delta IS NOT NULL AND v_delta <> 0 THEN v_saldos_ajustados := v_saldos_ajustados + 1; END IF;
      IF NOT p_dry_run THEN
        UPDATE erp_produtos SET
          nome = v_nome, unidade = v_unidade,
          categoria = COALESCE(v_categoria, categoria), ncm = COALESCE(v_ncm, ncm),
          preco_venda = COALESCE(v_preco_venda, preco_venda), preco_custo = COALESCE(v_preco_custo, preco_custo),
          preco_custo_medio = COALESCE(v_preco_custo_medio, preco_custo_medio),
          custo_medio_origem = COALESCE(v_custo_origem, custo_medio_origem),
          estoque_minimo = COALESCE(v_estoque_minimo, estoque_minimo),
          marca = COALESCE(v_marca, marca),
          fornecedor_padrao_nome = COALESCE(v_forn, fornecedor_padrao_nome),
          localizacao = COALESCE(v_local_txt, localizacao),
          codigo_barras = COALESCE(v_cod_barras, codigo_barras),
          cest = COALESCE(v_cest, cest), origem = COALESCE(v_origem, origem),
          tipo_item_sped = COALESCE(v_tipo_sped, tipo_item_sped),
          updated_at = now()
        WHERE id = v_prod.id;
        IF v_delta IS NOT NULL AND v_delta <> 0 THEN
          PERFORM fn_movimentar_estoque(
            p_produto_id := v_prod.id, p_local_id := v_local,
            p_tipo := CASE WHEN v_delta > 0 THEN 'entrada' ELSE 'ajuste_negativo' END,
            p_quantidade := abs(v_delta), p_custo_unitario := COALESCE(v_preco_custo, 0),
            p_motivo := 'Ajuste de saldo - importação em lote', p_ref_tipo := 'importacao');
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Histórico próprio só quando p_arquivo IS NOT NULL (o cliente gere UM registro por importação e chama em
  -- blocos com p_arquivo=null, para não criar um registro por bloco).
  IF NOT p_dry_run AND p_arquivo IS NOT NULL THEN
    INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado,
      registros_total, registros_novos, registros_atualizados, registros_erro,
      status, arquivo_nome, metadata, iniciado_em, concluido_em)
    VALUES (p_company_id, p_user_id, 'planilha', 'estoque_lote',
      v_total, v_novos, v_atualizados, v_erros, 'concluido', p_arquivo,
      jsonb_build_object('saldos_ajustados', v_saldos_ajustados), now(), now())
    RETURNING id INTO v_importacao_id;
  END IF;

  SELECT COALESCE(SUM(COALESCE(estoque_atual,0) * COALESCE(preco_custo,0)), 0)
    INTO v_valor_total_estoque FROM erp_produtos WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'importacao_id', v_importacao_id,
    'total', v_total, 'novos', v_novos, 'atualizados', v_atualizados, 'erros', v_erros,
    'saldos_ajustados', v_saldos_ajustados, 'valor_total_estoque', v_valor_total_estoque,
    'erros_detalhe', v_erros_detalhe);
END;
$function$;
