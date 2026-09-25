-- P&M · Auditoria do menu (25/09) — itens 5 e 4 (correções de dados, prioridade do cliente).
-- Item 5: colisão de ordem no menu. Dentro de cada subgrupo a ordem é única, MAS os subgrupos pm
--   caem todos no mesmo secao_ordem em fn_modulos_sidebar_por_area, então o menu ordena por `ordem`
--   global — e há 4 duplicatas (80: cobranca+jobs · 90: aprovacao+ia_preco · 110: apontamento+integracoes
--   · 120: bot+margem), deixando a ordem indefinida. Renumeração GLOBAL-ÚNICA mantendo a ordem pretendida:
--   comercial → produção → financeiro → inteligência → configuração.
-- Item 4: auditavel_robo continuava NULL em 10 telas REAIS (o #1795 só marcou os cascas como false).
--   Sem true, o robô do Gold ignora a tela. Marca as reais como auditáveis. (Cascas seguem false.)
-- Sem função SECURITY DEFINER — só dados.

BEGIN;

-- ── Item 5 · ordem global-única no menu pm ────────────────────────────────────
-- comercial 10–30 (já ok, reafirma) · produção 40–90 · financeiro 100–120 · inteligência 130–170 · config 200
UPDATE module_catalog SET ordem = v.ord
FROM (VALUES
  ('pm_leads',10), ('pm_agenda',15), ('pm_propostas',20), ('pm_servicos',25), ('pm_cadastro_clientes',30),
  ('pm_briefings',40), ('pm_portfolio',50), ('pm_jobs',60), ('pm_aprovacao_cliente',70), ('pm_apontamento_horas',80), ('pm_margem_job',90),
  ('pm_cobranca_etapa',100), ('pm_ia_preco_otimo',110), ('pm_eventos_producoes',120),
  ('pm_integracoes_produtividade',130), ('pm_bot_produtividade',140), ('pm_ia_preditiva',150), ('pm_benchmark_mercado',160), ('pm_health_score_cliente',170),
  ('pm_configuracoes',200)
) AS v(id, ord)
WHERE module_catalog.id = v.id AND module_catalog.grupo = 'pm';

-- ── Item 4 · telas REAIS da pm auditáveis pelo robô ───────────────────────────
-- Todas as telas pm não-casca (estado_real IN pronto/parcial) que ainda estão NULL viram true.
-- Os cascas (estado_real='placeholder') já são false (#1795) e não são tocados aqui.
UPDATE system_screens
SET auditavel_robo = true,
    auditabilidade_em = now()
WHERE area = 'pm'
  AND estado_real IN ('pronto','parcial')
  AND auditavel_robo IS DISTINCT FROM true;

COMMIT;
