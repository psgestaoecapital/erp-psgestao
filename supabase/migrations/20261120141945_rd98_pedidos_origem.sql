-- RD-98 p3 (origem do dado): registra as fontes de /dashboard/pedidos, que estava
-- system_screens.estado_real='desconhecida' com views_consumidas/rpcs_chamadas NULOS.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Tela AUTOCONTIDA (todo acesso a dados no proprio page.tsx, via supabaseBrowser; sem fetch a
-- /api e sem hooks de dados) — provado no codigo (RD-38):
--   views: erp_pedidos, erp_pedidos_itens, erp_orcamentos (origem do pedido),
--          erp_lancamentos (gera lancamento ao faturar — insert L214)
--   rpcs : converter_orcamento_pedido, fn_pedido_editar_itens,
--          fn_ajuda_campo_listar, fn_ajuda_campo_uso (componente AjudaCampo, 16 usos)
-- Todos os objetos existem (conferido em pg_class/pg_proc).
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): preenche sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao
-- altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['erp_pedidos','erp_pedidos_itens','erp_orcamentos','erp_lancamentos']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['converter_orcamento_pedido','fn_pedido_editar_itens','fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/pedidos'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['erp_pedidos','erp_pedidos_itens','erp_orcamentos','erp_lancamentos']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['converter_orcamento_pedido','fn_pedido_editar_itens','fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/pedidos'
   AND estado_real = 'desconhecida';
