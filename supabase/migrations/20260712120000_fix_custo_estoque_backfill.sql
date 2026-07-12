-- ============================================================
-- FIX: custo do Estoque zerado (1725 produtos custo médio R$0) — GE.
--
-- CAUSA-RAIZ: o custeio JÁ existe e funciona (fn_movimentar_estoque /
--   registrar_movimento_estoque calculam valor_total E propagam
--   preco_custo_medio). Mas a importação em lote (fn_import_produtos_fiscal,
--   ref_tipo='importacao') gravava o movimento DIRETO e só atualizava
--   estoque_atual — nunca preco_custo_medio — e valor_total ficava nulo.
--
-- ESTE PR (política CEO 🅐 média ponderada das entradas custeadas · fallback
--   🅒 preco_custo do cadastro · escopo TODOS os tenants):
--   (0) BACKUP reversível de produtos + movimentos.
--   (1) coluna custo_medio_origem (rastreabilidade).
--   (2) TRIGGER defense-in-depth: valor_total = |qtd| × custo em QUALQUER
--       insert de movimento, venha de onde vier (lição do al_all).
--   (3) BACKFILL valor_total nos movimentos existentes.
--   (4) BACKFILL preco_custo_medio por produto (média ponderada das entradas;
--       fallback cadastro; marca a origem).
--   (5) CONSERTA A CAUSA: fn_import_produtos_fiscal passa a rotear a entrada
--       por fn_movimentar_estoque (custeio único) — sem isso toda importação
--       futura repete o bug.
--   Curva ABC (fn_curva_abc_estoque) é read-time (estoque × custo médio) →
--   cicatriza sozinha após o backfill.
-- ============================================================

-- (0) BACKUP reversível -----------------------------------------------------
CREATE TABLE IF NOT EXISTS _bkp_custo_estoque_20260712_produtos AS
  SELECT id, company_id, estoque_atual, preco_custo, preco_custo_medio, now() AS _bkp_em
  FROM erp_produtos;

CREATE TABLE IF NOT EXISTS _bkp_custo_estoque_20260712_mov AS
  SELECT id, produto_id, tipo, quantidade, custo_unitario, valor_total, now() AS _bkp_em
  FROM erp_estoque_movimentacoes;

-- (1) rastreabilidade -------------------------------------------------------
ALTER TABLE erp_produtos ADD COLUMN IF NOT EXISTS custo_medio_origem text;

-- (2) TRIGGER defense-in-depth: valor_total sempre calculado ----------------
CREATE OR REPLACE FUNCTION public.fn_estoque_mov_valor_total()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (NEW.valor_total IS NULL OR NEW.valor_total = 0)
     AND NEW.custo_unitario IS NOT NULL AND NEW.custo_unitario > 0
     AND NEW.quantidade IS NOT NULL THEN
    NEW.valor_total := abs(NEW.quantidade) * NEW.custo_unitario;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_estoque_mov_valor_total ON erp_estoque_movimentacoes;
CREATE TRIGGER trg_estoque_mov_valor_total
  BEFORE INSERT ON erp_estoque_movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_estoque_mov_valor_total();

-- (3) BACKFILL valor_total (movimentos existentes) --------------------------
UPDATE erp_estoque_movimentacoes
SET valor_total = abs(quantidade) * custo_unitario
WHERE custo_unitario IS NOT NULL AND custo_unitario > 0
  AND (valor_total IS NULL OR valor_total = 0)
  AND quantidade IS NOT NULL;

-- (4) BACKFILL preco_custo_medio (todos os tenants) -------------------------
-- 🅐 média ponderada das ENTRADAS custeadas; 🅒 fallback preco_custo cadastro.
-- Só toca quem está zerado (preserva os já custeados via RPC).
UPDATE erp_produtos p SET
  preco_custo_medio = COALESCE(
    (SELECT round(SUM(abs(m.quantidade) * m.custo_unitario) / NULLIF(SUM(abs(m.quantidade)),0), 4)
       FROM erp_estoque_movimentacoes m
      WHERE m.produto_id = p.id
        AND m.tipo IN ('entrada','compra','devolucao_entrada','producao','ajuste_positivo','transferencia_entrada','inicial')
        AND m.custo_unitario > 0 AND m.quantidade <> 0),
    NULLIF(p.preco_custo, 0),
    p.preco_custo_medio
  ),
  custo_medio_origem = CASE
    WHEN EXISTS (SELECT 1 FROM erp_estoque_movimentacoes m
                  WHERE m.produto_id = p.id
                    AND m.tipo IN ('entrada','compra','devolucao_entrada','producao','ajuste_positivo','transferencia_entrada','inicial')
                    AND m.custo_unitario > 0 AND m.quantidade <> 0)
      THEN 'backfill_media_ponderada_entradas'
    WHEN COALESCE(p.preco_custo,0) > 0 THEN 'backfill_cadastro'
    ELSE 'sem_custo' END,
  updated_at = now()
WHERE COALESCE(p.preco_custo_medio,0) = 0;

-- marca os que já tinham custo médio (vieram das RPCs) como origem 'rpc'
UPDATE erp_produtos
SET custo_medio_origem = 'rpc'
WHERE COALESCE(preco_custo_medio,0) > 0 AND custo_medio_origem IS NULL;

-- (5) CONSERTA A CAUSA: import roteia a entrada por fn_movimentar_estoque ----
CREATE OR REPLACE FUNCTION public.fn_import_produtos_fiscal(p_company_id uuid, p_rows jsonb, p_dry_run boolean DEFAULT true, p_user_id uuid DEFAULT NULL::uuid, p_arquivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_codigo text;
  v_ncm text;
  v_st boolean;
  v_cest text;
  v_mono boolean;
  v_prod RECORD;
  v_new_cst_icms text;
  v_new_cfop text;
  v_new_cst_pis text;
  v_new_cst_cofins text;
  v_new_cest text;
  v_detalhes jsonb := '[]'::jsonb;
  v_total int := 0;
  v_atualizados int := 0;
  v_avisos int := 0;
  v_nao_encontrados int := 0;
  v_status text;
  v_msg text;
  v_importacao_id uuid;
  v_uf text;
  v_regras_aprendidas int := 0;
  -- v3
  v_precos_atualizados int := 0;
  v_custos_atualizados int := 0;
  v_saldos_ajustados int := 0;
  v_valor_total_estoque numeric := 0;
  v_preco_venda numeric;
  v_preco_custo numeric;
  v_saldo numeric;
  v_delta numeric;
  v_tipo_mov text;
  v_raw_pv text;
  v_raw_pc text;
  v_raw_sd text;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio');
  END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rows vazias');
  END IF;

  SELECT COALESCE(
           NULLIF(upper(trim(split_part(cidade_estado, '/', 2))), ''),
           'SC')
    INTO v_uf
    FROM companies
   WHERE id = p_company_id;
  IF v_uf IS NULL THEN v_uf := 'SC'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_total := v_total + 1;
    v_codigo := btrim(COALESCE(v_row->>'codigo',''));
    v_ncm := regexp_replace(COALESCE(v_row->>'ncm',''), '\D', '', 'g');
    v_cest := regexp_replace(COALESCE(v_row->>'cest',''), '\D', '', 'g');

    v_st := CASE
      WHEN COALESCE(v_row->>'st', v_row->>'icms_st') IS NULL THEN false
      ELSE upper(btrim(COALESCE(v_row->>'st', v_row->>'icms_st')))
           IN ('TRUE','SIM','S','1')
    END;

    v_mono := CASE
      WHEN COALESCE(v_row->>'monofasico', v_row->>'pis_cofins') IS NULL THEN false
      WHEN v_row->>'monofasico' IS NOT NULL THEN
           upper(btrim(v_row->>'monofasico')) IN ('TRUE','SIM','S','1')
      ELSE
           upper(translate(btrim(v_row->>'pis_cofins'),'ÃÁÀÉ','AAAE')) LIKE 'MONOF%'
    END;

    -- v3 · parse seguro (numerico) dos 3 novos campos
    v_raw_pv := btrim(COALESCE(v_row->>'preco_venda',''));
    v_raw_pc := btrim(COALESCE(v_row->>'preco_custo',''));
    v_raw_sd := btrim(COALESCE(v_row->>'saldo',''));
    v_preco_venda := NULL; v_preco_custo := NULL; v_saldo := NULL;
    IF v_raw_pv ~ '^-?[0-9]+([.,][0-9]+)?$' THEN
      v_preco_venda := replace(v_raw_pv, ',', '.')::numeric;
    END IF;
    IF v_raw_pc ~ '^-?[0-9]+([.,][0-9]+)?$' THEN
      v_preco_custo := replace(v_raw_pc, ',', '.')::numeric;
    END IF;
    IF v_raw_sd ~ '^-?[0-9]+([.,][0-9]+)?$' THEN
      v_saldo := replace(v_raw_sd, ',', '.')::numeric;
    END IF;

    v_status := 'verde'; v_msg := NULL;

    IF v_codigo = '' THEN
      v_nao_encontrados := v_nao_encontrados + 1;
      v_status := 'vermelho';
      v_msg := 'Linha sem codigo';
      v_detalhes := v_detalhes || jsonb_build_object(
        'codigo', NULL, 'status', v_status, 'msg', v_msg
      );
      CONTINUE;
    END IF;

    IF v_st THEN
      v_new_cst_icms := '500'; v_new_cfop := '5405';
      v_new_cest := NULLIF(v_cest, '');
    ELSE
      v_new_cst_icms := '102'; v_new_cfop := '5102';
      v_new_cest := NULL;
    END IF;

    IF v_mono THEN
      v_new_cst_pis := '04'; v_new_cst_cofins := '04';
    ELSE
      v_new_cst_pis := '49'; v_new_cst_cofins := '49';
    END IF;

    SELECT id, codigo, ncm, cest, cst_icms, cst_pis, cst_cofins, cfop_venda,
           preco_venda, preco_custo, estoque_atual
    INTO v_prod
    FROM erp_produtos
    WHERE company_id = p_company_id AND codigo = v_codigo
    LIMIT 1;

    IF v_prod IS NULL THEN
      v_nao_encontrados := v_nao_encontrados + 1;
      v_status := 'vermelho';
      v_msg := 'Codigo nao encontrado em erp_produtos';
      v_detalhes := v_detalhes || jsonb_build_object(
        'codigo', v_codigo, 'status', v_status, 'msg', v_msg,
        'depois', jsonb_build_object(
          'ncm', v_ncm, 'cest', v_new_cest, 'cst_icms', v_new_cst_icms,
          'cfop_venda', v_new_cfop, 'cst_pis', v_new_cst_pis, 'cst_cofins', v_new_cst_cofins,
          'preco_venda', v_preco_venda, 'preco_custo', v_preco_custo, 'saldo', v_saldo
        )
      );
      CONTINUE;
    END IF;

    IF (v_st AND COALESCE(v_cest,'') = '') THEN
      v_status := 'amarelo';
      v_msg := 'ST=SIM mas CEST nao informado';
      v_avisos := v_avisos + 1;
    ELSIF (NOT v_st AND COALESCE(v_cest,'') <> '') THEN
      v_status := 'amarelo';
      v_msg := 'ST=NAO mas CEST presente · CEST sera ignorado';
      v_avisos := v_avisos + 1;
    END IF;

    -- v3 · delta de saldo
    v_delta := NULL;
    IF v_saldo IS NOT NULL THEN
      v_delta := v_saldo - COALESCE(v_prod.estoque_atual, 0);
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'codigo', v_codigo,
      'status', v_status,
      'msg', v_msg,
      'antes', jsonb_build_object(
        'ncm', v_prod.ncm, 'cest', v_prod.cest, 'cst_icms', v_prod.cst_icms,
        'cfop_venda', v_prod.cfop_venda, 'cst_pis', v_prod.cst_pis, 'cst_cofins', v_prod.cst_cofins,
        'preco_venda', v_prod.preco_venda, 'preco_custo', v_prod.preco_custo,
        'estoque_atual', v_prod.estoque_atual
      ),
      'depois', jsonb_build_object(
        'ncm', COALESCE(NULLIF(v_ncm,''), v_prod.ncm),
        'cest', v_new_cest, 'cst_icms', v_new_cst_icms,
        'cfop_venda', v_new_cfop, 'cst_pis', v_new_cst_pis, 'cst_cofins', v_new_cst_cofins,
        'preco_venda', COALESCE(v_preco_venda, v_prod.preco_venda),
        'preco_custo', COALESCE(v_preco_custo, v_prod.preco_custo),
        'estoque_atual', COALESCE(v_saldo, v_prod.estoque_atual),
        'delta_saldo', v_delta
      )
    );

    -- contadores · sempre (refletem o que VAI mudar tambem em dry_run)
    IF v_preco_venda IS NOT NULL AND v_preco_venda IS DISTINCT FROM v_prod.preco_venda THEN
      v_precos_atualizados := v_precos_atualizados + 1;
    END IF;
    IF v_preco_custo IS NOT NULL AND v_preco_custo IS DISTINCT FROM v_prod.preco_custo THEN
      v_custos_atualizados := v_custos_atualizados + 1;
    END IF;
    IF v_delta IS NOT NULL AND v_delta <> 0 THEN
      v_saldos_ajustados := v_saldos_ajustados + 1;
    END IF;

    IF NOT p_dry_run THEN
      -- 1) fiscal + precos
      UPDATE erp_produtos
      SET ncm = COALESCE(NULLIF(v_ncm,''), ncm),
          cest = v_new_cest,
          cst_icms = v_new_cst_icms,
          cfop_venda = v_new_cfop,
          cst_pis = v_new_cst_pis,
          cst_cofins = v_new_cst_cofins,
          preco_venda = COALESCE(v_preco_venda, preco_venda),
          preco_custo = COALESCE(v_preco_custo, preco_custo),
          updated_at = now()
      WHERE id = v_prod.id;

      -- 2) saldo · grava movimentacao e atualiza estoque_atual
      IF v_delta IS NOT NULL AND v_delta <> 0 THEN
        IF v_delta > 0 THEN
          -- FIX-CUSTEIO-v1: roteia a ENTRADA pelo custeio unico —
          -- fn_movimentar_estoque calcula valor_total E propaga preco_custo_medio
          -- (media ponderada movel). Antes gravava direto e o custo medio ficava 0.
          PERFORM fn_movimentar_estoque(
            p_produto_id     := v_prod.id,
            p_local_id       := fn_estoque_local_principal(p_company_id),
            p_tipo           := 'entrada',
            p_quantidade     := abs(v_delta),
            p_custo_unitario := COALESCE(v_preco_custo, 0),
            p_motivo         := 'Saldo inicial - planilha',
            p_ref_tipo       := 'importacao'
          );
        ELSE
          -- saida de ajuste: nao altera custo medio (correto). valor_total
          -- garantido pela trigger trg_estoque_mov_valor_total.
          v_tipo_mov := 'ajuste_negativo';
          INSERT INTO erp_estoque_movimentacoes (
            company_id, produto_id, tipo, motivo, quantidade,
            quantidade_antes, quantidade_depois,
            custo_unitario, valor_total,
            ref_tipo, usuario_id, data_movimento
          ) VALUES (
            p_company_id, v_prod.id, v_tipo_mov, 'Saldo inicial - planilha',
            abs(v_delta),
            COALESCE(v_prod.estoque_atual, 0),
            v_saldo,
            v_preco_custo,
            CASE WHEN v_preco_custo IS NOT NULL THEN abs(v_delta) * v_preco_custo ELSE NULL END,
            'importacao', p_user_id, now()
          );
          UPDATE erp_produtos SET estoque_atual = v_saldo, updated_at = now()
           WHERE id = v_prod.id;
        END IF;
      END IF;
    END IF;

    v_atualizados := v_atualizados + 1;
  END LOOP;

  -- Semear fiscal_ncm_regras (sem alteracao vs versao anterior)
  IF NOT p_dry_run THEN
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(COALESCE(r->>'ncm',''), '\D','','g'))
        regexp_replace(COALESCE(r->>'ncm',''), '\D','','g') AS ncm,
        regexp_replace(COALESCE(r->>'cest',''), '\D','','g') AS cest,
        CASE
          WHEN COALESCE(r->>'st', r->>'icms_st') IS NULL THEN false
          ELSE upper(btrim(COALESCE(r->>'st', r->>'icms_st')))
               IN ('TRUE','SIM','S','1')
        END AS tem_st,
        CASE
          WHEN COALESCE(r->>'monofasico', r->>'pis_cofins') IS NULL THEN false
          WHEN r->>'monofasico' IS NOT NULL THEN
               upper(btrim(r->>'monofasico')) IN ('TRUE','SIM','S','1')
          ELSE
               upper(translate(btrim(r->>'pis_cofins'),'ÃÁÀÉ','AAAE')) LIKE 'MONOF%'
        END AS monofasico
      FROM jsonb_array_elements(p_rows) r
      WHERE regexp_replace(COALESCE(r->>'ncm',''), '\D','','g') <> ''
    )
    INSERT INTO fiscal_ncm_regras (ncm, uf, cest, tem_st, monofasico, fonte, confianca, atualizado_em)
    SELECT
      ncm, v_uf,
      CASE WHEN tem_st THEN NULLIF(cest,'') ELSE NULL END,
      tem_st, monofasico,
      'contador_' || p_company_id::text,
      'alta', now()
    FROM src
    ON CONFLICT (ncm, uf) DO UPDATE
      SET cest = EXCLUDED.cest,
          tem_st = EXCLUDED.tem_st,
          monofasico = EXCLUDED.monofasico,
          fonte = EXCLUDED.fonte,
          confianca = 'alta',
          atualizado_em = now();

    GET DIAGNOSTICS v_regras_aprendidas = ROW_COUNT;

    INSERT INTO erp_importacoes (
      company_id, user_id, sistema_origem, tipo_dado,
      registros_total, registros_novos, registros_atualizados, registros_erro,
      status, arquivo_nome, metadata, iniciado_em, concluido_em
    ) VALUES (
      p_company_id, p_user_id, 'planilha', 'produtos_fiscal',
      v_total, 0, v_atualizados, v_nao_encontrados,
      'concluido', p_arquivo,
      jsonb_build_object(
        'avisos', v_avisos,
        'regras_aprendidas', v_regras_aprendidas,
        'uf', v_uf,
        'precos_atualizados', v_precos_atualizados,
        'custos_atualizados', v_custos_atualizados,
        'saldos_ajustados', v_saldos_ajustados
      ),
      now(), now()
    ) RETURNING id INTO v_importacao_id;
  END IF;

  -- v3 · valor total do estoque (Σ estoque_atual * preco_custo)
  SELECT COALESCE(SUM(COALESCE(estoque_atual,0) * COALESCE(preco_custo,0)), 0)
    INTO v_valor_total_estoque
    FROM erp_produtos
   WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'importacao_id', v_importacao_id,
    'uf', v_uf,
    'total', v_total,
    'atualizados', v_atualizados,
    'fiscais_atualizados', v_atualizados,
    'precos_atualizados', v_precos_atualizados,
    'custos_atualizados', v_custos_atualizados,
    'saldos_ajustados', v_saldos_ajustados,
    'avisos', v_avisos,
    'nao_encontrados', v_nao_encontrados,
    'regras_aprendidas', v_regras_aprendidas,
    'valor_total_estoque', v_valor_total_estoque,
    'detalhes', v_detalhes
  );
END;
$function$;
