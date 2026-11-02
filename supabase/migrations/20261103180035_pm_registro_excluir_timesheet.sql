-- PDCA P&M · /dashboard/producao (Workspace da Agência) · aud8 85/95
-- GAP 1 (RD-98 p2 CRUD): Excluir de TIMESHEET quebrado.
--   A aba Timesheet chama fn_pm_registro_excluir(p_tabela:'agency_timesheet'), mas a
--   função só tratava agency_clientes/agency_jobs/agency_tarefas; qualquer outra tabela
--   caía no ELSE => RAISE EXCEPTION 'Tabela não permitida: agency_timesheet' e o registro
--   NÃO era excluído. agency_timesheet JÁ tem excluido_em/excluido_por.
-- GAP 2 (RD-98 p3): system_screens.rpcs_chamadas de /dashboard/producao não listava
--   fn_pm_registro_excluir (usado nos dois "Excluir" da tela).
-- Aditiva/segura: só acrescenta um ramo ELSIF espelhando os 3 existentes (soft-delete +
--   fn__guarda_empresa + audit_log_global). Nenhum dado de cliente alterado. Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_pm_registro_excluir(p_tabela text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  IF p_tabela = 'agency_clientes' THEN
    SELECT company_id INTO v_co FROM agency_clientes WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_clientes SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSIF p_tabela = 'agency_jobs' THEN
    SELECT company_id INTO v_co FROM agency_jobs WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Job não encontrado'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_jobs SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSIF p_tabela = 'agency_tarefas' THEN
    SELECT company_id INTO v_co FROM agency_tarefas WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_tarefas SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSIF p_tabela = 'agency_timesheet' THEN
    SELECT company_id INTO v_co FROM agency_timesheet WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Lançamento de horas não encontrado'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_timesheet SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSE
    RAISE EXCEPTION 'Tabela não permitida: %', p_tabela;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, auth.uid(), p_tabela, p_id, 'excluir',
            jsonb_build_object('excluido_em', NULL),
            jsonb_build_object('excluido_em', now()));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- GAP 2 (RD-98 p3): origem do dado — acrescenta o RPC usado pelos dois "Excluir" da tela,
-- idempotente (só adiciona se ainda não estiver na lista).
UPDATE public.system_screens
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x ORDER BY x)
           FROM unnest(COALESCE(rpcs_chamadas, '{}') || ARRAY['fn_pm_registro_excluir']) AS x
       )
 WHERE rota = '/dashboard/producao'
   AND NOT ('fn_pm_registro_excluir' = ANY(COALESCE(rpcs_chamadas, '{}')));

-- ACL (gate check_fn_guards / regra revoke_anon): função SECURITY DEFINER em migration nova
-- reafirma a ACL viva no próprio arquivo (EXECUTE só authenticated + service_role; anon/PUBLIC fora).
REVOKE ALL ON FUNCTION public.fn_pm_registro_excluir(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_registro_excluir(text, uuid) TO authenticated, service_role;
