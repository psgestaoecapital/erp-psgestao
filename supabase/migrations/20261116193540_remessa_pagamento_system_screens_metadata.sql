-- PDCA GE · /dashboard/financeiro/remessa-pagamento (auditor_pdca_2 14/11, RD-98 pilar 3)
-- A metadata de origem do dado desta rota estava toda NULL (views_consumidas/rpcs_chamadas/estado_real).
-- Preenche com a origem REAL provada no codigo da tela (page.tsx): tabelas lidas e RPCs chamadas.
-- Migration ADITIVA e idempotente: so atualiza metadata de uma linha ja existente de system_screens.
-- Nenhum dado de cliente e tocado; nenhuma estrutura nova. RD-38: prova no PR (antes NULL -> depois 6 views/10 rpcs).

UPDATE public.system_screens SET
  views_consumidas = ARRAY[
    'erp_banco_provider_config','erp_pagar','erp_fornecedores',
    'erp_remessa_pagamento','erp_remessa_pagamento_item','companies'
  ],
  rpcs_chamadas = ARRAY[
    'fn_remessa_proxima_numeracao','fn_remessa_datas_pagamento','fn_remessa_listar',
    'fn_remessa_retorno_conciliar_auto','fn_remessa_extrato','fn_remessa_cancelar',
    'fn_remessa_remover_item','fn_remessa_marcar_incluidos','fn_remessa_retorno_marcar',
    'fn_banco_config_salvar_agencia_dv'
  ],
  estado_real = 'pronto'
WHERE rota = '/dashboard/financeiro/remessa-pagamento';
