-- PDCA P&M · /dashboard/pm/health-score · 90 → ≥95 (aud8 02/11)
-- RD-98 p3 (origem do dado): system_screens da rota tinha views_consumidas/rpcs_chamadas NULOS.
-- rpcs_chamadas já foi populado na main; falta declarar explicitamente que a tela NÃO consome view
-- (views_consumidas = {} em vez de NULL). A tela chama 3 RPCs e 0 views (0 `.from(` no código).
-- Idempotente e aditivo (só metadados da rota em system_screens; nenhum dado de cliente tocado).
-- Obs.: o "?" do botão "Restaurar padrão" já foi entregue na main (chave pm.health_score.restaurar),
-- portanto este PR não reinsere ajuda — apenas completa a origem do dado.

UPDATE public.system_screens
   SET rpcs_chamadas    = ARRAY['fn_agency_score_pesos_get','fn_agency_score_pesos_salvar','fn_agency_score_calcular']::text[],
       views_consumidas = ARRAY[]::text[]
 WHERE rota = '/dashboard/pm/health-score'
   AND views_consumidas IS NULL;
