-- RD-98 p3 (origem do dado): completa /dashboard/compras/margem-negativa.
-- A tela usa o componente AjudaCampo (RD-95, 7 usos) mas os rpcs de ajuda nao estavam
-- registrados; seguia estado_real='desconhecida'. So metadado de registro da tela — NAO
-- altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38), src/app/dashboard/compras/margem-negativa/page.tsx:
--   rpcs: fn_nfe_produtos_margem_negativa (ja presente)
--   componente AjudaCampo: fn_ajuda_campo_listar, fn_ajuda_campo_uso (FALTAVAM)
--   (view erp_lancamentos ja presente no registro)
-- Objetos de rpc conferidos em pg_proc.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada;
-- classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/compras/margem-negativa'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']);

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/compras/margem-negativa'
   AND estado_real = 'desconhecida';
