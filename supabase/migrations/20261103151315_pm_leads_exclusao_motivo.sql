-- PM · Leads (Funil) · RD-98 p4: exclusão rastreável com MOTIVO (quem/quando/motivo + audit_log)
-- Hoje fn_crm_lead_excluir já grava deleted_at/deleted_by + audit_log, mas NÃO captura o motivo.
-- Este patch (aditivo) acrescenta a coluna deleted_motivo e passa a receber/gravar o motivo na exclusão.
-- Escopo por company_id (RD-45) mantido; função SECURITY DEFINER com guarda de permissão; REVOKE anon.
-- Idempotente.

-- 1) Coluna de motivo (aditiva, nullable)
ALTER TABLE public.agency_leads ADD COLUMN IF NOT EXISTS deleted_motivo text;

-- 2) Troca a assinatura 1-arg pela 2-arg (p_motivo opcional). DROP + CREATE para não deixar overload órfão.
DROP FUNCTION IF EXISTS public.fn_crm_lead_excluir(uuid);

CREATE OR REPLACE FUNCTION public.fn_crm_lead_excluir(p_lead_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_uid uuid := auth.uid(); v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
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

  UPDATE agency_leads
     SET deleted_at = now(), deleted_by = v_uid, deleted_motivo = v_motivo, atualizado_em = now()
   WHERE id = p_lead_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_lead.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_leads', p_lead_id::text,
          'crm_lead_excluir',
          jsonb_build_object('deleted_at', NULL),
          jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid, 'motivo', v_motivo));

  RETURN jsonb_build_object('ok', true, 'id', p_lead_id, 'excluido', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_crm_lead_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_excluir(uuid, text) TO authenticated, service_role;

-- 3) RD-95: "?" do filtro de período personalizado (início/fim)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'pm.leads.filtro_periodo_custom', '/dashboard/pm/leads', 'Leads (Funil)', 'Período personalizado (início e fim)',
  'Defina a data inicial e a data final do intervalo que você quer analisar.',
  'Limita o funil aos leads cuja data de entrada/movimento cai dentro do intervalo escolhido.',
  'Início 01/09 e Fim 30/09 mostra só os leads que entraram em setembro.',
  'Deixar início ou fim em branco: sem as duas datas o intervalo não é aplicado.',
  'pm', 14, 1, 'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'publicado', atualizado_em = now();
