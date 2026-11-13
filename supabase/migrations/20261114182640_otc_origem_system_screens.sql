-- Origem do dado (RD-98 p3) da tela /dashboard/commerce/otc "OTC — Order-to-Cash".
-- system_screens.views_consumidas e rpcs_chamadas estavam VAZIOS (0/0) apesar de a
-- tela consumir orçamentos/pedidos e várias RPCs. Preenche a origem (metadata).
--
-- Aditivo/idempotente: só SETA os arrays da rota (metadata global de tela), sem
-- tocar RLS nem dado de cliente.
-- Code: code-desenvolvedor-3

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_orcamentos','erp_orcamentos_itens','erp_orcamento_historico',
         'erp_pedidos','erp_pedidos_itens','erp_pedidos_parcelas',
         'erp_clientes','erp_motivo_perda','erp_nfse_emitidas','erp_receber','projetos_obras'
       ],
       rpcs_chamadas = ARRAY[
         'fn_converter_orcamento_em_pedido','fn_faturar','fn_pedido_reverter_para_orcamento',
         'fn_orcamento_cancelar','fn_orcamento_exige_obra','fn_servicos_exigem_obra',
         'fn_pedido_nfse_dados','fn_pedido_nfse_marcar_emitida','fn_cliente_criar_inline',
         'next_orcamento_numero'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/commerce/otc';
