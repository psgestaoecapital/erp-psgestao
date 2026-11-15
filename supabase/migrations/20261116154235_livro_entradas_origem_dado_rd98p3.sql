-- RD-98 p3 · documentar a ORIGEM DO DADO da tela do Livro de Entradas (núcleo fiscal).
-- system_screens.views_consumidas / rpcs_chamadas estavam NULL para /dashboard/commerce/livro-entradas.
-- O auditor (aud8) segura o selo (>=95) enquanto a origem do dado não é documentada no catálogo.
--
-- Aditiva e idempotente: só preenche METADADO de catálogo (system_screens). Nenhum dado de cliente,
-- nenhuma mudança de schema, nenhuma RLS/permissão. Re-rodar resulta no mesmo estado.
-- Valores extraídos do código VIVO do page.tsx (RD-38): `.rpc('fn_...')` e da definição da RPC
-- fn_fiscal_livro_entradas (tabelas lidas). Objetos conferidos no banco (existem):
--   erp_nfe_recebidas, erp_nfe_recebidas_itens, erp_nfe_recebidas_itens_tributo,
--   fn_fiscal_livro_entradas, fn_fiscal_exportacao_registrar, fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Code: code-desenvolvedor-3

-- /dashboard/commerce/livro-entradas
--   page.tsx: .rpc('fn_fiscal_livro_entradas') (dados) + .rpc('fn_fiscal_exportacao_registrar') (export);
--             AjudaCampo (fn_ajuda_campo_listar/uso).
--   fn_fiscal_livro_entradas lê: erp_nfe_recebidas, erp_nfe_recebidas_itens, erp_nfe_recebidas_itens_tributo.
UPDATE public.system_screens SET
  views_consumidas = ARRAY[
    'erp_nfe_recebidas','erp_nfe_recebidas_itens','erp_nfe_recebidas_itens_tributo'
  ]::text[],
  rpcs_chamadas = ARRAY[
    'fn_fiscal_livro_entradas','fn_fiscal_exportacao_registrar',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/commerce/livro-entradas';
