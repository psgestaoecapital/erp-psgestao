-- RD-98 p3 (origem do dado): completa /dashboard/cadastros/produtos/importar.
-- A tela seguia estado_real='desconhecida' e faltava 1 rpc realmente chamado no codigo.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38), src/app/dashboard/cadastros/produtos/importar/page.tsx:
--   from erp_importacoes (ja presente) ; rpc fn_estoque_importar_lote (FALTAVA) ;
--   AjudaCampo (RD-95, 12 usos): fn_ajuda_campo_listar, fn_ajuda_campo_uso (ja presentes).
-- Objeto de rpc conferido em pg_proc.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada;
-- classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_estoque_importar_lote']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/cadastros/produtos/importar'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_estoque_importar_lote']);

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/cadastros/produtos/importar'
   AND estado_real = 'desconhecida';
