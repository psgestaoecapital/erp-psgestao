-- Decisão do CEO (26/09): a demonstração Comércio (GE) usada pelos testes tem o plano GE Pró completo.
-- "Empresa de demonstração existe para exercitar o produto inteiro; sem o plano completo, telas que só existem no
-- Pró nunca são testadas." Ex.: a listagem de contas a pagar/receber (fn_ge_listagem_v2) devolve sem_plano sem
-- tenant_subscriptions v15_gestao_empresarial_pro ativo — e o ✏️ do #71 nunca aparecia na aceitação.
-- Causa de a demo estar sem o plano: fn_demo_seed_ge_dre (migration 20260923270000) já cria essa assinatura dentro
-- do fn_demo_reset, mas o reset da GE não rodou depois daquela migration. O reset segue mantendo o plano (idempotente).
-- SÓ DEMONSTRAÇÃO: guarda por is_demo; nenhuma empresa real muda de plano. R$ 0 e fora do MRR (fn_empresas_produtivas
-- exclui demos). Mesmos valores do seed oficial (active, R$ 0, monthly, tier pro).
DO $$
DECLARE c uuid := 'b0700000-0000-4000-a000-000000000004';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Comércio (GE) - DEMO não existe ou não é demo — nada a fazer';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE company_id = c AND plan_id = 'v15_gestao_empresarial_pro') THEN
    UPDATE public.tenant_subscriptions SET status = 'active', monthly_price_brl = 0, updated_at = now()
     WHERE company_id = c AND plan_id = 'v15_gestao_empresarial_pro'
       AND (status IS DISTINCT FROM 'active' OR monthly_price_brl IS DISTINCT FROM 0);
  ELSE
    INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
    VALUES (c, 'v15_gestao_empresarial_pro', 'active', 0, 'monthly', 'pro', 'Demonstração · decisão CEO 26/09 (plano completo para testes)');
  END IF;
END $$;
