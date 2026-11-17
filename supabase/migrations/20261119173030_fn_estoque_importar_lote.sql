-- Importação de estoque em LOTE (server-side) — chamado #9667 (CEO/Eng. Chefe · RD-41). Destrava o cutover da
-- MECÂNICA 163 (12.125 produtos, travada em 572 pelo import item-a-item no navegador, ~6-7h e quebra se perde o
-- foco da aba). RD-26: reaproveita o padrão de fn_import_produtos_fiscal (guarda, parsing tolerante a vírgula,
-- fn_movimentar_estoque, log em erp_importacoes), mas este CRIA os produtos novos (a fiscal só atualiza).
--
-- Upsert por (company_id, codigo): código novo -> INSERT em erp_produtos + saldo inicial (entrada); existente ->
-- atualiza (nome/unidade/ncm/preços) e ajusta o saldo pelo delta. Idempotente/resumível (reimportar não duplica:
-- a chave única (company_id, codigo) + o SELECT-por-linha; já-importados viram UPDATE). dry_run=true (default) só
-- valida e devolve o resumo, sem gravar nada. Multi-tenant fail-closed. Erro de linha é reportado, não aborta.

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
    v_preco_venda := NULL; v_preco_custo := NULL; v_saldo := NULL;
    v_raw := btrim(COALESCE(v_row->>'preco_venda','')); IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_venda := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'preco_custo','')); IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_custo := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'saldo',''));       IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_saldo       := replace(v_raw, ',', '.')::numeric; END IF;

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
        INSERT INTO erp_produtos (company_id, codigo, nome, unidade, categoria, ncm, preco_venda, preco_custo, estoque_atual, ativo)
        VALUES (p_company_id, v_codigo, v_nome, v_unidade, v_categoria, v_ncm, v_preco_venda, v_preco_custo, 0, true)
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
      -- CÓDIGO EXISTENTE → atualiza + ajusta saldo pelo delta (como a fiscal)
      v_atualizados := v_atualizados + 1;
      v_delta := CASE WHEN v_saldo IS NOT NULL THEN v_saldo - COALESCE(v_prod.estoque_atual,0) ELSE NULL END;
      IF v_delta IS NOT NULL AND v_delta <> 0 THEN v_saldos_ajustados := v_saldos_ajustados + 1; END IF;
      IF NOT p_dry_run THEN
        UPDATE erp_produtos SET
          nome = v_nome, unidade = v_unidade,
          categoria = COALESCE(v_categoria, categoria), ncm = COALESCE(v_ncm, ncm),
          preco_venda = COALESCE(v_preco_venda, preco_venda), preco_custo = COALESCE(v_preco_custo, preco_custo),
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

  IF NOT p_dry_run THEN
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

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço.
REVOKE ALL ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, boolean, uuid, text) TO authenticated, service_role;
