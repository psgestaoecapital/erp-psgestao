-- BPO · Painel Multi-Cliente / Supervisor (/dashboard/bpo/supervisor; menu /supervisao redireciona 307→/supervisor)
-- aud8 45/95 (tarefa e8ff6232). Gaps de código fechados no mesmo PR (front):
--   item 1 — estado vazio com orientação + CTA (não mais "Carregando…" preso / 6 KPIs a zero sem rumo);
--   item 2 — RD-95 "?" em cada KPI e nos títulos das seções;
--   item 3 (ESTA migration) — RD-98 p3: origem do dado em system_screens.
--   item 4 — a duplicidade /supervisao × /supervisor JÁ está resolvida por redirect (307); nada a fazer.
-- ADITIVA/idempotente, NÃO altera dado de cliente. Faixa code-desenvolvedor-3 (segundos :37), acima da main.

-- ── (1) RD-95: chaves de ajuda dos indicadores/seções ───────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('bpo.supervisor.kpi.pendentes','Indicadores','Pendentes Total','Soma das tarefas pendentes de todas as empresas sob supervisão.','Dá a carga total da operação num número só.','"128" = 128 tarefas aguardando.','—',1),
 ('bpo.supervisor.kpi.atrasados','Indicadores','Atrasados','Tarefas cujo prazo já passou.','Mostra o que precisa de ação imediata.','"3" = 3 tarefas vencidas.','Atrasado conta pelo prazo da tarefa, não pela data de entrada.',2),
 ('bpo.supervisor.kpi.urgentes','Indicadores','Urgentes','Tarefas marcadas como urgentes (alta prioridade).','Separa o que fura a fila.','"2" = 2 urgências abertas.','—',3),
 ('bpo.supervisor.kpi.hoje','Indicadores','Hoje','Tarefas com prazo para hoje.','Ajuda a planejar o dia da equipe.','"7" = 7 vencem hoje.','—',4),
 ('bpo.supervisor.kpi.sem_operador','Indicadores','Sem Operador','Tarefas de empresas sem operador atribuído.','Aponta onde falta distribuir trabalho — ninguém está cuidando.','"5" = 5 sem responsável.','Resolva atribuindo um operador na tela de Atribuição.',5),
 ('bpo.supervisor.kpi.concluidos','Indicadores','Concluídos Hoje','Tarefas finalizadas hoje por toda a operação.','Mede a vazão do dia.','"40" = 40 concluídas hoje.','—',6),
 ('bpo.supervisor.tabela','Seções','Visão por Empresa','Carga de trabalho detalhada por empresa.','Mostra, empresa a empresa, o que está pendente, atrasado, urgente e concluído.','Linha "Empresa X: 12 total, 2 atraso".','Lista só as empresas ativas da carteira BPO.',7),
 ('bpo.supervisor.operadores','Seções','Carga por Operador','Distribuição do trabalho por operador.','Vê quem está sobrecarregado e quem tem folga para reequilibrar.','Cartão "Fulano: 8 pendentes, 1 atrasado".','—',8)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── (2) RD-98 p3: origem do dado (as duas rotas do módulo; /supervisao redireciona p/ /supervisor) ────────────────
UPDATE public.system_screens
SET views_consumidas = ARRAY['v_bpo_clientes_ativos']::text[],
    rpcs_chamadas = ARRAY['fn_supervisor_dashboard','fn_operadores_stats','fn_ajuda_campo_listar']::text[]
WHERE rota IN ('/dashboard/bpo/supervisor','/dashboard/bpo/supervisao')
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
