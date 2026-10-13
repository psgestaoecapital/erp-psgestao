-- Oficina · BUG #16b: destravar ajuste de OS entregue (Jordana). Vertical Oficina. Pilar 1.
--
-- Achado (RD-38): fn_os_salvar já permite editar OS entregue, mas SÓ Master (CLIENT_OWNER)/admin.
-- A Jordana é do financeiro/BPO → ficava travada. Decisão (CEO): "os dois" (reabrir + ajuste
-- in-place), papéis = Master + BPO (+ admin PS).
--
-- (a) fn_os_salvar: a guarda pós-entrega passa a aceitar também o BPO da empresa (bpo_companies_assignment).
-- (b) fn_os_reabrir: volta a OS entregue → em_execucao (editável no fluxo normal), com log auditável.

-- (a) guarda pós-entrega do fn_os_salvar: + BPO (programático, idempotente).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_os_salvar(uuid,jsonb)'::regprocedure);
  IF d NOT ILIKE '%bpo_companies_assignment%' THEN
    d := replace(d,
      'public.fn_oficina_papel(v_os.company_id) IS DISTINCT FROM ''CLIENT_OWNER'' THEN',
      'public.fn_oficina_papel(v_os.company_id) IS DISTINCT FROM ''CLIENT_OWNER''' || chr(10) ||
      '     AND NOT EXISTS (SELECT 1 FROM bpo_companies_assignment b WHERE b.company_id = v_os.company_id AND b.user_id = auth.uid() AND b.ativo) THEN');
    EXECUTE d;
  END IF;
END
$mig$;

-- (b) Reabrir OS entregue → em_execucao, com log. Master/BPO/admin.
CREATE OR REPLACE FUNCTION public.fn_os_reabrir(p_os_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_autorizado boolean;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF v_os.company_id NOT IN (SELECT user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS'); END IF;

  v_autorizado := is_admin()
    OR public.fn_oficina_papel(v_os.company_id) = 'CLIENT_OWNER'
    OR EXISTS (SELECT 1 FROM bpo_companies_assignment b WHERE b.company_id = v_os.company_id AND b.user_id = auth.uid() AND b.ativo);
  IF NOT v_autorizado THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Apenas Master ou BPO podem reabrir uma OS entregue.'); END IF;
  IF v_os.status <> 'entregue' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só OS entregue pode ser reaberta (status atual: ' || v_os.status || ').'); END IF;

  UPDATE erp_os SET status = 'em_execucao', updated_at = now() WHERE id = p_os_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
      'erp_os', v_os.id::text, 'REABRIU_OS',
      jsonb_build_object('status', 'entregue'),
      jsonb_build_object('status', 'em_execucao', 'motivo', NULLIF(btrim(COALESCE(p_motivo,'')), '')));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'status', 'em_execucao',
    'faturada', COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_os_reabrir(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_os_reabrir(uuid, text) TO authenticated;
