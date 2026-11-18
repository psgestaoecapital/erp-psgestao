-- RD-98 p3 · auditor /dashboard/ehs/epi/alertas (score 90, 17/11):
--   rpcs_chamadas estava VAZIO apesar de a tela ter ajuda "?" e acoes Resolver/Ignorar.
--
-- Fontes reais da tela (prova no codigo, RD-38):
--   LEITURA + ESCRITA: tabela epi_alerta
--     * leitura dos alertas            -> src/app/dashboard/ehs/epi/alertas/page.tsx:86 (.from('epi_alerta'))
--     * acoes Resolver / Ignorar       -> page.tsx:114 (.from('epi_alerta').update(patch)) — grava no
--       proprio registro do alerta; sem RPC de banco (ja coberto por views_consumidas = {epi_alerta}).
--   AJUDA "?" (AjudaCampo em filtros, cards e acoes) -> src/components/ajuda/AjudaCampo.tsx:23,46:
--     * RPC fn_ajuda_campo_listar (carrega textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra o uso do "?")
--
-- Estado antes (producao): views_consumidas = {epi_alerta}; rpcs_chamadas = {} (vazio).
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento): registra as RPCs de ajuda realmente chamadas pela tela.

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/ehs/epi/alertas';
