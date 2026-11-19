-- RD-98 p3 (origem do dado): completa /dashboard/compras/documentos-recebidos.
-- A tela ja tinha quase todas as fontes registradas (9 views + 30 rpcs), mas seguia
-- estado_real='desconhecida' e faltavam 2 rpcs realmente chamados no codigo. So metadado de
-- registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes conferidas no codigo (RD-38), src/app/dashboard/compras/documentos-recebidos/page.tsx:
--   todas as 9 views ja presentes; 22 rpcs no codigo, dos quais FALTAVAM no registro:
--     fn_nfe_item_adicionar_peca_os, fn_nfe_recebida_estornar_entrada.
-- Objetos de rpc conferidos em pg_proc.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada;
-- classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_nfe_item_adicionar_peca_os','fn_nfe_recebida_estornar_entrada']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/compras/documentos-recebidos'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_nfe_item_adicionar_peca_os','fn_nfe_recebida_estornar_entrada']);

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/compras/documentos-recebidos'
   AND estado_real = 'desconhecida';
