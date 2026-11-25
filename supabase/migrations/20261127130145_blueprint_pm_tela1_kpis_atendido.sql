-- Reconciliação de baseline (RD-38: PROMETIDO vs REAL) — P&M tela 1 "Hub P&M (BI)".
-- Requisito ESSENCIAL "KPIs: MRR, clientes, jobs, horas, comissão, a receber" estava 'parcial',
-- mas os 6 KPIs JÁ estão entregues na main em src/app/dashboard/pm/page.tsx (Faixa 1 — KPIs
-- operacionais, dados de fn_pm_bi_kpis), cada um com "?" (RD-95):
--   • MRR (receita recorrente)            → kpis.mrr            · ajuda pm.painel.kpi_mrr
--   • Clientes ativos                     → kpis.clientes_ativos · ajuda pm.painel.kpi_clientes_ativos
--   • Jobs em andamento                   → kpis.jobs_andamento  · ajuda pm.painel.kpi_jobs_andamento
--   • Horas no mês                        → kpis.horas_mes       · ajuda pm.painel.kpi_horas_mes
--   • Comissão a pagar                    → kpis.comissao_pagar  · ajuda pm.painel.kpi_comissao_pagar
--   • A receber vencido                   → kpis.receber_vencido · ajuda pm.painel.kpi_receber_vencido
-- Os 6 cobrem exatamente o requisito; portanto está ATENDIDO. Esta migration só corrige o registro
-- de verdade do blueprint — NÃO toca código, dado de cliente, RLS, grants nem funções. Aditiva e
-- idempotente (guarda WHERE status_baseline='parcial' + id fixo).
-- (O requisito "Indicadores de moat (MRA, OTDR, RHT, HSC)" segue 'ausente': os 4 não estão no
--  catálogo area_indicadores_mestres — não reconciliado aqui, RD-38.)

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'main · /dashboard/pm · Faixa 1 KPIs (fn_pm_bi_kpis): MRR, clientes ativos, jobs em andamento, horas no mês, comissão a pagar, a receber vencido — todos com "?" RD-95. Reconciliação RD-38.'
 WHERE id = '62a5bdc7-46b9-4104-b396-564114a5cb28'
   AND status_baseline = 'parcial';
