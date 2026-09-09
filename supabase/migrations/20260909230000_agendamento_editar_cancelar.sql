-- ============================================================
-- Agenda: habilitar EDITAR e CANCELAR agendamento (chamado 3 do KGF).
-- erp_agendamento já tem os status 'cancelado' e 'nao_compareceu' e fn_agendamento_mudar_status
-- já os aceita — faltava (a) uma função de EDIÇÃO e (b) o MOTIVO no cancelamento.
--
-- Decisão do CEO: 'cancelado' e 'nao_compareceu' são ações DISTINTAS (cliente que avisou vs.
-- cliente que sumiu). Mantidas separadas — o não-comparecimento não vira "cancelado".
-- ============================================================

-- 1) Editar: data, hora, cliente, veículo (placa/modelo em dados) e observação.
--    Não edita agendamento que já virou OS (os_id preenchido = em atendimento).
CREATE OR REPLACE FUNCTION public.fn_agendamento_editar(
  p_id uuid,
  p_data date DEFAULT NULL,
  p_hora_inicio time without time zone DEFAULT NULL,
  p_hora_fim time without time zone DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL,
  p_cliente_nome text DEFAULT NULL,
  p_placa text DEFAULT NULL,
  p_veiculo text DEFAULT NULL,
  p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.erp_agendamento WHERE id = p_id;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agendamento_nao_encontrado'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_virou_os'); END IF;   -- já em atendimento

  UPDATE public.erp_agendamento SET
    data         = coalesce(p_data, data),
    hora_inicio  = coalesce(p_hora_inicio, hora_inicio),
    hora_fim     = coalesce(p_hora_fim, hora_fim),
    cliente_id   = coalesce(p_cliente_id, cliente_id),
    cliente_nome = coalesce(nullif(btrim(p_cliente_nome), ''), cliente_nome),
    observacao   = coalesce(p_observacao, observacao),
    dados        = coalesce(dados, '{}'::jsonb)
                   || case when p_placa   is not null then jsonb_build_object('placa',   upper(btrim(p_placa)))  else '{}'::jsonb end
                   || case when p_veiculo is not null then jsonb_build_object('veiculo', btrim(p_veiculo)) else '{}'::jsonb end
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agendamento_editar(uuid, date, time without time zone, time without time zone, uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_agendamento_editar(uuid, date, time without time zone, time without time zone, uuid, text, text, text, text) TO authenticated;

-- 2) Cancelar com MOTIVO: p_motivo opcional (DEFAULT NULL mantém as chamadas de 2 args funcionando).
--    Quando informado, grava dados->>'motivo_<status>' (ex.: motivo_cancelado). 'nao_compareceu' segue
--    como ação própria (motivo opcional).
CREATE OR REPLACE FUNCTION public.fn_agendamento_mudar_status(
  p_id uuid, p_status text, p_motivo text DEFAULT NULL)
 RETURNS erp_agendamento
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  IF p_status NOT IN ('agendado','confirmado','em_atendimento','concluido','cancelado','nao_compareceu') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status; END IF;
  UPDATE public.erp_agendamento SET
    status = p_status,
    dados  = CASE WHEN p_motivo IS NOT NULL AND btrim(p_motivo) <> ''
                  THEN coalesce(dados, '{}'::jsonb)
                       || jsonb_build_object('motivo_' || p_status, btrim(p_motivo),
                                             'status_mudado_em', now())
                  ELSE dados END
   WHERE id = p_id AND company_id IN (SELECT get_user_company_ids()) RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado ou sem permissão'; END IF;
  RETURN v;
END $function$;
