-- PDCA auditor_pdca_1 26/11 (tela "Simulador FAP/RAT", rota /dashboard/ehs/sst/fap-rat) · Code: code-desenvolvedor-3
-- GAP 2 (RD-98 pilar 3 — origem do dado): system_screens.rpcs_chamadas da rota estava NULL. A tela é uma
-- calculadora pura (standalone) que chama só fn_ehs_fap_rat_simular e NÃO lê tabela — por isso views_consumidas
-- fica vazio. Registra a origem do dado e marca estado_real='pronto' (cálculo já provado no dado pelo auditor +
-- descoberta agora resolvida pelo card no SST, GAP 1 no mesmo PR). Aditivo, 1 linha, só metadata de tela:
-- NÃO toca dado de cliente. Idempotente (reaplicar grava o mesmo valor).
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ehs_fap_rat_simular']::text[],
       estado_real   = 'pronto',
       atualizado_em = now()
 WHERE rota = '/dashboard/ehs/sst/fap-rat';
