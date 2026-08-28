-- SPEC PM-1 (PR-A) · Semáforo UNIFICADO (RD-52: um motor, cadastros por empresa/funil) +
-- módulo "Configurações do Sistema" do P&M (catálogo + plano + ativação nos tenants).
--
-- Auditado 28/08 (RD-26/44/45):
--   · PDois = 36b69d77-b4ea-414b-8519-2ff6621c8de7 (Prigol/Pdois).
--   · O "3/7" do Hub mora DENTRO do fn_crm_tempo_etapa (CASE fixo) — aqui ele passa a chamar o motor.
--   · Planos P&M = v15_pm_{pequena,media,grande}; 2 empresas ativas com P&M; pm_configuracoes não existe.
--   · funil de leads (agency_leads.etapa/etapa_desde): novo_atendimento/reuniao/proposta/negociacao/ganho/perdido.
--   · Lição do admin_dados_empresa/logo: módulo só aparece se estiver em plan_modules E tenant_modules_active.

-- ── ENTREGA 1a · módulo no catálogo ───────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, surface_in_groups, descricao)
VALUES ('pm_configuracoes', 'Configurações do Sistema', 'pm', 'pm_configuracao',
        '/dashboard/pm/configuracoes', 200, true, ARRAY['pm'],
        'Parâmetros do módulo P&M: funil, listas, alertas, proposta e comissão.')
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  ordem=EXCLUDED.ordem, ativo=true, surface_in_groups=EXCLUDED.surface_in_groups, descricao=EXCLUDED.descricao;

-- ── ENTREGA 1b · o módulo nos 3 planos P&M (senão nasce órfão no menu) ─────────
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT p, 'pm_configuracoes' FROM (VALUES ('v15_pm_pequena'),('v15_pm_media'),('v15_pm_grande')) v(p)
WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id=v.p AND pm.module_id='pm_configuracoes');

-- ── ENTREGA 1c · ativar nos tenants ativos com plano P&M ──────────────────────
-- dedup por row_number: empresas têm várias assinaturas (lição do backfill admin), 1 linha por empresa.
INSERT INTO public.tenant_modules_active
  (company_id, module_id, subscription_id, is_active, override_reason, activated_at)
SELECT company_id, 'pm_configuracoes', subscription_id, true, 'pm1_pm_configuracoes', now()
FROM (
  SELECT ts.company_id, ts.id AS subscription_id,
         row_number() OVER (PARTITION BY ts.company_id ORDER BY ts.id) AS rn
    FROM public.tenant_subscriptions ts
    JOIN public.companies c ON c.id = ts.company_id AND c.is_active = true
   WHERE ts.plan_id IN ('v15_pm_pequena','v15_pm_media','v15_pm_grande')
) q
WHERE q.rn = 1
  AND NOT EXISTS (SELECT 1 FROM public.tenant_modules_active t
                   WHERE t.company_id = q.company_id AND t.module_id = 'pm_configuracoes');

-- ── ENTREGA 2 · o CADASTRO único do semáforo (RD-52) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_alerta_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  funil         text NOT NULL,          -- 'leads' (P&M) | 'oportunidade' (Hub)
  etapa         text,                   -- NULL = vale para todas as etapas do funil
  dias_amarelo  int NOT NULL DEFAULT 3,
  dias_vermelho int NOT NULL DEFAULT 7,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
-- 1 regra global por (empresa,funil) e 1 por etapa: trata NULL como '' (unique nativo ignora NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_alerta_config
  ON public.crm_alerta_config (company_id, funil, COALESCE(etapa, ''));
ALTER TABLE public.crm_alerta_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_alerta_config_rw ON public.crm_alerta_config;
CREATE POLICY crm_alerta_config_rw ON public.crm_alerta_config FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ── ENTREGA 2 · o MOTOR único (RD-52) ─────────────────────────────────────────
-- etapa específica tem prioridade sobre a global (etapa NULL); sem registro → fallback 3/7 do Hub.
CREATE OR REPLACE FUNCTION public.fn_crm_semaforo(
  p_company_id uuid, p_funil text, p_etapa text, p_desde timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH cfg AS (
    SELECT dias_amarelo, dias_vermelho
      FROM public.crm_alerta_config
     WHERE company_id = p_company_id AND funil = p_funil AND ativo
       AND (etapa = p_etapa OR etapa IS NULL)
     ORDER BY (etapa = p_etapa) DESC NULLS LAST   -- específica antes da global
     LIMIT 1
  ), lim AS (
    SELECT COALESCE((SELECT dias_amarelo  FROM cfg), 3) AS amarelo,
           COALESCE((SELECT dias_vermelho FROM cfg), 7) AS vermelho
  )
  SELECT CASE
    WHEN p_desde IS NULL THEN 'verde'
    WHEN EXTRACT(DAY FROM now() - p_desde) >= (SELECT vermelho FROM lim) THEN 'vermelho'
    WHEN EXTRACT(DAY FROM now() - p_desde) >= (SELECT amarelo  FROM lim) THEN 'amarelo'
    ELSE 'verde' END;
$fn$;

-- ── ENTREGA 2 · o Hub passa a usar o motor (era 3/7 fixo) ─────────────────────
-- mesma assinatura/retorno; só o cálculo do semáforo muda para fn_crm_semaforo.
CREATE OR REPLACE FUNCTION public.fn_crm_tempo_etapa(p_company_id uuid)
RETURNS TABLE(oportunidade_id uuid, etapa text, desde timestamp with time zone,
              dias_na_etapa integer, dias_desde_criacao integer, origem text, semaforo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT o.id, o.etapa, o.created_at,
           (SELECT max(h.criado_em) FROM erp_crm_oportunidade_historico h
             WHERE h.oportunidade_id = o.id AND h.para_etapa = o.etapa) AS ultima_entrada
      FROM erp_crm_oportunidade o
     WHERE o.company_id = p_company_id AND o.deleted_at IS NULL
       AND o.company_id IN (SELECT get_user_company_ids())
  )
  SELECT b.id, b.etapa,
    COALESCE(b.ultima_entrada, b.created_at) AS desde,
    EXTRACT(DAY FROM now() - COALESCE(b.ultima_entrada, b.created_at))::int AS dias_na_etapa,
    EXTRACT(DAY FROM now() - b.created_at)::int AS dias_desde_criacao,
    CASE WHEN b.ultima_entrada IS NULL THEN 'created_at' ELSE 'historico' END AS origem,
    public.fn_crm_semaforo(p_company_id, 'oportunidade', b.etapa, COALESCE(b.ultima_entrada, b.created_at)) AS semaforo
  FROM base b;
$fn$;

-- ── ENTREGA 2 · batch do kanban de leads (mesmo motor) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_crm_leads_tempo(p_company_id uuid)
RETURNS TABLE(lead_id uuid, etapa text, desde timestamp with time zone, dias_na_etapa integer, semaforo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT l.id, l.etapa,
    COALESCE(l.etapa_desde, l.criado_em) AS desde,
    EXTRACT(DAY FROM now() - COALESCE(l.etapa_desde, l.criado_em))::int AS dias_na_etapa,
    public.fn_crm_semaforo(p_company_id, 'leads', l.etapa, COALESCE(l.etapa_desde, l.criado_em)) AS semaforo
  FROM public.agency_leads l
  WHERE l.company_id = p_company_id AND l.deleted_at IS NULL
    AND l.company_id IN (SELECT get_user_company_ids());
$fn$;

REVOKE ALL ON FUNCTION public.fn_crm_semaforo(uuid,text,text,timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_semaforo(uuid,text,text,timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_crm_leads_tempo(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_leads_tempo(uuid) TO authenticated, service_role;

-- ── ENTREGA 2 · seed PDois · leads amarelo 7 / vermelho 10 (pedido do Luzardo) ─
INSERT INTO public.crm_alerta_config (company_id, funil, etapa, dias_amarelo, dias_vermelho)
SELECT '36b69d77-b4ea-414b-8519-2ff6621c8de7', 'leads', NULL, 7, 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_alerta_config
   WHERE company_id='36b69d77-b4ea-414b-8519-2ff6621c8de7' AND funil='leads' AND etapa IS NULL);
