-- Oficina · #104 (banco) — EXCLUIR agendamento (soft-delete + autoria), distinto de Cancelar.
-- Jordana: Cancelar é fato do negócio (cliente desmarcou); Excluir é erro de digitação (agendou errado).
-- Mantém o bloqueio "já virou OS" (os_id != null) — o que já está em atendimento não some da agenda.
-- fn_agenda_listar passa a esconder os excluídos.
--
-- RD-52 (arquivo=ledger) · RD-38 (provado em rollback). SECURITY DEFINER → REVOKE anon + autoria auth.uid().

ALTER TABLE public.erp_agendamento
  ADD COLUMN IF NOT EXISTS excluido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por    uuid,
  ADD COLUMN IF NOT EXISTS excluido_motivo text;

-- Listagem esconde os excluídos (soft-delete).
CREATE OR REPLACE FUNCTION public.fn_agenda_listar(p_company_ids uuid[], p_origem text, p_de date, p_ate date)
 RETURNS SETOF erp_agendamento
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.erp_agendamento
   WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
     AND (p_origem IS NULL OR origem_modulo = p_origem) AND data BETWEEN p_de AND p_ate
     AND excluido_em IS NULL
   ORDER BY data, hora_inicio NULLS LAST, created_at;
$function$;

REVOKE ALL ON FUNCTION public.fn_agenda_listar(uuid[],text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agenda_listar(uuid[],text,date,date) TO authenticated, service_role;

-- Excluir (soft-delete): erro de digitação. Bloqueia se já virou OS (os_id). Autoria por auth.uid().
CREATE OR REPLACE FUNCTION public.fn_agendamento_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.erp_agendamento WHERE id = p_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'agendamento_nao_encontrado'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_virou_os'); END IF;
  IF v.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;  -- idempotente
  UPDATE public.erp_agendamento
     SET excluido_em = now(), excluido_por = auth.uid(), excluido_motivo = nullif(btrim(p_motivo), '')
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agendamento_excluir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agendamento_excluir(uuid,text) TO authenticated, service_role;

-- #104 · PÁTIO só a SEMANA + botão "consultar atrasados". Antes fn_agenda_patio_hoje trazia
-- data <= hoje (hoje + TODA a pilha de atrasados), poluindo o pátio. Agora:
--   p_modo='semana'    (default) → apenas a semana corrente (segunda–domingo);
--   p_modo='atrasados'           → data < hoje, não concluído nem cancelado (agendado/confirmado), ainda
--                                  não virou OS — a pilha, mostrada só quando a Jordana pedir.
-- Ambos respeitam o soft-delete novo (excluido_em IS NULL).
CREATE OR REPLACE FUNCTION public.fn_agenda_patio_hoje(p_company_ids uuid[], p_modo text DEFAULT 'semana')
 RETURNS SETOF erp_agendamento
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.erp_agendamento
   WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
     AND status IN ('agendado','confirmado')
     AND os_id IS NULL
     AND excluido_em IS NULL
     AND CASE WHEN p_modo = 'atrasados'
              THEN data < CURRENT_DATE
              ELSE data BETWEEN date_trunc('week', CURRENT_DATE)::date AND (date_trunc('week', CURRENT_DATE)::date + 6)
         END
   ORDER BY data, hora_inicio NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.fn_agenda_patio_hoje(uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agenda_patio_hoje(uuid[],text) TO authenticated, service_role;
