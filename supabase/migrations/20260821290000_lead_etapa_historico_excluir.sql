-- P&M/Comercial · Kanban do lead: tempo na etapa, responsável/criador, excluir (soft-delete).
-- RD-38/RD-51 (premissas do SPEC corrigidas na origem):
--   1) fn_crm_mover_etapa opera em erp_crm_oportunidade, NÃO em agency_leads. O Kanban de
--      leads move client-side por UPDATE direto em agency_leads, em vários pontos. Portanto o
--      histórico + reset de etapa_desde é feito por TRIGGER (RD-52: captura TODOS os caminhos),
--      não reescrevendo uma RPC que nem é usada aqui.
--   2) agency_leads não tem "quem cadastrou". Adiciona criado_por (a partir de agora) — o card
--      já mostra o responsável (responsavel_id).

-- ── Colunas novas ────────────────────────────────────────────────────────────
ALTER TABLE public.agency_leads ADD COLUMN IF NOT EXISTS etapa_desde timestamptz;   -- quando entrou na etapa atual
ALTER TABLE public.agency_leads ADD COLUMN IF NOT EXISTS criado_por  uuid;           -- quem cadastrou (daqui pra frente)
ALTER TABLE public.agency_leads ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;    -- soft-delete (RD-54/55: nunca apaga)

-- Backfill honesto: sem histórico retroativo, etapa_desde parte de criado_em.
UPDATE public.agency_leads SET etapa_desde = criado_em WHERE etapa_desde IS NULL;

-- Índice pra listar do Kanban (só ativos da empresa).
CREATE INDEX IF NOT EXISTS agency_leads_ativos_idx ON public.agency_leads (company_id) WHERE deleted_at IS NULL;

-- ── Histórico de movimentação de etapa ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_lead_etapa_historico (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id    uuid NOT NULL REFERENCES public.agency_leads(id) ON DELETE CASCADE,
  etapa_de   text,
  etapa_para text NOT NULL,
  movido_por uuid,
  movido_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_lead_etapa_hist_lead_idx ON public.agency_lead_etapa_historico (lead_id, movido_em DESC);

ALTER TABLE public.agency_lead_etapa_historico ENABLE ROW LEVEL SECURITY;
-- Leitura por membros da empresa (o histórico habilita métricas depois). Escrita: só o trigger.
DROP POLICY IF EXISTS agency_lead_etapa_hist_sel ON public.agency_lead_etapa_historico;
CREATE POLICY agency_lead_etapa_hist_sel ON public.agency_lead_etapa_historico
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ── Trigger BEFORE: carimba criado_por/etapa_desde e reseta na mudança de etapa ─
CREATE OR REPLACE FUNCTION public.fn_agency_lead_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := COALESCE(NEW.criado_por, auth.uid());
    NEW.etapa_desde := COALESCE(NEW.etapa_desde, NEW.criado_em, now());
  ELSIF TG_OP = 'UPDATE' AND NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    NEW.etapa_desde := now();  -- "tempo na coluna" zera a cada movimento
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agency_lead_stamp ON public.agency_leads;
CREATE TRIGGER trg_agency_lead_stamp
  BEFORE INSERT OR UPDATE ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_agency_lead_stamp();

-- ── Trigger AFTER: registra o movimento no histórico ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_lead_etapa_hist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    INSERT INTO agency_lead_etapa_historico (company_id, lead_id, etapa_de, etapa_para, movido_por)
    VALUES (NEW.company_id, NEW.id, OLD.etapa, NEW.etapa, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agency_lead_etapa_hist ON public.agency_leads;
CREATE TRIGGER trg_agency_lead_etapa_hist
  AFTER UPDATE OF etapa ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_agency_lead_etapa_hist();

-- ── Excluir lead (soft-delete) ───────────────────────────────────────────────
-- Gate (confirmado com o CEO): responsável pelo lead, quem o criou, ou admin.
-- RD-54/55: soft-delete (deleted_at) — o dado permanece no banco, auditável.
CREATE OR REPLACE FUNCTION public.fn_crm_lead_excluir(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_uid uuid := auth.uid();
BEGIN
  SELECT company_id, responsavel_id, criado_por, deleted_at INTO v_lead
    FROM agency_leads WHERE id = p_lead_id;
  IF v_lead.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT (is_admin() OR v_uid = v_lead.responsavel_id OR v_uid = v_lead.criado_por) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'orientacao', 'Apenas o responsável, quem criou o lead ou um administrador podem excluí-lo.'); END IF;
  IF v_lead.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE agency_leads SET deleted_at = now(), atualizado_em = now() WHERE id = p_lead_id;
  RETURN jsonb_build_object('ok', true, 'id', p_lead_id, 'excluido', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_crm_lead_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_excluir(uuid) TO authenticated;
