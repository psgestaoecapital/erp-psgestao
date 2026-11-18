-- RD-98 p3 · registrar a ORIGEM DO DADO (system_screens.views_consumidas / rpcs_chamadas) de
-- telas EHS que ainda estavam com os campos NULOS. Lote de telas NAO-sensiveis (sem NR-36, sem
-- fiscal/financeiro de cliente, sem RLS/permissao). Metadado apenas: nao toca RLS, dado de
-- cliente, nem comportamento. Idempotente: 2x = mesmo resultado (BEGIN..ROLLBACK provado).
--
-- Fontes reais por tela (prova no codigo, RD-38 — .from()/.rpc() de cada page.tsx):
--   /dashboard/ehs/cockpit              -> v_ehs_cockpit_resumo, v_ehs_cockpit_setor
--   /dashboard/ehs/epi/fichas           -> v_epi_funcionarios_consolidado
--   /dashboard/ehs/matriz/epi-posto     -> epi_catalogo, prod_posto, prod_posto_epi, prod_posto_pessoa, prod_setor
--   /dashboard/ehs/matriz/risco-setor   -> prod_posto, prod_posto_pessoa, prod_setor, prod_setor_risco
--   /dashboard/ehs/matriz/heranca-pessoa-> v_ehs_heranca_pessoa
-- RPCs de ajuda em todas (AjudaCampo nos filtros/colunas/acoes) -> fn_ajuda_campo_listar, fn_ajuda_campo_uso.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_ehs_cockpit_resumo','v_ehs_cockpit_setor']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/cockpit';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_epi_funcionarios_consolidado']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/epi/fichas';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['epi_catalogo','prod_posto','prod_posto_epi','prod_posto_pessoa','prod_setor']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/matriz/epi-posto';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['prod_posto','prod_posto_pessoa','prod_setor','prod_setor_risco']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/matriz/risco-setor';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_ehs_heranca_pessoa']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/matriz/heranca-pessoa';
