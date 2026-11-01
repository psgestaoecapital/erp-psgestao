-- Hub · Construtora DEMO (…0006): receita realizada nas obras DEMO (caixa 372ac086, cockpit 76→95 — "dado real, RD-98 p1").
-- Problema (provado no banco 27/10): v_obra_resultado_alocado das 5 obras DEMO tem receita_servico = receita_material = 0
-- e custo de mão de obra > 0 → cockpit/obras/resultado mostram "Sem medição" e margem negativa falsa.
-- A medição de serviço exige NFS-e emitida (erp_nfse_emitidas) e o gatilho trg_bloqueia_emissao_demo PROÍBE emissão em
-- empresa de demonstração — esse guarda fiscal NÃO é contornado. A receita entra pela via comercial (erp_pedidos.obra_id →
-- receita_material, já lida pela v_obra_resultado), sem tocar fiscal.
-- Regra (conferível à mão), por obra DEMO com itens contratados:
--   pedido = receita_prevista × pct_conclusao / 100 (2 casas) · status 'faturado' · cmv = 55% do pedido (custo do material).
-- Idempotente: numero PED-DEMO-<obra>, UNIQUE (company_id, numero); reexecutar atualiza valores e não duplica.
-- Só a empresa 006 e só se is_demo; função sem GRANT a usuário (roda pelo fn_demo_seed_construtora, service_role).
-- RD-55: nenhuma empresa real é tocada. Plano de volta: tirar o PERFORM do fn_demo_seed_construtora (CREATE OR REPLACE pelo
-- corpo vivo) e DROP FUNCTION fn_demo_seed_construtora_receita; os pedidos PED-DEMO-* podem ser removidos pela cópia (o fn_demo_reset hoje não limpa erp_pedidos; o upsert mantém tudo estável).

-- ci-sem-guarda: fn_demo_seed_construtora_receita — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_receita(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_n int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  WITH base AS (
    SELECT o.id AS obra_id, o.numero,
           round(sum(i.valor_contratado) * COALESCE(o.pct_conclusao, 0) / 100, 2) AS total
      FROM projetos_obras o JOIN projetos_obra_item i ON i.obra_id = o.id AND i.excluido_em IS NULL
     WHERE o.company_id = c AND o.numero LIKE 'DEMO-%' AND o.status IN ('em_andamento', 'concluida')
     GROUP BY o.id, o.numero, o.pct_conclusao
  ), ins AS (
    INSERT INTO erp_pedidos (company_id, numero, obra_id, status, subtotal, total, cmv, cliente_nome, data_pedido, data_faturamento)
    SELECT c, 'PED-' || b.numero, b.obra_id, 'faturado', b.total, b.total, round(b.total * 0.55, 2),
           'Cliente demonstração', current_date - 30, current_date - 5
      FROM base b WHERE b.total > 0
    ON CONFLICT (company_id, numero) DO UPDATE
      SET obra_id = EXCLUDED.obra_id, status = 'faturado', subtotal = EXCLUDED.subtotal, total = EXCLUDED.total, cmv = EXCLUDED.cmv
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN jsonb_build_object('ok', true, 'pedidos_com_receita', v_n);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_receita(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_receita(uuid) TO service_role;

-- liga na semente principal, logo depois do custo das tarefas (corpo vigente preservado — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_receita' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_custo_tarefa(c);',
    E'  PERFORM fn_demo_seed_construtora_custo_tarefa(c);\n  PERFORM fn_demo_seed_construtora_receita(c);');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora (custo_tarefa) nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- aplica agora (só se a demo existir neste banco): só a receita, sem refazer a semente inteira
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora_receita('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
