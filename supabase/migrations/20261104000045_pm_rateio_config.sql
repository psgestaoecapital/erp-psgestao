-- P&M · Margem por cliente (P7 · Blueprint §3/§6) — slice 1a: CRITÉRIO DE RATEIO declarado e configurável.
--
-- Margem por cliente = receita do cliente − (custo direto das etapas medidas + indiretas rateadas por cliente).
-- Hoje só existe margem por job. Para ratear as despesas indiretas entre os clientes é preciso um CRITÉRIO
-- DECLARADO e configurável (por horas ou por receita) — não pode ser implícito. Esta fatia entrega a camada de
-- CONFIGURAÇÃO desse critério por empresa; é a fundação das fatias seguintes (RPC de rateio das indiretas da GE
-- por cliente e tela /dashboard/pm/rentabilidade).
--
-- 100% aditivo: TABLE/FUNCTION/ÍNDICE NOVOS, RLS por company_id, REVOKE anon. Lê/grava só a própria configuração
-- da empresa; NÃO toca o financeiro, NÃO recria lançamento e NÃO altera dado de cliente. A gravação deixa rastro
-- (quem/quando + audit_log_global), no padrão das demais RPCs de P&M.

-- ── 1) Tabela de configuração do critério de rateio (uma config por empresa) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_rateio_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  criterio       text NOT NULL DEFAULT 'receita' CHECK (criterio IN ('receita', 'horas')),
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz,
  atualizado_por uuid
);

ALTER TABLE public.agency_rateio_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_rateio_config_rls ON public.agency_rateio_config;
CREATE POLICY agency_rateio_config_rls ON public.agency_rateio_config
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- uma configuração por empresa (também é o alvo do ON CONFLICT do upsert abaixo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_rateio_config_company
  ON public.agency_rateio_config(company_id);

REVOKE ALL ON TABLE public.agency_rateio_config FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agency_rateio_config TO authenticated, service_role;

-- ── 2) Leitura: critério ativo da empresa (default 'receita' quando ainda não configurado) ────────────
CREATE OR REPLACE FUNCTION public.fn_pm_rateio_config_ler(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public.agency_rateio_config%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT * INTO v_cfg FROM public.agency_rateio_config WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'criterio', COALESCE(v_cfg.criterio, 'receita'),
    'observacao', v_cfg.observacao,
    'configurado', v_cfg.id IS NOT NULL,
    'atualizado_em', v_cfg.atualizado_em
  );
END
$function$;
REVOKE ALL ON FUNCTION public.fn_pm_rateio_config_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_rateio_config_ler(uuid) TO authenticated, service_role;

-- ── 3) Gravação: upsert do critério (receita|horas) com rastro + audit_log_global ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_rateio_config_salvar(
  p_company_id uuid,
  p_criterio   text,
  p_observacao text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_crit  text := lower(btrim(COALESCE(p_criterio, '')));
  v_antes text;
  v_id    uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_crit NOT IN ('receita', 'horas') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'criterio_invalido');
  END IF;

  SELECT id, criterio INTO v_id, v_antes
    FROM public.agency_rateio_config WHERE company_id = p_company_id;

  INSERT INTO public.agency_rateio_config (company_id, criterio, observacao, criado_por)
  VALUES (p_company_id, v_crit, NULLIF(btrim(COALESCE(p_observacao, '')), ''), v_uid)
  ON CONFLICT (company_id) DO UPDATE
    SET criterio       = EXCLUDED.criterio,
        observacao     = EXCLUDED.observacao,
        atualizado_em  = now(),
        atualizado_por = v_uid
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_rateio_config', v_id::text,
     CASE WHEN v_antes IS NULL THEN 'rateio_config_criada' ELSE 'rateio_config_alterada' END,
     jsonb_build_object('criterio', v_antes),
     jsonb_build_object('criterio', v_crit));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'criterio', v_crit);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_pm_rateio_config_salvar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_rateio_config_salvar(uuid, text, text) TO authenticated, service_role;

-- ── 4) Seed DEMO (idempotente): critério padrão 'receita' na Agência P&M DEMO ─────────────────────────
INSERT INTO public.agency_rateio_config (company_id, criterio, observacao)
VALUES ('b0700000-0000-4000-a000-000000000002', 'receita',
        'Critério padrão da DEMO (editável na tela de rentabilidade P&M)')
ON CONFLICT (company_id) DO NOTHING;
