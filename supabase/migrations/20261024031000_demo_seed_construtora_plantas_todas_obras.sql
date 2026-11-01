-- Hub · semente da Construtora DEMO (Eng. Chefe 23/10, caixa 61297941 "24H ESTABILIZAR"): "cada obra com cronograma,
-- apontamento, orçamento com itens+BOM e plantas de takeoff". Conferido no banco 24/10: as 4 obras DEMO-OB-001..004 já
-- têm cronograma (4 tarefas, 3 dependências, linha de base), apontamentos, orçamento aprovado e BOM fechando com o custo
-- do serviço; só a PLANTA de takeoff ficava nas 2 primeiras obras (OB-003 e OB-004 sem planta → takeoff vazio).
--
-- 1) fn_demo_seed_construtora: a planta confirmada (3 ambientes → serviço) passa a ser criada em TODAS as obras demo.
--    Patch por âncora sobre o corpo VIVO (o resto da função fica como está); aborta se a âncora sumir.
--    Os ambientes "Sala"/"Recepção" usam o serviço DEMO-S0<n> da obra (S01..S04 existem) e a divisória usa o S02.
-- 2) Roda a semente uma vez agora (só se a 006 existir e for demo), como a migration de origem.
-- RD-55: nenhuma empresa real é tocada (a função recusa qualquer empresa que não seja a demo 006).
-- Plano de volta: CREATE OR REPLACE com a condição antiga (IF v_obra.n <= 2 THEN) e SELECT fn_demo_seed_construtora(...).

-- ci-sem-guarda: fn_demo_seed_construtora — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def,
    E'    -- planta de takeoff confirmada nas 2 primeiras obras\n    IF v_obra.n <= 2 THEN',
    E'    -- planta de takeoff confirmada em todas as obras demo\n    IF v_obra.n >= 1 THEN');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: âncora da planta nas 2 primeiras obras não encontrada';
  END IF;
  EXECUTE v_new;
END
$mig$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora('b0700000-0000-4000-a000-000000000006');
  END IF;
END
$seed$;
