-- Hub · Construtora DEMO (…0006): custo previsto nas tarefas do cronograma das obras DEMO-OB-* (caixa 61297941, 24H GOLD).
-- As 4 obras DEMO-OB-001..004 tinham cronograma sem custo_previsto (null) → físico-financeiro e "Custo previsto total"
-- zerados na demo. A obra FC (DEMO-FC-001) já semeia o próprio custo.
-- 1) fn_demo_seed_construtora_custo_tarefa(company) — função NOVA, só na 006 e só se is_demo; sem GRANT a usuário.
--    Regra (conferível à mão): custo da obra = Σ itens (quantidade_contratada × custo_unitario_previsto, sem excluídos),
--    repartido pelas etapas por peso fixo da ordem — 1 Mobilização 5% · 2 Estrutura 35% · 3 Fechamento 40% · 4 Pintura 20%
--    (pesos renormalizados se faltar etapa; etapa fora de 1..4 não recebe). Arredonda a 2 casas e a ÚLTIMA etapa leva o
--    resto, então Σ custo_previsto das tarefas = custo dos itens, ao centavo. Só faz UPDATE de custo_previsto.
-- 2) fn_demo_seed_construtora: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir).
-- 3) Roda uma vez agora só a função nova (não o reset inteiro), se a 006 existir e for demo.
-- RD-55: nenhuma empresa real é tocada. Plano de volta: tirar a linha PERFORM fn_demo_seed_construtora_custo_tarefa do
-- fn_demo_seed_construtora (CREATE OR REPLACE pelo corpo vivo) e DROP FUNCTION fn_demo_seed_construtora_custo_tarefa.

-- ci-sem-guarda: fn_demo_seed_construtora_custo_tarefa — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_custo_tarefa(p_company_id uuid)
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

  WITH custo AS (
    SELECT o.id AS obra_id, round(sum(i.quantidade_contratada * i.custo_unitario_previsto), 2) AS total
      FROM projetos_obras o JOIN projetos_obra_item i ON i.obra_id = o.id AND i.excluido_em IS NULL
     WHERE o.company_id = c AND o.numero LIKE 'DEMO-OB-%'
     GROUP BY o.id
  ), tar AS (
    SELECT t.id, t.obra_id, k.total,
           (ARRAY[5, 35, 40, 20]::numeric[])[t.ordem] AS peso,
           sum((ARRAY[5, 35, 40, 20]::numeric[])[t.ordem]) OVER (PARTITION BY t.obra_id) AS peso_obra,
           row_number() OVER (PARTITION BY t.obra_id ORDER BY t.ordem DESC) AS rev
      FROM projetos_obra_tarefa t JOIN custo k ON k.obra_id = t.obra_id
     WHERE t.company_id = c AND t.excluido_em IS NULL AND t.ordem BETWEEN 1 AND 4
  ), parte AS (
    SELECT id, obra_id, total, rev, round(total * peso / peso_obra, 2) AS valor FROM tar
  ), final AS (
    SELECT id, CASE WHEN rev = 1
                    THEN total - COALESCE(sum(valor) FILTER (WHERE rev > 1) OVER (PARTITION BY obra_id), 0)
                    ELSE valor END AS valor
      FROM parte
  )
  UPDATE projetos_obra_tarefa t SET custo_previsto = f.valor
    FROM final f WHERE t.id = f.id AND t.company_id = c;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'tarefas_com_custo', v_n);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_custo_tarefa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_custo_tarefa(uuid) TO service_role;

-- liga na semente principal: depois da semente FC (cronograma das DEMO-OB já criado pelo fn_gold_hub_cronograma_seed_reparar)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_custo_tarefa' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_fc(c, ''semear'');',
    E'  PERFORM fn_demo_seed_construtora_fc(c, ''semear'');\n  PERFORM fn_demo_seed_construtora_custo_tarefa(c);');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da semeadura (fc semear) nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- aplica agora (só se a demo existir neste banco): só o custo das tarefas, sem refazer a semente inteira
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora_custo_tarefa('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
