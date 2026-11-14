-- RD-98 p3 (origem do dado) · PDCA aud8 /dashboard/industrial/bi-planta (gap 3, desenvolvedor_4_g):
-- system_screens.views_consumidas estava NULL para a rota do BI da Planta, embora a tela consuma dado real.
-- RD-38 (prova na definicao viva das funcoes, 13/11): a tela chama so fn_bi_planta_abate, que agrega tres
-- fontes -> fn_ind_abate_animal e fn_ind_compra_gado leem `ind_atak_fato`; fn_ind_horas_setor le `ind_ponto_dia`.
-- Preenche a origem do dado (so metadado de tela). Aditivo e idempotente (so quando ainda esta NULL).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ind_atak_fato', 'ind_ponto_dia']::text[]
 WHERE rota = '/dashboard/industrial/bi-planta'
   AND views_consumidas IS NULL;
