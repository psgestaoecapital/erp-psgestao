-- RD-98 p3 · documentar a ORIGEM DO DADO da tela Ordens de Serviço (/dashboard/os).
-- system_screens.views_consumidas / rpcs_chamadas estavam NULL nesta rota; o auditor segura o selo
-- enquanto a origem do dado não está no catálogo (a tela tem "?" RD-95 e CRUD completo).
--
-- Aditiva e idempotente: só preenche METADADO de catálogo (system_screens). Nenhum dado de cliente,
-- nenhuma mudança de schema, nenhuma RLS/permissão. Re-rodar resulta no mesmo estado.
-- Valores extraídos do código VIVO de src/app/dashboard/os/page.tsx (RD-38): `.rpc('fn_...')` e
-- `.from('tabela')`. AjudaCampo ("?") chama fn_ajuda_campo_listar/fn_ajuda_campo_uso.
-- Objetos conferidos no banco (existem): erp_clientes, fn_cliente_criar_inline, fn_oficina_os_listar,
-- fn_os_criar, fn_os_excluir, fn_os_nf_corte_definir, fn_os_nf_situacao, fn_os_placa_aberta,
-- fn_os_restaurar, fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Code: desenvolvedor_4_g

-- /dashboard/os
UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_clientes']::text[],
  rpcs_chamadas = ARRAY[
    'fn_oficina_os_listar','fn_os_criar','fn_os_excluir','fn_os_restaurar',
    'fn_os_placa_aberta','fn_os_nf_situacao','fn_os_nf_corte_definir',
    'fn_cliente_criar_inline','fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/os';
