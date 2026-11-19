-- RD-98 p3 (origem do dado): classifica /dashboard/os ("Ordens de serviço"),
-- que estava em system_screens com estado_real='desconhecida' e só registro
-- parcial de fontes (1 view / 10 rpcs). Registra o conjunto REAL de fontes
-- (página + componente OrdemServicoCard) e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente,
-- RLS, grants, segredo/vault nem cálculo. As RPCs/tabelas são apenas
-- REFERENCIADAS pelo nome. Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/os/page.tsx: rpc fn_oficina_os_listar, fn_os_nf_situacao,
--     fn_os_nf_corte_definir, fn_os_restaurar, fn_os_excluir, fn_cliente_criar_inline,
--     fn_os_placa_aberta, fn_os_criar ; from('erp_clientes') ; componente AjudaCampo.
--   src/components/comum/OrdemServicoCard.tsx: rpc fn_oficina_diagnostico_obter,
--     fn_oficina_diagnostico_salvar, fn_oficina_orcamento_registrar, fn_oficina_os_set_placa,
--     fn_oficina_papel, fn_oficina_pecas_buscar, fn_os_aplicar_desconto, fn_os_criar_de_pedido,
--     fn_os_diag_item_substituir, fn_os_editado_pos_entrega, fn_os_faturar, fn_os_reabrir,
--     fn_os_salvar, fn_os_vincular_financeiro ; from('erp_os'), from('erp_os_diagnostico_item'),
--     from('bpo_companies_assignment'), from('erp_clientes').
-- As 22 RPCs e as 4 relações existem em public (conferido em pg_proc/pg_class).
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'erp_clientes','erp_os','erp_os_diagnostico_item','bpo_companies_assignment'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_oficina_os_listar','fn_os_nf_situacao','fn_os_nf_corte_definir','fn_os_restaurar',
      'fn_os_excluir','fn_cliente_criar_inline','fn_os_placa_aberta','fn_os_criar',
      'fn_oficina_diagnostico_obter','fn_oficina_diagnostico_salvar','fn_oficina_orcamento_registrar',
      'fn_oficina_os_set_placa','fn_oficina_papel','fn_oficina_pecas_buscar','fn_os_aplicar_desconto',
      'fn_os_criar_de_pedido','fn_os_diag_item_substituir','fn_os_editado_pos_entrega','fn_os_faturar',
      'fn_os_reabrir','fn_os_salvar','fn_os_vincular_financeiro'
    ]::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/os'
  AND estado_real = 'desconhecida';
