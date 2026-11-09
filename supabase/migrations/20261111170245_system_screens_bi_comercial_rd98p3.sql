-- RD-98 p3 — registro correto das telas do BI Comercial (Meu painel de vendas + Vendedores)
-- Finalização da entrega do Painel da Franciele (CEO 09/11): as duas telas já estão construídas,
-- consomem as RPCs prontas e provam os números reais (Frioeste: 30,64/kg ≈ aceite 30,61/kg).
-- Faltava só a METADATA de auditabilidade (views_consumidas erradas/vazias) que o auditor cobra no RD-98 p3.
--
-- Correções:
--  • /dashboard/comercial/meu-painel: views_consumidas = ['erp_lancamentos'] (ERRADO) -> fonte real
--    é a MV bi_comercial_venda_item_mv (lida por fn_com_venda_item dentro de fn_bi_comercial_painel).
--  • /dashboard/admin/vendedores: views_consumidas = NULL -> com_vendedor_acesso + user_companies
--    (lidas por fn_com_vendedor_acesso_listar/salvar).
--
-- Aditiva/idempotente: apenas UPDATE de metadata de registro (nenhum dado de cliente, RLS ou cálculo).
-- Rodar 2x não muda o resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['bi_comercial_venda_item_mv'],
       atualizado_em    = now()
 WHERE rota = '/dashboard/comercial/meu-painel'
   AND views_consumidas IS DISTINCT FROM ARRAY['bi_comercial_venda_item_mv'];

UPDATE public.system_screens
   SET views_consumidas = ARRAY['com_vendedor_acesso','user_companies'],
       componentes_principais = ARRAY['VendedoresAcesso'],
       atualizado_em    = now()
 WHERE rota = '/dashboard/admin/vendedores'
   AND (views_consumidas IS DISTINCT FROM ARRAY['com_vendedor_acesso','user_companies']
        OR componentes_principais IS DISTINCT FROM ARRAY['VendedoresAcesso']);
