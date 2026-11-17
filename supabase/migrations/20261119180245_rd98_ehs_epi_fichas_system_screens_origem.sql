-- RD-98 p3 · /dashboard/ehs/epi/fichas: rpcs_chamadas vazio apesar do ajuda "?".
--
-- Fontes reais da tela (prova no codigo, RD-38):
--   LEITURA: view v_epi_funcionarios_consolidado -> src/app/dashboard/ehs/epi/fichas/page.tsx:78
--            (ja consta em views_consumidas).
--   AJUDA "?" (AjudaCampo em busca/filtros) -> src/components/ajuda/AjudaCampo.tsx:23,46:
--     * RPC fn_ajuda_campo_listar (textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra uso do "?")
--
-- Estado antes (producao): views_consumidas = {v_epi_funcionarios_consolidado}; rpcs_chamadas = {}.
--
-- Correcao corretiva e idempotente (so metadado de registro; nao toca RLS, dado de cliente nem
-- comportamento): registra as RPCs de ajuda realmente chamadas pela tela.

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/ehs/epi/fichas';
