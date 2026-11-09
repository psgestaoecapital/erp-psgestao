-- PDCA GE (auditor_pdca_2 · tarefa 6d58bdcc) — jornada de precificacao demonstravel no DEMO Comercio GE.
--
-- DIAGNOSTICO RD-38 (producao, 08/11) — empresa DEMO "Comercio (GE)" b0700000-0000-4000-a000-000000000004
--   (is_demo=true): dos 757 produtos precificados, so 40 tinham custo (os GE-P### do seed comercial). Os
--   outros 717 sao ARTEFATOS DE TESTE E2E (codigo E2E-CFOP-*) deixados pela suite de aceitacao no DEMO:
--   tem preco_venda mas nunca receberam custo. Logo a coluna de margem/markup do painel
--   (fn_produtos_precos_painel) ficava vazia para ~95% do catalogo precificado => a jornada "definir preco a
--   partir de custo+markup e VER a margem" nao era demonstravel.
--   NAO e erro de calculo (nos 40 com custo a margem media e ~60% e nenhum abaixo do custo) nem bug de
--   pipeline de custo medio: so existem 4 itens em erp_nfe_recebidas_itens para 1606 NF-e recebidas — as
--   NF-e demo sao so cabecalho (nao ha item para o custo medio de entrada fluir). Nada a corrigir no backend.
--
-- CORRECAO (RD-69, 100% dado FAKE de demonstracao; aditiva/idempotente): preenche preco_custo_medio nos
--   produtos precificados SEM custo da empresa DEMO, com custo = preco_venda * fator deterministico por id
--   (fator 0.40..0.70 => margem 30%..60%, media ~45%, ZERO abaixo do custo). So onde o custo esta ausente
--   (idempotente: re-rodar nao altera nada que ja tenha custo, inclusive os 40 GE-P### legitimos).
--   NAO toca dado de cliente (guarda is_demo IS TRUE), nao altera RLS/fiscal/financeiro/calculo. Como
--   fn_demo_reset NAO apaga erp_produtos, o custo preenchido persiste entre resets.
--
-- PROVA RD-38 (no PR): antes 40/757 precificados com custo; depois 757/757; 0 produtos abaixo do custo.
-- RD-52: arquivo+PR; nao aplicado via MCP. Faixa segundos :35 (code-desenvolvedor-3).

DO $$
DECLARE
  v_demo  uuid := 'b0700000-0000-4000-a000-000000000004';
  v_n     int;
BEGIN
  -- guarda RD-69: so a empresa DEMO; qualquer ambiente sem essa demo (ou nao-demo) nao e tocado
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo AND is_demo IS TRUE) THEN
    RAISE NOTICE 'empresa % ausente ou nao-demo — nada a fazer (precificacao demo)', v_demo;
    RETURN;
  END IF;

  UPDATE public.erp_produtos p
     SET preco_custo_medio = round(
           p.preco_venda * (0.40 + (('x' || substr(md5(p.id::text), 1, 4))::bit(16)::int % 31) / 100.0),
           2),
         updated_at = now()
   WHERE p.company_id = v_demo
     AND coalesce(p.preco_venda, 0)       > 0
     AND coalesce(p.preco_custo_medio, 0) = 0
     AND coalesce(p.preco_custo, 0)       = 0;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'precificacao demo: preco_custo_medio preenchido em % produtos precificados sem custo', v_n;
END $$;
