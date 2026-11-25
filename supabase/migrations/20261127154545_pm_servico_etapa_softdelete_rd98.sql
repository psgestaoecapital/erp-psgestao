-- PDCA P&M · /dashboard/pm/servicos · fecha RD-98 do recurso novo (etapas por serviço, #6193)
--
-- Contexto (auditor PDCA, CEO 06/11): o #6193 adicionou o modelo de etapas por serviço
-- numa tela JÁ SELADA (auditada_ok 20/11). Dois itens de RD-98 ficaram abertos:
--   P4 (EXCLUSÃO RASTREÁVEL): fn_agency_servico_etapa_excluir fazia DELETE FÍSICO, sem
--       soft-delete / quem-excluiu / audit_log. A convenção do módulo é soft-delete
--       (agency_servico usa deleted_at/deleted_by + audit_log_global).
--   P3 (ORIGEM DO DADO): system_screens.rpcs_chamadas da rota não lista as RPCs novas.
--
-- Esta migration é ADITIVA e idempotente. RD-38 (provado no dado antes de aplicar):
--   SELECT count(*) FROM public.agency_servico_etapa              -> 0 linhas (deploy no-op)
--   deleted_at em agency_servico_etapa                           -> NÃO existia (false)
--   system_screens.rpcs_chamadas de /dashboard/pm/servicos       -> só as 3 fn_agency_config_*
-- Sem UPDATE/DELETE em dado de cliente; apenas colunas novas + CREATE OR REPLACE.

-- 1) Colunas de soft-delete rastreável (padrão agency_servico) -------------------------
ALTER TABLE public.agency_servico_etapa
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) Excluir = soft-delete + audit_log_global (antes era DELETE físico) ----------------
CREATE OR REPLACE FUNCTION public.fn_agency_servico_etapa_excluir(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_e public.agency_servico_etapa%ROWTYPE;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  SELECT * INTO v_e FROM public.agency_servico_etapa
   WHERE id = p_id AND company_id = p_company_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;

  UPDATE public.agency_servico_etapa
     SET deleted_at = now(), deleted_by = v_uid, atualizado_em = now()
   WHERE id = p_id AND company_id = p_company_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
          'agency_servico_etapa', p_id::text, 'etapa_excluida',
          jsonb_build_object('nome', v_e.nome, 'servico_id', v_e.servico_id, 'ordem', v_e.ordem),
          jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 3) Listar ignora etapas excluídas ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agency_servico_etapa_listar(p_company_id uuid, p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordem, e.criado_em), '[]'::jsonb) INTO v
    FROM public.agency_servico_etapa e
   WHERE e.company_id = p_company_id
     AND e.servico_id = p_servico_id
     AND e.deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'etapas', v);
END $function$;

-- 4) Instanciar o modelo no job NÃO copia etapa excluída (mantém o soft-delete honesto) -
CREATE OR REPLACE FUNCTION public.fn_agency_job_etapas_listar(p_company_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_servico uuid;
  v         jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  -- o job precisa ser da própria empresa
  SELECT j.servico_id INTO v_servico
    FROM public.agency_jobs j
   WHERE j.id = p_job_id AND j.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_nao_encontrado'; END IF;

  -- instancia o modelo só se o job ainda não tem NENHUMA etapa e o serviço tem modelo
  IF v_servico IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_job_etapa e WHERE e.job_id = p_job_id)
  THEN
    INSERT INTO public.agency_job_etapa
      (company_id, job_id, servico_etapa_id, nome, descricao, ordem, medir_tempo)
    SELECT p_company_id, p_job_id, m.id, m.nome, m.descricao, m.ordem, m.medir_tempo
      FROM public.agency_servico_etapa m
     WHERE m.company_id = p_company_id
       AND m.servico_id = v_servico
       AND m.deleted_at IS NULL
    ON CONFLICT (job_id, servico_etapa_id) WHERE servico_etapa_id IS NOT NULL DO NOTHING;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordem, e.criado_em), '[]'::jsonb) INTO v
    FROM public.agency_job_etapa e
   WHERE e.company_id = p_company_id AND e.job_id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'etapas', v);
END $function$;

-- 4b) ACL das SECURITY DEFINER recriadas (check_fn_guards: REVOKE anon no mesmo arquivo) ---
--     Espelha a ACL viva (authenticated=X, service_role=X; sem anon/PUBLIC). Não amplia
--     nem reduz acesso — só torna a ACL explícita no arquivo da migration.
REVOKE ALL ON FUNCTION public.fn_agency_servico_etapa_excluir(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_servico_etapa_listar(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_job_etapas_listar(uuid, uuid)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_etapa_excluir(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_etapa_listar(uuid, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_agency_job_etapas_listar(uuid, uuid)     TO authenticated, service_role;

-- 5) RD-98 P3 — origem do dado: registra as 3 RPCs novas na tela (idempotente) ---------
UPDATE public.system_screens
   SET rpcs_chamadas = (
     SELECT array_agg(DISTINCT e ORDER BY e)
       FROM unnest(
         COALESCE(rpcs_chamadas, ARRAY[]::text[])
         || ARRAY['fn_agency_servico_etapa_listar',
                  'fn_agency_servico_etapa_salvar',
                  'fn_agency_servico_etapa_excluir']
       ) AS e
     )
 WHERE rota = '/dashboard/pm/servicos';
