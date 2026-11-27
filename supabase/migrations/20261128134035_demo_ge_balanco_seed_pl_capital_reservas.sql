-- DEMO GE (Comércio GE - DEMO, b0700000-0000-4000-a000-000000000004):
-- semeia o Patrimônio Líquido (Capital social + Reservas) no Balanço Patrimonial.
--
-- PROBLEMA (auditor_pdca_2, PDCA GE 26/11, provado no dado — RD-38): a DEMO GE não tinha
-- Capital Social/Reservas cadastrados, então o PL "informado" ficava só o resultado do
-- exercício (negativo) e o fechamento gerava a linha-plug "Resultado/ajuste a apurar
-- (fechamento)" ~ R$ 227 mil (≈ 43% do ativo) na visão padrão (hoje / mês corrente).
-- Num demo para cliente isso parece erro/desbalanço.
--
-- CÁLCULO NÃO REGRIDE: fn_balanco_patrimonial continua igual. Aqui só entram LINHAS MANUAIS
-- de PL (tabela balanco_patrimonial) para a DEMO, de modo que o balanço conte a história real
-- (Ativo = Passivo + PL) e o "ajuste a apurar" da visão padrão caia para ~0. Qualquer resíduo
-- por deriva dos dados vivos da DEMO continua SINALIZADO honestamente pela própria tela
-- ("✓ Balanço fecha (com ajuste a apurar)" / "⚠️ Patrimônio Líquido a apurar").
--
-- SÓ-DEMO: toda escrita é guardada por companies.is_demo = true E pelo id fixo da DEMO GE.
-- Nenhuma estrutura é alterada (DDL), nenhum dado de cliente é tocado. Idempotente: remove a
-- própria semente anterior (marca em obs) antes de reinserir. Valor computado no apply-time a
-- partir do próprio plug, para o balanço da visão padrão fechar na data da aplicação.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000004';
  v_periodo text := '2026-11';           -- visão padrão da tela = hoje / mês corrente
  v_data_ref date := '2026-11-26';        -- data-base padrão (hoje)
  v_is_demo boolean;
  v_plug numeric;
  v_capital numeric;
  v_reservas numeric;
  v_marca text := 'seed DEMO so-demo PL (code-desenvolvedor-3)';
BEGIN
  -- Guarda dupla de segurança: só age se a empresa EXISTE e É demo.
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = v_company;
  IF v_is_demo IS DISTINCT FROM true THEN
    RAISE NOTICE 'DEMO GE ausente ou não-demo (%): seed de PL ignorado.', v_company;
    RETURN;
  END IF;

  -- Idempotência: remove a semente anterior desta migration (se houver) antes de recriar.
  DELETE FROM public.balanco_patrimonial
   WHERE company_id = v_company AND periodo = v_periodo AND obs = v_marca;

  -- Plug atual (ajuste a apurar) da visão padrão, SEM as linhas que vamos semear.
  SELECT (public.fn_balanco_patrimonial(v_company, v_data_ref) ->> 'ajuste_apurar')::numeric
    INTO v_plug;

  -- Só faz sentido semear Capital/Reservas quando falta PL (plug > 0 = Ativo acima de Passivo+PL).
  IF COALESCE(v_plug, 0) <= 0.01 THEN
    RAISE NOTICE 'Plug não positivo (%); nada a semear.', v_plug;
    RETURN;
  END IF;

  -- Divide o PL faltante em Capital social (90%) + Reservas de lucros (resto), ambos positivos,
  -- somando EXATAMENTE o plug → fecha a visão padrão em ~0.
  v_capital  := ROUND(v_plug * 0.90, 2);
  v_reservas := ROUND(v_plug - v_capital, 2);

  INSERT INTO public.balanco_patrimonial (id, company_id, lado, grupo, subgrupo, nome, valor, obs, periodo, ordem)
  VALUES
    (gen_random_uuid(), v_company, 'pl', 'PATRIMÔNIO LÍQUIDO', NULL, 'Capital social',       v_capital,  v_marca, v_periodo, 10),
    (gen_random_uuid(), v_company, 'pl', 'PATRIMÔNIO LÍQUIDO', NULL, 'Reservas de lucros',    v_reservas, v_marca, v_periodo, 11);

  RAISE NOTICE 'DEMO GE PL semeado: Capital social %, Reservas %, plug antes %.', v_capital, v_reservas, v_plug;
END $$;
