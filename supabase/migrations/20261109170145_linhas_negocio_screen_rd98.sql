-- RD-98 p3 (origem do dado) · Linhas de negócio (GE) — gap do auditor: system_screens.views_consumidas e
-- rpcs_chamadas vazios na rota /dashboard/linhas-negocio.
--
-- RD-38 (provar no dado): só se registra como origem a relação PROVADA no banco. A tela consome, pelas rotas
-- /api/linhas-negocio e /api/linhas-negocio/budget, as tabelas `linhas_negocio` e `linhas_negocio_budget`
-- (ambas conferidas em pg_class: existem como tabela, com as colunas usadas pelas rotas — empresa_id/ativo/nome
-- em linhas_negocio; empresa_id/ano/mes/linha_id em linhas_negocio_budget). O benchmark deriva da DRE (sem fonte
-- própria) e nenhuma RPC é chamada diretamente (rpcs_chamadas = []).
--
-- NÃO se registra `lancamentos`: essa relação NÃO EXISTE no banco (0 em pg_class, em todos os schemas), nem
-- qualquer relação com as colunas data_lancamento + empresa_id + linha_negocio_id que /api/linhas-negocio/dre
-- usa em .from('lancamentos'). Registrar uma fonte inexistente no catálogo seria "desconhecido disfarçado de
-- conhecido" (pior que NULL). A rota do DRE aponta para essa relação-fantasma — bug latente registrado para fix
-- separado (não há relação correta para onde apontá-la hoje); este metadata só lista o que está provado.
--
-- Só preenche se estiver NULL — não sobrescreve ajuste manual. Metadata de sistema, sem dado de cliente.

UPDATE public.system_screens
SET views_consumidas = ARRAY['linhas_negocio','linhas_negocio_budget'],
    rpcs_chamadas    = ARRAY[]::text[]
WHERE rota = '/dashboard/linhas-negocio'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
