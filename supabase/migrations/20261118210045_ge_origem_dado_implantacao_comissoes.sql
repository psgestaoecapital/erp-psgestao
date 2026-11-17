-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas
-- de duas telas da Gestão Empresarial que ainda estavam sem a origem do dado registrada.
-- Listas extraídas do grep de .from()/.rpc() do código vivo (page.tsx + componentes).
-- Aditivo, idempotente (fill-se-vazio: só grava onde ainda está NULL), só metadado de tela.

-- /dashboard/gestao-empresarial/implantacao — Guia de Implantação (wizard 5 passos).
-- O page.tsx chama apenas a RPC fn_ge_onboarding_status; OnboardingFiveSteps é
-- apresentacional (recebe os dados por prop, não consulta nada) => sem views diretas.
UPDATE public.system_screens
SET views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[]),
    rpcs_chamadas     = COALESCE(rpcs_chamadas, ARRAY['fn_ge_onboarding_status']::text[])
WHERE rota = '/dashboard/gestao-empresarial/implantacao'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);

-- /dashboard/gestao-empresarial/comissoes-recorrentes — rpcs_chamadas já estava
-- preenchida; faltava só views_consumidas (as tabelas lidas direto por .from()).
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'erp_comissao_recorrente_evento',
      'erp_comissao_recorrente_regra',
      'erp_contratos',
      'erp_fornecedores'
    ]::text[]
WHERE rota = '/dashboard/gestao-empresarial/comissoes-recorrentes'
  AND views_consumidas IS NULL;
