-- desenvolvedor_4_g · PDCA aud8 (Indústria › BI da Planta, /dashboard/industrial/bi-planta), gap 3 (RD-98 p3).
-- Origem do dado não documentada: system_screens.views_consumidas = NULL para a rota (rpcs_chamadas já tinha
-- fn_bi_planta_abate). RD-38: a tela lê só fn_bi_planta_abate, que traduz as fontes brutas ind_atak_fato
-- (domínios miudos_5quarto e compra_gado, via fn_ind_abate_animal/fn_ind_compra_gado) e ind_ponto_dia
-- (via fn_ind_horas_setor). Documenta essas fontes no catálogo. Aditivo e idempotente; não toca a tela.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ind_atak_fato', 'ind_ponto_dia'],
       atualizado_em = now()
 WHERE id = 'industrial_bi_planta';
