-- RD-98 p3 · auditor /dashboard/ehs/prestadores:
--   views_consumidas e rpcs_chamadas estavam NULOS (origem do dado nao documentada),
--   enquanto as telas irmas da EHS ja tem o registro preenchido.
--
-- Fontes reais da tela (prova no codigo, RD-38):
--   LEITURA (lista + resumo de compliance) via /api/compliance/prestadores:
--     * tabela compliance_prestadores        -> src/app/api/compliance/prestadores/route.ts:39
--       (.from('compliance_prestadores')) — lista e, no [id], leitura/edicao/inativacao do cadastro.
--     * view  v_compliance_matriz_prestadores -> src/app/api/compliance/prestadores/route.ts:57
--       (.from('v_compliance_matriz_prestadores')) — matriz de documentos/compliance por prestador.
--   AJUDA "?" (AjudaCampo em filtros, colunas e acoes) -> src/components/ajuda/AjudaCampo.tsx:
--     * RPC fn_ajuda_campo_listar (carrega os textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra o uso do "?")
--
-- Estado antes (producao): views_consumidas = NULL; rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento): registra as fontes reais. Prova BEGIN..ROLLBACK: 2x = mesmo resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['compliance_prestadores','v_compliance_matriz_prestadores']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/prestadores';
