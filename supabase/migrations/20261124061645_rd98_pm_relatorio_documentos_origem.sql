-- RD-98 p3 (origem do dado): completa as fontes de /dashboard/pm/relatorio-documentos.
-- A tela ja tinha views_consumidas (agency_contratos, agency_propostas, agency_clientes,
-- agency_equipe) mas seguia estado_real='desconhecida' com rpcs_chamadas vazio.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38), src/app/dashboard/pm/relatorio-documentos/page.tsx:
--   views: agency_contratos, agency_propostas, agency_clientes, agency_equipe (supabase.from, L46-49)
--   rpcs : fn_ajuda_campo_listar, fn_ajuda_campo_uso (componente AjudaCampo, RD-95, varios usos)
-- Objetos de rpc conferidos em pg_proc.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['agency_contratos','agency_propostas','agency_clientes','agency_equipe']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/pm/relatorio-documentos'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['agency_contratos','agency_propostas','agency_clientes','agency_equipe']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/relatorio-documentos'
   AND estado_real = 'desconhecida';
