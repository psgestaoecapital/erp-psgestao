-- RD-98 p3 (ORIGEM DO DADO): popular system_screens.views_consumidas e rpcs_chamadas
-- para /dashboard/analises, que estavam NULL (apontado pelo auditor; as irmãs da GE
-- já têm preenchido). Aditiva e idempotente: só atualiza a linha quando ainda está NULL,
-- preservando qualquer preenchimento futuro.
--
-- Origem verificada no código vivo (RD-38):
--   page.tsx + components (BalancoPatrimonial/IndicadoresFinanceiros/FluxoCaixa/AnaliseIAFlags)
--   leem via PostgREST: ai_reports, balanco_patrimonial, companies, company_groups,
--   erp_pagar, erp_receber, financiamentos, omie_imports, user_companies, users.
--   O backbone analítico vem das rotas /api/report/* que agregam:
--   m2_dre_divisional, m3_dre_sede, business_lines.
--   Não há chamada a RPC de banco (.rpc) — os dados vêm de tabelas/views e das rotas /api/report;
--   portanto rpcs_chamadas = '{}' (vazio, honesto), não NULL.
-- Todas as relações existem no catálogo (public).

UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'ai_reports','balanco_patrimonial','companies','company_groups',
      'erp_pagar','erp_receber','financiamentos','omie_imports',
      'user_companies','users','m2_dre_divisional','m3_dre_sede','business_lines'
    ]::text[]
WHERE rota = '/dashboard/analises'
  AND views_consumidas IS NULL;

UPDATE public.system_screens
SET rpcs_chamadas = '{}'::text[]
WHERE rota = '/dashboard/analises'
  AND rpcs_chamadas IS NULL;
