-- PDCA P&M · /dashboard/pm/health-score · 90 → ≥95 (aud8 02/11)
-- Dois gaps concretos, ambos ADITIVOS (nenhum dado de cliente tocado):
--   1) RD-98 p3 (origem do dado): system_screens da rota estava com views_consumidas/rpcs_chamadas NULOS,
--      apesar de a tela chamar fn_agency_score_pesos_get/_salvar e fn_agency_score_calcular (3 RPCs, 0 views).
--   2) RD-95: o botão "Restaurar padrão" (seção Pesos dos componentes) não tinha "?".
-- Idempotente.

-- 1) Origem do dado (RD-98 p3) ─────────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas   = ARRAY['fn_agency_score_pesos_get','fn_agency_score_pesos_salvar','fn_agency_score_calcular']::text[],
       views_consumidas = ARRAY[]::text[]
 WHERE rota = '/dashboard/pm/health-score';

-- 2) RD-95: "?" do botão "Restaurar padrão" ────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'pm.health_score.restaurar_padrao', 'Health Score · Pesos', 'Restaurar padrão',
  'Ação (não é campo): devolve os pesos dos quatro componentes ao padrão de fábrica (Prazo 30% · Margem 30% · Pagamento 20% · Atividade 20%).',
  'Desfaz ajustes de peso e volta à distribuição recomendada quando a soma ficou desequilibrada ou você quer recomeçar.',
  'Clicar em "Restaurar padrão" depois de testar pesos e querer voltar ao 30/30/20/20.',
  'Achar que já salva: restaurar só repõe os valores na tela — ainda é preciso clicar em "Salvar pesos" para valer.',
  41, '/dashboard/pm/health-score', 'pm', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
