-- RD-98 p3 (origem do dado): registra as fontes de /dashboard/linhas-negocio/configurar,
-- que estava system_screens.estado_real='desconhecida' com views_consumidas/rpcs_chamadas NULOS.
-- So metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38):
--   page.tsx -> componente LinhasConfig (src/components/linhas-negocio/LinhasConfig.tsx),
--   que acessa dados pela rota REST /api/linhas-negocio (src/app/api/linhas-negocio/route.ts):
--     GET/POST/PATCH/DELETE todos sobre a tabela public.linhas_negocio
--     (DELETE = soft-delete: update ativo=false).
--   AjudaCampo (RD-95, 6 usos) -> rpcs fn_ajuda_campo_listar, fn_ajuda_campo_uso.
--   view: linhas_negocio   | rpcs: fn_ajuda_campo_listar, fn_ajuda_campo_uso
-- Todos os objetos existem (conferido em pg_class/pg_proc).
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): preenche sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao
-- altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['linhas_negocio']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/linhas-negocio/configurar'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['linhas_negocio']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/linhas-negocio/configurar'
   AND estado_real = 'desconhecida';
