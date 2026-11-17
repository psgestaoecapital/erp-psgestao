-- RD-98 p3 · registrar a ORIGEM DO DADO (system_screens.views_consumidas / rpcs_chamadas) das
-- telas EHS restantes NAO-sensiveis cujo origem estava NULO (auditor). Complementa os lotes
-- #5375/#5378/#5379/#5380. NR-36 (pausas-tecnicas, treinamento-posto) ficam SOLO/sensivel.
--
-- Fontes reais provadas no codigo (RD-38):
--   /dashboard/ehs/funcionarios/[id]      (page -> /api/compliance/funcionarios/[id])
--       -> compliance_funcionarios, v_compliance_matriz_funcionarios, compliance_documentos
--          AJUDA "?" (AjudaCampo) -> fn_ajuda_campo_listar / fn_ajuda_campo_uso
--   /dashboard/ehs/matriz                 (page -> /api/compliance/matriz + /api/compliance/dispensas)
--       -> compliance_tipos_documento, v_compliance_matriz_funcionarios, compliance_dispensas
--          (sem RPC consumida)
--   /dashboard/ehs/epi/ficha/[funcionario_id]  (page -> Supabase direto)
--       -> compliance_funcionarios, compliance_prestadores, epi_ficha, epi_movimentacao
--          (sem RPC consumida)
--   /dashboard/ehs/whatsapp-epi           (page -> Supabase direto)  [so faltava views_consumidas]
--       -> compliance_funcionarios, epi_catalogo, compliance_epi_assinatura_tokens
--          rpcs_chamadas ja preenchida (fn_compliance_epi_gerar_link_whatsapp) -> NAO sobrescreve.
--
-- Estado antes (producao): as 4 rotas com views_consumidas = NULL
--   (whatsapp-epi ja com rpcs_chamadas = {fn_compliance_epi_gerar_link_whatsapp}).
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento). Re-rodar 2x = mesmo resultado. Todos os objetos conferidos no banco.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'compliance_funcionarios','v_compliance_matriz_funcionarios','compliance_documentos'
       ]::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/funcionarios/[id]';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'compliance_tipos_documento','v_compliance_matriz_funcionarios','compliance_dispensas'
       ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/matriz';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'compliance_funcionarios','compliance_prestadores','epi_ficha','epi_movimentacao'
       ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/epi/ficha/[funcionario_id]';

-- whatsapp-epi: so a origem de views estava NULA; preserva rpcs_chamadas existente.
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'compliance_funcionarios','epi_catalogo','compliance_epi_assinatura_tokens'
       ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/whatsapp-epi';
