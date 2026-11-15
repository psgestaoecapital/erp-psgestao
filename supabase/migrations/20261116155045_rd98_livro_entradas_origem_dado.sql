-- RD-98 p3 — rastrear a origem do dado da tela /dashboard/commerce/livro-entradas
-- Preenche system_screens.views_consumidas e rpcs_chamadas (hoje vazios).
-- A tela consome exclusivamente as RPCs fn_fiscal_livro_entradas (dados) e
-- fn_fiscal_exportacao_registrar (exportação). fn_fiscal_livro_entradas lê as
-- tabelas de NF-e recebidas (erp_nfe_recebidas / _itens / _itens_tributo).
-- Aditiva e idempotente: só grava quando os campos estão vazios (não sobrescreve
-- rastreamento já existente). Não toca dado de cliente.

UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'erp_nfe_recebidas',
      'erp_nfe_recebidas_itens',
      'erp_nfe_recebidas_itens_tributo'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_fiscal_livro_entradas',
      'fn_fiscal_exportacao_registrar'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/commerce/livro-entradas'
  AND (
    coalesce(array_length(views_consumidas, 1), 0) = 0
    OR coalesce(array_length(rpcs_chamadas, 1), 0) = 0
  );
