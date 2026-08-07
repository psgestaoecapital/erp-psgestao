-- A1 · Agendamentos — entidade GENÉRICA erp_agendamento (oficina é o 1º consumidor; odonto converge depois).
-- RD-26: não recria a agenda do odonto; núcleo genérico + `dados` jsonb pro específico do ramo (placa/veículo).
-- Oficina genérica: placa/veículo NUNCA obrigatórios. RLS multi-tenant (Pilar 2 · get_user_company_ids()).
CREATE TABLE IF NOT EXISTS public.erp_agendamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  origem_modulo text NOT NULL DEFAULT 'oficina',
  titulo text, cliente_id uuid, cliente_nome text,
  responsavel_id uuid, responsavel_nome text,
  recurso_id uuid, recurso_tipo text,
  data date NOT NULL, hora_inicio time, hora_fim time,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','cancelado','nao_compareceu')),
  orcamento_id uuid, os_id uuid,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacao text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agenda_company_data ON public.erp_agendamento(company_id, data);
CREATE INDEX IF NOT EXISTS ix_agenda_origem_data  ON public.erp_agendamento(company_id, origem_modulo, data);
CREATE INDEX IF NOT EXISTS ix_agenda_os           ON public.erp_agendamento(os_id);
CREATE INDEX IF NOT EXISTS ix_agenda_orcamento    ON public.erp_agendamento(orcamento_id);

CREATE OR REPLACE FUNCTION public.tg_agenda_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_agenda_touch ON public.erp_agendamento;
CREATE TRIGGER trg_agenda_touch BEFORE UPDATE ON public.erp_agendamento FOR EACH ROW EXECUTE FUNCTION public.tg_agenda_touch();

ALTER TABLE public.erp_agendamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_agenda_sel ON public.erp_agendamento;
CREATE POLICY pol_agenda_sel ON public.erp_agendamento FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS pol_agenda_ins ON public.erp_agendamento;
CREATE POLICY pol_agenda_ins ON public.erp_agendamento FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS pol_agenda_upd ON public.erp_agendamento;
CREATE POLICY pol_agenda_upd ON public.erp_agendamento FOR UPDATE USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- 2.1 · listar (Dia/Semana). Duplo filtro (SECURITY DEFINER pula RLS) — Pilar 2.
CREATE OR REPLACE FUNCTION public.fn_agenda_listar(p_company_ids uuid[], p_origem text, p_de date, p_ate date)
RETURNS SETOF public.erp_agendamento LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.erp_agendamento
   WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
     AND (p_origem IS NULL OR origem_modulo = p_origem) AND data BETWEEN p_de AND p_ate
   ORDER BY data, hora_inicio NULLS LAST, created_at;
$$;

-- 2.2 · criar
CREATE OR REPLACE FUNCTION public.fn_agendamento_criar(
  p_company_id uuid, p_origem text, p_titulo text, p_cliente_id uuid, p_cliente_nome text,
  p_responsavel_id uuid, p_responsavel_nome text, p_data date, p_hora_inicio time, p_hora_fim time,
  p_dados jsonb DEFAULT '{}'::jsonb, p_observacao text DEFAULT NULL, p_orcamento_id uuid DEFAULT NULL)
RETURNS public.erp_agendamento LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem permissão para esta empresa'; END IF;
  INSERT INTO public.erp_agendamento(
    company_id, origem_modulo, titulo, cliente_id, cliente_nome, responsavel_id, responsavel_nome,
    data, hora_inicio, hora_fim, dados, observacao, orcamento_id, created_by
  ) VALUES (
    p_company_id, COALESCE(NULLIF(p_origem,''),'oficina'), p_titulo, p_cliente_id, p_cliente_nome,
    p_responsavel_id, p_responsavel_nome, p_data, p_hora_inicio, p_hora_fim,
    COALESCE(p_dados,'{}'::jsonb), p_observacao, p_orcamento_id, auth.uid()
  ) RETURNING * INTO v;
  RETURN v;
END $$;

-- 2.3 · mudar status
CREATE OR REPLACE FUNCTION public.fn_agendamento_mudar_status(p_id uuid, p_status text)
RETURNS public.erp_agendamento LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  IF p_status NOT IN ('agendado','confirmado','em_atendimento','concluido','cancelado','nao_compareceu') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status; END IF;
  UPDATE public.erp_agendamento SET status = p_status
   WHERE id = p_id AND company_id IN (SELECT get_user_company_ids()) RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado ou sem permissão'; END IF;
  RETURN v;
END $$;

-- 2.4 · programados de hoje que ainda não viraram OS (bloco do Pátio)
CREATE OR REPLACE FUNCTION public.fn_agenda_patio_hoje(p_company_ids uuid[])
RETURNS SETOF public.erp_agendamento LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.erp_agendamento
   WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
     AND data = CURRENT_DATE AND status IN ('agendado','confirmado') AND os_id IS NULL
   ORDER BY hora_inicio NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.fn_agenda_listar(uuid[],text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agendamento_criar(uuid,text,text,uuid,text,uuid,text,date,time,time,jsonb,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agendamento_mudar_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agenda_patio_hoje(uuid[]) TO authenticated;
