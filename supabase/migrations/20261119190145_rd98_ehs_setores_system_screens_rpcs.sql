-- RD-98 p3 · auditor /dashboard/ehs/setores (score 93):
--   rpcs_chamadas estava VAZIO (NULL) apesar de a tela ter ajuda "?" (AjudaCampo nas abas,
--   busca, novo setor e ações). views_consumidas ja estava correto ({compliance_setores}).
--
-- Fontes reais da tela (prova no codigo, RD-38):
--   LEITURA + ESCRITA: tabela compliance_setores (lista "Meus setores" + globais, criar/editar/
--     inativar) -> src/app/dashboard/ehs/setores/page.tsx:74,115,338,346 (.from('compliance_setores')).
--     Globais sao linhas is_global=true na MESMA tabela (page.tsx:79-83) — ja coberto por views_consumidas.
--   AJUDA "?" (AjudaCampo em abas, busca, novo e acoes) -> src/components/ajuda/AjudaCampo.tsx:
--     * RPC fn_ajuda_campo_listar (carrega os textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra o uso do "?")
--
-- Estado antes (producao): views_consumidas = {compliance_setores}; rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento). Prova BEGIN..ROLLBACK: 2x = mesmo resultado.

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/ehs/setores';
