-- RD-98 p3 (origem do dado) · Linhas de negócio (GE) — gap do auditor: system_screens.views_consumidas e
-- rpcs_chamadas vazios na rota /dashboard/linhas-negocio. A tela consome, pelas rotas /api/linhas-negocio,
-- /api/linhas-negocio/budget e /api/linhas-negocio/dre, as tabelas linhas_negocio, linhas_negocio_budget e
-- lancamentos (o benchmark deriva da DRE, sem fonte própria). Nenhuma RPC é chamada diretamente.
-- Só preenche se estiver NULL — não sobrescreve ajuste manual. Metadata de sistema, sem dado de cliente.

UPDATE public.system_screens
SET views_consumidas = ARRAY['linhas_negocio','linhas_negocio_budget','lancamentos'],
    rpcs_chamadas    = ARRAY[]::text[]
WHERE rota = '/dashboard/linhas-negocio'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
