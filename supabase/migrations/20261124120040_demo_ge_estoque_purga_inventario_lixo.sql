-- ============================================================================
-- Purga durável do lixo de TESTE em erp_inventarios da DEMO GE
-- (vazamento do spec de aceitação "E2E segurança", que cria+cancela inventário
--  na empresa DEMO de produção a cada ~20 min e nunca limpa).
--
-- RD-38 — provado no dado de produção (read-only) em 2026-11-22:
--   company_id = b0700000-0000-4000-a000-000000000004 (companies.is_demo = true)
--   • erp_inventarios na DEMO GE: 2.910 linhas, TODAS status='cancelado'.
--   • 2.910 batem a assinatura de teste:
--       numero ILIKE 'E2E%'                      (2.598)  +
--       observacoes ILIKE '%teste de aceita%' / '%E2E%'  (312, numero 'INV-...')
--   • Inventário REAL (fora da assinatura): 0 linhas → nada de cliente a proteger.
--   • Filho erp_inventario_itens (FK ON DELETE CASCADE): 3.222 linhas-lixo.
--
-- Mesma doutrina de #5747 (fn_demo_ge_receber_purgar_lixo_teste):
--   aditiva, idempotente, só DEMO (is_demo + id DEMO hardcoded), assinatura de
--   TESTE estrita (status='cancelado' + marcador E2E/aceitação), cópia de
--   segurança ANTES (reversível, RLS + REVOKE anon), auto-cura a cada
--   fn_demo_reset (PERFORM no início de fn_demo_seed_ge_comercial).
--   Nenhum dado de cliente real é tocado.
-- ============================================================================

-- ── Cópia de segurança (reversível): linha inteira antes de qualquer DELETE ──
CREATE TABLE IF NOT EXISTS public.erp_inventarios_lixo_teste_bkp_c3
  (LIKE public.erp_inventarios);
ALTER TABLE public.erp_inventarios_lixo_teste_bkp_c3
  ADD COLUMN IF NOT EXISTS purgado_em timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.erp_inventario_itens_lixo_teste_bkp_c3
  (LIKE public.erp_inventario_itens);
ALTER TABLE public.erp_inventario_itens_lixo_teste_bkp_c3
  ADD COLUMN IF NOT EXISTS purgado_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.erp_inventarios_lixo_teste_bkp_c3        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_inventario_itens_lixo_teste_bkp_c3  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_inventarios_lixo_teste_bkp_c3       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_inventario_itens_lixo_teste_bkp_c3  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_inventarios_lixo_teste_bkp_c3        TO service_role;
GRANT ALL ON public.erp_inventario_itens_lixo_teste_bkp_c3   TO service_role;

-- ── Função de limpeza reutilizável: hard-delete do lixo de TESTE na DEMO GE ──
-- erp_inventarios não tem deleted_at (sem soft-delete); a reversibilidade vem da
-- cópia bkp_c3 gravada ANTES do delete. O filho erp_inventario_itens cai por
-- CASCADE (também copiado antes). Nenhuma empresa real é tocada (guarda is_demo).
-- ci-sem-guarda: fn_demo_estoque_purgar_lixo_teste — função de DEMO: guarda por
--   is_demo (nunca toca empresa real), só service_role (REVOKE anon abaixo);
--   só apaga lixo de teste CANCELADO com marcador E2E/aceitação na DEMO GE.
CREATE OR REPLACE FUNCTION public.fn_demo_estoque_purgar_lixo_teste(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_ids uuid[];
  v_inv int := 0;
  v_itens int := 0;
BEGIN
  -- guarda dupla: só empresa DEMO e, dentro delas, só a DEMO GE conhecida
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo');
  END IF;
  IF p_company <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_ge');
  END IF;

  -- assinatura de TESTE estrita: cancelado + marcador E2E / "teste de aceitação"
  v_ids := ARRAY(
    SELECT id FROM public.erp_inventarios
    WHERE company_id = v_bot
      AND status = 'cancelado'
      AND (numero ILIKE 'E2E%'
           OR observacoes ILIKE '%teste de aceita%'
           OR observacoes ILIKE '%E2E%')
  );

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'inventarios_purgados', 0, 'itens_purgados', 0);
  END IF;

  -- backup reversível ANTES do delete (filho primeiro, depois pai)
  INSERT INTO public.erp_inventario_itens_lixo_teste_bkp_c3
  SELECT it.*, now()
  FROM public.erp_inventario_itens it
  WHERE it.inventario_id = ANY(v_ids);
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  INSERT INTO public.erp_inventarios_lixo_teste_bkp_c3
  SELECT inv.*, now()
  FROM public.erp_inventarios inv
  WHERE inv.id = ANY(v_ids);

  -- delete do pai; erp_inventario_itens cai por FK ON DELETE CASCADE
  DELETE FROM public.erp_inventarios
  WHERE company_id = v_bot AND id = ANY(v_ids);
  GET DIAGNOSTICS v_inv = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'inventarios_purgados', v_inv, 'itens_purgados', v_itens);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_estoque_purgar_lixo_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_estoque_purgar_lixo_teste(uuid) TO service_role;

-- ── Limpeza imediata do acúmulo atual (2.910 inventários + 3.222 itens) ──
DO $do$
DECLARE r jsonb;
BEGIN
  SELECT public.fn_demo_estoque_purgar_lixo_teste('b0700000-0000-4000-a000-000000000004') INTO r;
  RAISE NOTICE 'purga inventario DEMO GE: %', r;
END $do$;

-- ── Auto-cura: fn_demo_seed_ge_comercial chama o purge no início ──
-- Superset PURO do corpo vivo (origin/main) + 1 PERFORM logo após a guarda de
-- empresa. fn_demo_reset chama fn_demo_seed_ge_comercial, então a DEMO GE deixa
-- de re-acumular inventário-lixo a cada reset. Nenhuma outra linha alterada.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_comercial(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_mark text := 'seed:ge-comercial';
  v_motivo uuid;
  v_orc_ids uuid[]; v_ped_ids uuid[];
  v_new_orc uuid[] := '{}'; v_new_ped uuid[] := '{}';
  v_i int; v_j int; v_orc uuid; v_ped uuid;
  v_cli record; v_p1 record; v_p2 record;
  v_num text; v_total numeric; v_nparc int; v_vparc numeric; v_venc date;
  v_conv int := 0; v_fat int := 0; v_canc int := 0; v_aberto int := 0;
  v_leak_ped uuid[]; v_leak_orc uuid[];   -- vazamento e2e a purgar (durável)
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

  -- PURGA DURÁVEL do lixo de TESTE em erp_inventarios (spec "E2E segurança"/aceitação
  -- cria+cancela inventário na DEMO e nunca limpa). Idempotente, só DEMO, reversível (bkp_c3).
  PERFORM public.fn_demo_estoque_purgar_lixo_teste(v_bot);

  -- PURGA DURÁVEL do vazamento e2e ("Cliente Aceitação N"): os specs criam esses pedidos/orçamentos e nunca
  -- removem; sem esta purga o board volta a encher a cada run (histórico ~160 → 2216). Escopo estrito pelo nome
  -- do cliente de teste, só DEMO, idempotente. Filhos limpos por segurança (os de teste não têm erp_receber).
  v_leak_ped := ARRAY(SELECT id FROM erp_pedidos WHERE company_id=v_bot AND cliente_nome ILIKE 'Cliente Aceita%');
  IF array_length(v_leak_ped,1) > 0 THEN
    PERFORM set_config('app.permitir_delete_fisico','on',true);
    DELETE FROM erp_receber WHERE company_id=v_bot AND pedido_id = ANY(v_leak_ped);
    PERFORM set_config('app.permitir_delete_fisico','off',true);
    DELETE FROM erp_estoque_movimentacoes WHERE company_id=v_bot AND ref_tipo='pedido' AND ref_id = ANY(v_leak_ped);
    DELETE FROM erp_pedidos_parcelas WHERE company_id=v_bot AND pedido_id = ANY(v_leak_ped);
    DELETE FROM erp_pedidos_itens    WHERE company_id=v_bot AND pedido_id = ANY(v_leak_ped);
    DELETE FROM erp_pedidos          WHERE company_id=v_bot AND id = ANY(v_leak_ped);
  END IF;
  v_leak_orc := ARRAY(SELECT id FROM erp_orcamentos WHERE company_id=v_bot AND cliente_nome ILIKE 'Cliente Aceita%');
  IF array_length(v_leak_orc,1) > 0 THEN
    DELETE FROM erp_orcamentos_itens WHERE company_id=v_bot AND orcamento_id = ANY(v_leak_orc);
    DELETE FROM erp_orcamentos       WHERE company_id=v_bot AND id = ANY(v_leak_orc);
  END IF;

  -- motivo de perda (idempotente) para o cancelamento oficial
  SELECT id INTO v_motivo FROM erp_motivo_perda WHERE company_id=v_bot AND nome='Cliente desistiu (demo)' AND ativo LIMIT 1;
  IF v_motivo IS NULL THEN
    INSERT INTO erp_motivo_perda (company_id, nome, ativo, exige_descricao)
    VALUES (v_bot, 'Cliente desistiu (demo)', true, false) RETURNING id INTO v_motivo;
  END IF;

  -- RESET idempotente do que ESTE seed cria (ordem FK-safe; erp_receber é doc financeiro → escape)
  v_orc_ids := ARRAY(SELECT id FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark);
  v_ped_ids := ARRAY(SELECT id FROM erp_pedidos   WHERE company_id=v_bot AND observacoes=v_mark);
  IF array_length(v_ped_ids,1) > 0 THEN
    PERFORM set_config('app.permitir_delete_fisico','on',true);
    DELETE FROM erp_receber WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    PERFORM set_config('app.permitir_delete_fisico','off',true);
    DELETE FROM erp_estoque_movimentacoes WHERE company_id=v_bot AND ref_tipo='pedido' AND ref_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos_parcelas WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos_itens    WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos          WHERE company_id=v_bot AND id = ANY(v_ped_ids);
  END IF;
  IF array_length(v_orc_ids,1) > 0 THEN
    DELETE FROM erp_orcamentos_itens WHERE company_id=v_bot AND orcamento_id = ANY(v_orc_ids);
    DELETE FROM erp_orcamentos       WHERE company_id=v_bot AND id = ANY(v_orc_ids);
  END IF;

  -- 10 orçamentos (cada um: 2 produtos do estoque demo), cliente distinto
  FOR v_i IN 1..10 LOOP
    SELECT id, nome_fantasia INTO v_cli FROM erp_clientes
      WHERE company_id=v_bot ORDER BY created_at, id OFFSET (v_i-1) LIMIT 1;
    SELECT id,codigo,nome,preco_venda,preco_custo_medio INTO v_p1 FROM erp_produtos
      WHERE company_id=v_bot AND codigo='GE-P'||lpad((8+v_i)::text,3,'0');
    SELECT id,codigo,nome,preco_venda,preco_custo_medio INTO v_p2 FROM erp_produtos
      WHERE company_id=v_bot AND codigo='GE-P'||lpad((20+v_i)::text,3,'0');
    v_num := next_orcamento_numero(v_bot);
    INSERT INTO erp_orcamentos (company_id, numero, edicao_liberada, cliente_id, cliente_nome, status, observacoes, total)
    VALUES (v_bot, v_num, false, v_cli.id, v_cli.nome_fantasia, 'rascunho', v_mark, 0)
    RETURNING id INTO v_orc;
    INSERT INTO erp_orcamentos_itens
      (orcamento_id, company_id, ordem, tipo_item, produto_id, produto_codigo, produto_nome, unidade, quantidade, preco_unitario, preco_custo, subtotal)
    VALUES
      (v_orc, v_bot, 0, 'produto', v_p1.id, v_p1.codigo, v_p1.nome, 'UN', (1+v_i), v_p1.preco_venda, v_p1.preco_custo_medio, round((1+v_i)*v_p1.preco_venda, 2)),
      (v_orc, v_bot, 1, 'produto', v_p2.id, v_p2.codigo, v_p2.nome, 'UN', 2,        v_p2.preco_venda, v_p2.preco_custo_medio, round(2*v_p2.preco_venda, 2));
    -- garante o total do cabeçalho independente de trigger
    UPDATE erp_orcamentos SET total = (SELECT COALESCE(sum(subtotal),0) FROM erp_orcamentos_itens WHERE orcamento_id=v_orc)
      WHERE id=v_orc;
    v_new_orc := array_append(v_new_orc, v_orc);
  END LOOP;

  -- 7 aprovados → convertidos em pedido (oficial). 3 ficam sem converter (enviado/rascunho/enviado)
  FOR v_i IN 1..7 LOOP
    UPDATE erp_orcamentos SET status='aprovado' WHERE id=v_new_orc[v_i];
    v_ped := fn_converter_orcamento_em_pedido(v_new_orc[v_i]);
    v_new_ped := array_append(v_new_ped, v_ped);
    v_conv := v_conv + 1;
  END LOOP;
  UPDATE erp_orcamentos SET status='enviado'  WHERE id=v_new_orc[8];
  UPDATE erp_orcamentos SET status='rascunho' WHERE id=v_new_orc[9];
  UPDATE erp_orcamentos SET status='enviado'  WHERE id=v_new_orc[10];

  -- 5 pedidos faturados (parcelas 1..3, vencidos e a vencer) → fn_faturar gera erp_receber + baixa estoque + CMV
  FOR v_i IN 1..5 LOOP
    v_ped := v_new_ped[v_i];
    SELECT total INTO v_total FROM erp_pedidos WHERE id=v_ped;
    v_nparc := 1 + (v_i % 3);
    FOR v_j IN 1..v_nparc LOOP
      v_vparc := round(v_total / v_nparc, 2);
      v_venc  := CURRENT_DATE + (v_j*30) - (v_i*7);   -- mistura vencidos e a vencer
      INSERT INTO erp_pedidos_parcelas (company_id, pedido_id, numero, valor, vencimento, gerar_boleto)
      VALUES (v_bot, v_ped, v_j, v_vparc, v_venc, false);
    END LOOP;
    PERFORM fn_faturar(v_ped);
    v_fat := v_fat + 1;
  END LOOP;

  -- 1 pedido cancelado (oficial) e 1 pedido aberto (não faturado)
  PERFORM fn_pedido_cancelar(v_new_ped[6], v_motivo, 'cliente desistiu (demo)');
  v_canc := 1;
  v_aberto := 1;

  -- Cotação-exemplo multi-fornecedor (jornada cotação -> comparativo -> pedido)
  PERFORM fn_demo_seed_ge_cotacao(v_bot);

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'comercial',
    'orcamentos', (SELECT count(*) FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark),
    'orcamentos_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark GROUP BY status) s),
    'pedidos', (SELECT count(*) FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark),
    'pedidos_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark GROUP BY status) s),
    'receber_gerado', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot
       AND pedido_id IN (SELECT id FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark)),
    'convertidos', v_conv, 'faturados', v_fat, 'cancelados', v_canc, 'abertos', v_aberto,
    'cotacoes_exemplo', (SELECT count(*) FROM erp_cotacoes WHERE company_id=v_bot AND observacoes='seed:ge-comercial-cotacao')
  );
END $function$;
