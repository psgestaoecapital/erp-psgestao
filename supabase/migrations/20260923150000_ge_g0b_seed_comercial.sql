-- GE · Onda G0b · Demonstração Comércio GE — COMERCIAL (Bloco 2 do seed, RD-69).
-- Sub-seed fn_demo_seed_ge_comercial(company) encadeado no braço 004 do fn_demo_reset
-- (padrão garantia/leads da Revenda). Funil oficial: orçamento → pedido → faturamento.
--
-- Depende de G0a (fn_gold_ge_seed_reparar cadastros) já aplicado — usa clientes e produtos demo.
-- Conteúdo: 10 orçamentos → 7 convertidos em pedido → 5 faturados (gera erp_receber aberto,
-- baixa estoque, CMV) + 1 cancelado + 1 aberto; 3 orçamentos ficam sem converter.
--
-- Caminhos oficiais provados: fn_converter_orcamento_em_pedido (sem guarda de empresa),
-- fn_faturar (escape service_role) e fn_pedido_cancelar (escape service_role/interno).
-- Os ITENS do orçamento são inseridos direto (fn_orcamento_salvar_itens guarda por
-- get_user_company_ids() SEM escape de service_role — bloquearia o seed via cron), replicando
-- o cálculo de subtotal. "Nunca título na mão": os erp_receber vêm do fn_faturar, não de insert.
-- Idempotente: marcador observacoes='seed:ge-comercial' (herdado pelo pedido na conversão).

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_comercial(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

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
    'convertidos', v_conv, 'faturados', v_fat, 'cancelados', v_canc, 'abertos', v_aberto
  );
END $function$;

-- fn_demo_reset: no braço 004, encadeia o comercial (Bloco 2) após os cadastros (Bloco 1) e junta a contagem.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb; v_leads jsonb; v_com jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  -- GE (Comércio): cadastros (bloco 1) já rodaram acima; encadeia o comercial (bloco 2)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_comercial(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_comercial(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)             TO authenticated, service_role;
