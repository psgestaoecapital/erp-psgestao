-- saneamento-verticais · alinha plan_catalog ao escopo comercial
-- A1: aposenta Comercio/Servicos (substituidos por Gestao Empresarial; 0 assinatura ativa)
-- A2: ativa Wealth/Agro (inicio de desenvolvimento)
UPDATE public.plan_catalog SET ativo = false
WHERE vertical IN ('commerce','services');

UPDATE public.plan_catalog SET ativo = true
WHERE id IN ('v15_wealth','v15_agro');
