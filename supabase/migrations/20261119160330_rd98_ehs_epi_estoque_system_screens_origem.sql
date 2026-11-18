-- RD-98 p3 · auditor /dashboard/ehs/epi/estoque: system_screens.rpcs_chamadas estava vazio
-- (origem do dado nao registrada) apesar de a tela gravar entrada e entrega de EPI, e
-- views_consumidas listava apenas 2 fontes.
--
-- Fontes reais da tela (prova no codigo):
--   * RPC fn_epi_registrar_entrega  -> src/app/dashboard/ehs/epi/_components/ModalEntregarEPI.tsx:157
--       (entrega ao funcionario com baixa no estoque, #3865)
--   * view v_epi_funcionarios_consolidado -> src/app/dashboard/ehs/epi/estoque/page.tsx:141
--       (lista de funcionarios para a entrega)
--   * tabelas epi_estoque e epi_catalogo (ja registradas em views_consumidas)
--
-- Estado antes (producao): rpcs_chamadas = {}; views_consumidas = {epi_estoque, epi_catalogo}.
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento): registra a RPC de origem e acrescenta a view de funcionarios.

UPDATE public.system_screens
   SET rpcs_chamadas   = ARRAY['fn_epi_registrar_entrega']::text[],
       views_consumidas = ARRAY['epi_estoque','epi_catalogo','v_epi_funcionarios_consolidado']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/epi/estoque';
