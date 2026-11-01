-- HB0 · HBF-0.3 (empresa DEMO irrigada) — BDI da semente da Construtora DEMO coerente com o preço e com o padrão.
-- Achado (banco 24/10, depois da #3083 "BDI visível na proposta"): os itens das 5 propostas DEMO-ORC-001..005 e das
-- obras DEMO saíam com bdi_percentual = 20, mas o preço da semente é custo × 1,35 (BDI real de 35%) e o BDI padrão da
-- empresa (projetos_modulo_config) é 31,86%. Resultado: a tela de Propostas acusava as 5 como "abaixo do padrão" e
-- "BDI no padrão 0 de 5" — número que não bate com o preço que a própria semente grava.
--
-- 1) fn_gold_hub_seed_reparar e fn_demo_seed_construtora: o BDI dos itens passa a ser 35 (= preço ÷ custo − 1 da semente).
--    Patch por âncora sobre o corpo VIVO (o resto das funções fica como está); aborta se a âncora sumir.
-- 2) fn_demo_seed_construtora: o BDI padrão criado quando a empresa ainda não tem configuração passa de 28,50 para
--    31,86 (o mesmo da produção; só vale para banco sem a linha de configuração — a existente não é tocada).
-- 3) Alinha os itens que já estão na DEMO 006 (só bdi_percentual = 20 → 35; preço, custo e subtotal não mudam, então o
--    total da proposta e os números da obra ficam iguais). Sem reset da demo.
-- RD-55: só a empresa demo 006 (is_demo) é tocada. Plano de volta: os mesmos replace ao contrário (35 → 20, 31.86 → 28.50)
-- e UPDATE … SET bdi_percentual = 20 WHERE company_id = '…0006' AND bdi_percentual = 35.

-- ci-sem-guarda: fn_gold_hub_seed_reparar / fn_demo_seed_construtora — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.fn_gold_hub_seed_reparar(uuid)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def,
    'round(s.custo_unitario_total*1.35,2), s.custo_unitario_total, 20,',
    'round(s.custo_unitario_total*1.35,2), s.custo_unitario_total, 35,');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_gold_hub_seed_reparar: âncora do BDI 20 dos itens da obra não encontrada';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure);
  v_new := replace(v_def,
    E'           20, round((round(s.custo_unitario_total * 1.35, 2) - s.custo_unitario_total)',
    E'           35, round((round(s.custo_unitario_total * 1.35, 2) - s.custo_unitario_total)');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: âncora do BDI 20 da proposta enviada não encontrada';
  END IF;
  v_def := v_new;
  v_new := replace(v_def, E'SELECT c, 28.50 WHERE NOT EXISTS', E'SELECT c, 31.86 WHERE NOT EXISTS');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: âncora do BDI padrão 28.50 não encontrada';
  END IF;
  EXECUTE v_new;
END
$mig$;

REVOKE ALL ON FUNCTION public.fn_gold_hub_seed_reparar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gold_hub_seed_reparar(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

DO $alinha$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    UPDATE erp_orcamentos_itens SET bdi_percentual = 35
     WHERE company_id = 'b0700000-0000-4000-a000-000000000006' AND bdi_percentual = 20;
    UPDATE projetos_obra_item SET bdi_percentual = 35
     WHERE company_id = 'b0700000-0000-4000-a000-000000000006' AND bdi_percentual = 20;
  END IF;
END
$alinha$;
