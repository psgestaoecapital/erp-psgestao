-- Cobrança por etapa (P&M · tarefa eng_chefe 7abf3734) — PR (1): CAMADA DE DADOS.
-- Hoje /dashboard/pm/cobranca só deriva/exibe o fee dos contratos recorrentes e
-- não PERSISTE o estado de cada cobrança (lançada/enviada/paga/estornada) nem o
-- histórico (RD-98 p2: CRUD incompleto). Esta PR entrega só a tabela de
-- lançamentos de cobrança por contrato/competência e as RPCs guardadas de
-- lançar / mudar status / estornar (rastreável) / listar (histórico). A tela
-- (bloco "Histórico" + ações) vem na PR seguinte.
--
-- ADITIVA (RD-94.1 c): tabela/policy/funções NOVAS, RLS por company_id, REVOKE
-- anon. Nada existente é alterado. Estorno é soft (status=estornada) e rastreável
-- (estornado_por/estornado_em/motivo + audit_log_global) — nunca DELETE físico.

CREATE TABLE IF NOT EXISTS public.agency_cobranca_lancamento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contrato_id    uuid NOT NULL REFERENCES public.agency_contratos(id) ON DELETE CASCADE,
  cliente_id     uuid,
  competencia    date NOT NULL,                       -- 1º dia do mês de competência
  valor          numeric(14,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'lancada'
                   CHECK (status IN ('lancada','enviada','paga','estornada')),
  observacao     text,
  lancado_em     timestamptz NOT NULL DEFAULT now(),
  lancado_por    uuid,
  enviado_em     timestamptz,
  pago_em        timestamptz,
  estornado_em   timestamptz,
  estornado_por  uuid,
  motivo_estorno text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  -- uma cobrança viva por contrato/competência (estornada libera novo lançamento)
  CONSTRAINT agency_cobranca_valor_nao_neg CHECK (valor >= 0)
);

-- Idempotência: no máximo uma cobrança NÃO estornada por contrato+competência.
CREATE UNIQUE INDEX IF NOT EXISTS agency_cobranca_contrato_comp_viva_uk
  ON public.agency_cobranca_lancamento (company_id, contrato_id, competencia)
  WHERE status <> 'estornada';

CREATE INDEX IF NOT EXISTS agency_cobranca_company_contrato_idx
  ON public.agency_cobranca_lancamento (company_id, contrato_id);

ALTER TABLE public.agency_cobranca_lancamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_cobranca_lancamento_access ON public.agency_cobranca_lancamento;
CREATE POLICY agency_cobranca_lancamento_access ON public.agency_cobranca_lancamento FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON TABLE public.agency_cobranca_lancamento FROM anon;
GRANT SELECT ON TABLE public.agency_cobranca_lancamento TO authenticated;

-- Lançar cobrança (status inicial = lancada). Idempotente: se já há uma viva no
-- mesmo contrato/competência, devolve a existente em vez de duplicar.
CREATE OR REPLACE FUNCTION public.fn_agency_cobranca_lancar(
  p_company_id uuid, p_contrato_id uuid, p_competencia date,
  p_valor numeric DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_cliente uuid; v_fee numeric; v_comp date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- contrato tem de ser da empresa
  SELECT cliente_id, fee_mensal INTO v_cliente, v_fee
    FROM agency_contratos WHERE id = p_contrato_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato_invalido'); END IF;
  v_comp := date_trunc('month', COALESCE(p_competencia, now()::date))::date;

  SELECT id INTO v_id FROM agency_cobranca_lancamento
    WHERE company_id = p_company_id AND contrato_id = p_contrato_id
      AND competencia = v_comp AND status <> 'estornada';
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'ja_existia', true); END IF;

  INSERT INTO agency_cobranca_lancamento
    (company_id, contrato_id, cliente_id, competencia, valor, status, observacao, lancado_por)
  VALUES (p_company_id, p_contrato_id, v_cliente, v_comp,
          COALESCE(p_valor, v_fee, 0), 'lancada', p_observacao, v_uid)
  RETURNING id INTO v_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_cobranca_lancamento', v_id::text, 'cobranca_lancar', NULL,
            jsonb_build_object('contrato_id', p_contrato_id, 'competencia', v_comp, 'valor', COALESCE(p_valor, v_fee, 0)));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- Mudar status ao longo da etapa (lancada -> enviada -> paga). Não permite sair
-- de estornada; o estorno tem função própria.
CREATE OR REPLACE FUNCTION public.fn_agency_cobranca_status(
  p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r public.agency_cobranca_lancamento%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM agency_cobranca_lancamento WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_status NOT IN ('lancada','enviada','paga') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF v_r.status = 'estornada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cobranca_estornada'); END IF;

  UPDATE agency_cobranca_lancamento
     SET status = p_status,
         enviado_em = CASE WHEN p_status = 'enviada' THEN now() ELSE enviado_em END,
         pago_em    = CASE WHEN p_status = 'paga'    THEN now() ELSE pago_em    END,
         atualizado_em = now()
   WHERE id = p_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_r.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_cobranca_lancamento', p_id::text, 'cobranca_status',
            jsonb_build_object('status', v_r.status), jsonb_build_object('status', p_status));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Estornar cobrança (rastreável). Soft: status=estornada + quem/quando/motivo.
CREATE OR REPLACE FUNCTION public.fn_agency_cobranca_estornar(
  p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r public.agency_cobranca_lancamento%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM agency_cobranca_lancamento WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_r.status = 'estornada' THEN
    RETURN jsonb_build_object('ok', true, 'ja_estornada', true); END IF;

  UPDATE agency_cobranca_lancamento
     SET status = 'estornada', estornado_em = now(), estornado_por = v_uid,
         motivo_estorno = p_motivo, atualizado_em = now()
   WHERE id = p_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_r.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_cobranca_lancamento', p_id::text, 'cobranca_estornar',
            jsonb_build_object('status', v_r.status),
            jsonb_build_object('status', 'estornada', 'motivo', p_motivo));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Histórico: lançamentos da empresa (opcionalmente de um contrato), mais recentes
-- primeiro, incluindo os estornados (rastro completo).
CREATE OR REPLACE FUNCTION public.fn_agency_cobranca_listar(
  p_company_id uuid, p_contrato_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.competencia DESC, t.criado_em DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT id, contrato_id, cliente_id, competencia, valor, status, observacao,
             lancado_em, enviado_em, pago_em, estornado_em, motivo_estorno
        FROM agency_cobranca_lancamento
       WHERE company_id = p_company_id
         AND (p_contrato_id IS NULL OR contrato_id = p_contrato_id)
    ) t;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v_rows);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_cobranca_lancar(uuid, uuid, date, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_agency_cobranca_status(uuid, text)                       FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_agency_cobranca_estornar(uuid, text)                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_agency_cobranca_listar(uuid, uuid)                       FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_agency_cobranca_lancar(uuid, uuid, date, numeric, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_agency_cobranca_status(uuid, text)                       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_agency_cobranca_estornar(uuid, text)                     TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_agency_cobranca_listar(uuid, uuid)                       TO authenticated, service_role;
