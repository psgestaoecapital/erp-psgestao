-- RD-98 p3 (ORIGEM DO DADO): completar system_screens da tela /dashboard/pm/configuracoes.
-- Único gap da auditoria aud8 95/95 (auditor_pdca_2): a aba "Medição por etapa" usa fontes
-- que não constavam na origem do dado da rota. Nada de código de tela muda.
-- Aditivo: só metadado em system_screens. Idempotente (append + DISTINCT, filtrado pela rota).
--   rpcs_chamadas  += fn_agency_etapa_medicao_listar, fn_agency_etapa_medicao_salvar
--   views_consumidas += agency_clientes (seletor de escopo por cliente da aba Medição)
UPDATE public.system_screens
SET rpcs_chamadas = (
      SELECT array_agg(DISTINCT x ORDER BY x)
      FROM unnest(
        COALESCE(rpcs_chamadas, ARRAY[]::text[])
        || ARRAY['fn_agency_etapa_medicao_listar','fn_agency_etapa_medicao_salvar']::text[]
      ) AS x
    ),
    views_consumidas = (
      SELECT array_agg(DISTINCT x ORDER BY x)
      FROM unnest(
        COALESCE(views_consumidas, ARRAY[]::text[])
        || ARRAY['agency_clientes']::text[]
      ) AS x
    )
WHERE rota = '/dashboard/pm/configuracoes';
