-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/commerce/compras (Compras / Cotações). Antes: ambos NULL (origem não rastreável, gap do auditor).
-- Listas tiradas do grep .from()/.rpc() de page.tsx + componentes consumidos
-- (compras/OrdemFornecimento, comum/CotacaoWhatsAppModal, comum/ProdutoAutocomplete).
-- Aditivo, idempotente, SÓ metadado. Não cria/altera tabela, RLS, grant, RPC nem dado de cliente.
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'erp_cotacoes','erp_compras','erp_cotacoes_itens','erp_cotacoes_fornecedores',
      'erp_compras_itens','erp_cotacoes_propostas','erp_fornecedores','erp_produtos'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_aprovar_proposta_cotacao','fn_compra_receber','fn_compra_gerar_titulos',
      'fn_resumo_cotacao','fn_cotacao_proposta_salvar','fn_cotacao_whatsapp_links'
    ]::text[]
WHERE rota = '/dashboard/commerce/compras';
