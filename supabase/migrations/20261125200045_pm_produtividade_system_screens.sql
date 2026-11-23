-- RD-98 pilar 3 (origem do dado) › /dashboard/pm/produtividade ("P&M · Utilização da equipe", tela 121,
-- entregue em #5969/#5970). Tarefa do eng_chefe 23/11: a rota estava FORA de system_screens (0 linha),
-- então o aud8 não pontua a tela (nunca sela) e ela fica invisível ao pipeline de auditoria.
-- Este PR registra a rota com a origem real do dado.
--
-- Origem (lida no código + pg_get_functiondef):
--   page.tsx chama apenas supabase.rpc('fn_pm_utilizacao_heatmap') e usa <AjudaCampo> (fn_ajuda_campo_listar).
--   fn_pm_utilizacao_heatmap lê agency_timesheet, agency_jobs, agency_equipe (guarda por empresa).
-- auditada_ok = false: o selo fica a cargo do aud8 após re-scorar (não antecipamos selo).
--
-- (O bloqueador 1 — module_catalog/menu — está na PR #5971, aguardando revisor; não é duplicado aqui.)
-- Aditivo e idempotente (ON CONFLICT (rota) DO UPDATE, sem tocar auditada_ok). Não toca estrutura, RLS nem
-- dado de cliente. Prova RD-38 (BEGIN…ROLLBACK): 1 linha, rpcs={fn_pm_utilizacao_heatmap,fn_ajuda_campo_listar}.
-- RD-52: arquivo + PR, acima da main, faixa desenvolvedor_4_g (segundos :48).

INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, auditada_ok, rpcs_chamadas, views_consumidas)
VALUES (
  gen_random_uuid(),
  '/dashboard/pm/produtividade',
  'pm',
  'P&M · Utilização da equipe',
  'pronto',
  false,
  ARRAY['fn_pm_utilizacao_heatmap', 'fn_ajuda_campo_listar'],
  ARRAY['agency_timesheet', 'agency_jobs', 'agency_equipe']
)
ON CONFLICT (rota) DO UPDATE SET
  area = EXCLUDED.area,
  titulo = EXCLUDED.titulo,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  views_consumidas = EXCLUDED.views_consumidas;
