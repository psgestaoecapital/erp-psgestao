-- RD-98 p3 · /dashboard/ehs/matriz/treinamento-posto ("Treinamentos por Posto", menu ativo):
--   views_consumidas e rpcs_chamadas estavam NULOS, enquanto as telas irmas da EHS ja tem o registro.
--
-- Fontes reais da tela (prova no codigo, RD-38) -> src/app/dashboard/ehs/matriz/treinamento-posto/page.tsx:
--   LEITURA/ESCRITA direta nas tabelas:
--     * prod_posto               (.from, L70) — postos de trabalho.
--     * prod_setor               (.from, L71) — setores (para filtro/heranca).
--     * nr_treinamento_tipo      (.from, L72) — catalogo de treinamentos NR.
--     * prod_posto_treinamento   (.from select/delete/insert, L73/L114/L262) — vinculo treino<->posto.
--     * prod_posto_pessoa        (.from, L74) — pessoas por posto (cobertura).
--   AJUDA "?" (AjudaCampo nos campos/filtros da tela) -> src/components/ajuda/AjudaCampo.tsx:
--     * RPC fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--
-- Estado antes (producao): views_consumidas = NULL; rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente: so metadado de registro da tela; NAO toca RLS, grants, dado de
-- cliente, nem comportamento. Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE deterministico).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['prod_posto','prod_setor','nr_treinamento_tipo','prod_posto_treinamento','prod_posto_pessoa']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/matriz/treinamento-posto';
