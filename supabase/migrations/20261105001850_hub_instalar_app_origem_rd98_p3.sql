-- PDCA Hub · /dashboard/projetos/instalar-app · RD-98 pilar 3 (origem do dado).
-- Code: desenvolvedor_4_g
--
-- A linha system_screens desta tela já existe (id hub_map_projetos_instalar_app, area='hub'),
-- com rpcs_chamadas preenchidas, mas views_consumidas estava NULL e estado_real='desconhecida'.
-- O DoD do pilar 3 exige a ORIGEM do dado preenchida.
--
-- Prova RD-38 (verificado na definição viva das funções):
--   fn_app_instalacao_registrar  -> INSERT INTO public.erp_app_instalacao (grava a instalação por empresa/usuário)
--   fn_app_instalacao_contagem   -> SELECT ... FROM public.erp_app_instalacao (lê "pessoas que já instalaram")
-- Logo a tabela de origem consumida/gravada é public.erp_app_instalacao.
--
-- Aditiva e idempotente: só completa metadados de catálogo (system_screens), nunca toca dado de cliente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_app_instalacao']::text[],
       rpcs_chamadas    = ARRAY['fn_app_instalacao_registrar','fn_app_instalacao_contagem']::text[],
       estado_real      = 'pronto',
       area             = 'hub',
       atualizado_em    = now()
 WHERE rota = '/dashboard/projetos/instalar-app';
