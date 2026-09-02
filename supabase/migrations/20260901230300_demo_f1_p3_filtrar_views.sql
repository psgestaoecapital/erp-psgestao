-- DEMO-F1 parte 3 · §3.1/§3 FILTRAR (defesa, RD-57) — só as views com contaminação REAL medida.
--
-- Medição RD-38 da presença da demo em cada view listada (não recriar view p/ filtrar dado ausente):
--   COM demo hoje  → v_dre_receita_3_fontes (3 linhas) · v_tenant_subscriptions_summary (1) → FILTRAR aqui.
--   SEM demo hoje (já retornam 0, medido): v_bpo_admin_painel, v_bpo_alertas_ativos, v_bpo_kpis_globais,
--     v_bpo_clientes_ativos, v_bpo_performance_operador, v_kpis_monthly, v_admin_planos_completo,
--     v_sync_monitor → a demo não tem bpo_contrato/subscription/inbox; recriá-las só p/ defesa mudaria
--     security_invoker e ARRISCA esconder empresas de painel admin — deixadas de fora (RD-57: não quebrar
--     o que funciona). Reavaliar se o seed der dados de BPO à demo.
--   NAVEGAÇÃO (empresa única — filtrar esconderia a demo de quem apresenta, §3.1): v_titulos_consolidados,
--     v_lancamentos_consolidado, v_contas_receber_aging, v_contas_pagar_aging — deixadas de fora de propósito.
--   ACESSO POR EMPRESA (filtrar quebraria o detalhe da demo): v_sync_health (/admin/sync/empresa/[id]),
--     v_conciliacao_saude (API filtra por company_id quando informado) — deixadas de fora.
--
-- A defesa de verdade contra o consolidado é a §3.2 (intersect nas fn_psgc_*_consolidada), já aplicada.
--
-- Filtro por envelope: SELECT * FROM (<def original>) WHERE company_id IN (produtivas), com
-- security_invoker=on (obrigatório, §3.1). CREATE OR REPLACE só passa se as colunas baterem — garante
-- que a forma da view não muda. Prova (ROLLBACK): as duas passaram a demo=0 e mantiveram a produção.

DO $mig$
DECLARE v_nome text; v_def text;
  v_views text[] := ARRAY['v_dre_receita_3_fontes','v_tenant_subscriptions_summary'];
BEGIN
  FOREACH v_nome IN ARRAY v_views LOOP
    IF pg_get_viewdef(('public.'||v_nome)::regclass) ILIKE '%fn_empresas_produtivas%' THEN
      CONTINUE;  -- já filtrada (idempotente)
    END IF;
    v_def := regexp_replace(pg_get_viewdef(('public.'||v_nome)::regclass), ';\s*$', '');
    EXECUTE format(
      'CREATE OR REPLACE VIEW public.%I WITH (security_invoker=on) AS SELECT * FROM (%s) _o WHERE company_id IN (SELECT fn_empresas_produtivas())',
      v_nome, v_def);
  END LOOP;
END $mig$;
