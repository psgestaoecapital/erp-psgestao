-- RD-98 p3 (origem do dado): registra as fontes de /dashboard/commerce/estoque/importar,
-- que estava system_screens.estado_real='desconhecida' com views_consumidas/rpcs_chamadas NULOS.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38):
--   A rota reexporta o MESMO componente de /dashboard/cadastros/produtos/importar
--   (RD-26, nao duplica): src/app/dashboard/commerce/estoque/importar/page.tsx ->
--   src/app/dashboard/cadastros/produtos/importar/page.tsx, que:
--     supabase.from('erp_importacoes')           (historico/lista de importacoes, L108)
--     supabase.rpc('fn_estoque_importar_lote')   (simular/importar o lote, L219)
--     POST /api/estoque/importar                 (route.ts: mesma tabela erp_importacoes +
--                                                 rpc fn_estoque_importar_lote)
--   AjudaCampo (RD-95) -> rpcs fn_ajuda_campo_listar, fn_ajuda_campo_uso.
--   view: erp_importacoes | rpcs: fn_estoque_importar_lote, fn_ajuda_campo_listar, fn_ajuda_campo_uso
-- Todos os objetos existem (conferido em pg_class/pg_proc).
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): preenche sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['erp_importacoes']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_estoque_importar_lote','fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/commerce/estoque/importar'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['erp_importacoes']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_estoque_importar_lote','fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/commerce/estoque/importar'
   AND estado_real = 'desconhecida';
