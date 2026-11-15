-- SEED DEMO Comércio GE — libera o DRE / DRE Divisional classificando o plano de contas.
--
-- Gap do auditor PDCA GE (rota /dashboard/dre-divisional): a DEMO "Comércio GE LTDA"
-- (id b0700000-0000-4000-a000-000000000004) tinha o plano de contas analítico SEM vínculo
-- ao DRE (psgc_depara vazio) -> o DRE Divisional real nunca populava (só empty state/aviso).
-- As 3 linhas de negócio (Varejo / Atacado / Serviços) já existem; falta o vínculo das contas.
--
-- Correção (um por PR pequena): classificar as contas analíticas (nível 3) da DEMO pelo MESMO
-- classificador por palavra-chave usado no onboarding de empresa REAL (fn_psgc_onboarding ->
-- fn_psgc_sugerir_conta, confiança >= 75). Nada de chute de contador: é o mesmo caminho
-- determinístico que roda para qualquer empresa nova (trigger trg_psgc_onboarding_nova_empresa).
--
-- Prova RD-38 (lida no dado, read-only, antes desta migration): das 75 contas nível 3 ativas da
-- DEMO, 61 recebem sugestão com confiança >= 75 -> cobertura ~81% -> dre_liberada = true
-- (fn_psgc_onboarding libera o DRE a partir de 70%). As demais (financeiro/investimento) ficam
-- para revisão manual na própria tela (RD-98) — comportamento idêntico ao de empresa real.
--
-- RD-69: só DEMO (guarda is_demo = true). Aditivo e idempotente: fn_psgc_onboarding faz
-- INSERT ... ON CONFLICT (company_id, origem_codigo, origem_sistema) DO NOTHING, então reexecutar
-- não duplica vínculo. Volume mínimo (uma empresa, ~75 contas) — sem varredura de tabela grande.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = 'b0700000-0000-4000-a000-000000000004' AND c.is_demo = true
     )
     AND EXISTS (
        SELECT 1 FROM public.erp_plano_contas pc
        WHERE pc.company_id = 'b0700000-0000-4000-a000-000000000004'
          AND pc.ativo AND pc.nivel = 3
     )
  THEN
    PERFORM public.fn_psgc_onboarding('b0700000-0000-4000-a000-000000000004'::uuid);
  END IF;
END $$;
