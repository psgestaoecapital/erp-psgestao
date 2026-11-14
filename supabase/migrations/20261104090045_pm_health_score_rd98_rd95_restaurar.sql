-- PDCA P&M /dashboard/pm/health-score (aud8 90/95) — 2 gaps concretos.

-- GAP1 · RD-98 p3 (origem do dado): a rota estava com rpcs_chamadas NULL.
-- Registra as 3 RPCs que a tela chama (page.tsx L47 pesos_get, L65 pesos_salvar, L84 calcular).
-- views_consumidas fica NULL de propósito: a tela não lê view direta, só RPC (RD-38).
-- Aditiva e idempotente (só preenche quando NULL).
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_agency_score_pesos_get','fn_agency_score_pesos_salvar','fn_agency_score_calcular']
 WHERE rota = '/dashboard/pm/health-score'
   AND rpcs_chamadas IS NULL;

-- GAP2 · RD-95: "?" do botão "Restaurar padrão" (seção "Pesos dos componentes").
-- Chave nova; idempotente via ON CONFLICT (erp_ajuda_campo.chave é UNIQUE).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.health_score.restaurar', '/dashboard/pm/health-score', 'Health Score · Pesos', 'Restaurar padrão',
   'Ação que devolve os quatro pesos aos valores de fábrica (Prazo 30, Margem 30, Pagamento 20, Atividade 20).',
   'Desfaz ajustes nos pesos e volta à régua recomendada, que já soma 100%, sem precisar digitar valor por valor.',
   'Depois de testar pesos que não fecharam 100%, clicar em Restaurar padrão devolve 30/30/20/20 e habilita o Salvar.',
   'Restaurar padrão só muda os campos na tela; a mudança só passa a valer depois de clicar em Salvar pesos.',
   'pm', 8, 'publicado')
ON CONFLICT (chave) DO NOTHING;
