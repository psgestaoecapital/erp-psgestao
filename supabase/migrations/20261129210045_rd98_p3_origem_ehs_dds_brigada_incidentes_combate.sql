-- RD-98 p3 (origem do dado) — 4 telas EHS autocontidas ainda `estado_real='desconhecida'` com 0 fontes.
-- Todo o acesso a dados dessas telas está no próprio page.tsx (nenhuma chama RPC de negócio);
-- as fontes abaixo foram lidas do código (RD-38) em src/app/dashboard/ehs/<rota>/page.tsx:
--   ehs/dds             -> supabase.from: ehs_dds, ehs_dds_presenca
--   ehs/brigada         -> supabase.from: ehs_brigada
--   ehs/incidentes      -> supabase.from: ehs_incidente, ehs_incidente_testemunha
--   ehs/combate-incendio-> supabase.from: ehs_combate_incendio
-- As 4 telas usam o componente padrão AjudaCampo (RD-95) -> fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--
-- Migração ADITIVA e IDEMPOTENTE de metadado (system_screens): classifica estado_real='parcial'
-- SÓ enquanto ainda 'desconhecida' e preenche views_consumidas/rpcs_chamadas SÓ quando ainda vazios.
-- Não toca RLS, dado de cliente, estrutura nem comportamento de tela.

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_dds','ehs_dds_presenca'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/dds'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_brigada'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/brigada'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_incidente','ehs_incidente_testemunha'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/incidentes'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_combate_incendio'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/combate-incendio'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);
