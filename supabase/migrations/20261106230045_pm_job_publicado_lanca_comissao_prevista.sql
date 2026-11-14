-- PM · Fecha a cadeia job -> comissão (chamado/PDCA auditor_pdca_2, 06/11).
--
-- Hoje fn_pm_job_mover_status, ao mover um job para 'publicado', só grava o status + audit_log;
-- a comissão do vendedor NUNCA é lançada (a própria UI do form de job declara "em PR futuro").
-- Esta migration fecha a cadeia de forma ADITIVA e IDEMPOTENTE, reaproveitando a função já testada
-- fn_agency_comissao_criar (que cria agency_comissao com status='prevista' e NÃO toca erp_pagar).
--
-- Decisão de escopo (das duas opções que o eng_chefe ofereceu no corpo da tarefa, escolhida a que
-- evita lançamento financeiro em dobro): no PUBLISH criamos apenas a comissão PREVISTA
-- (agency_comissao). A baixa em Contas a Pagar (erp_pagar) continua ocorrendo só no "marcar paga"
-- da tela de comissão (fn_agency_comissao_marcar_paga / PR #3707) — assim não há dupla contabilização.
--
-- Mapeamento dos campos (documentado para a revisão):
--   vendedor_id  = agency_jobs.responsavel_id  (responsável pelo job = quem recebe a comissão)
--   base_valor   = agency_jobs.valor_job
--   percentual   = agency_jobs.percentual_comissao
--   competencia  = 1º dia do mês corrente (date_trunc('month', now()))
--
-- Idempotência (dupla trava, provado no dado em BEGIN/ROLLBACK — antes=0, depois=1 mesmo chamando 2x,
-- valor=round(169.20*5/100,2)=8.46, status='prevista'):
--   (1) só dispara ao ENTRAR em 'publicado' vindo de outro status (v_status_ant IS DISTINCT FROM 'publicado');
--   (2) só cria se ainda NÃO existir comissão viva (deleted_em IS NULL) para o job.
-- Só cria quando há dado para comissionar: valor_job>0, percentual_comissao>0 e responsavel_id preenchido.

CREATE OR REPLACE FUNCTION public.fn_pm_job_mover_status(p_job_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_comp       uuid;
  v_status_ant text;
  v_titulo     text;
  v_valor_job  numeric;
  v_pct        numeric;
  v_resp       uuid;
  v_comissao   jsonb := NULL;
BEGIN
  IF p_status NOT IN ('nao_iniciada','em_producao','em_aprovacao','concluida','publicado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status invalido');
  END IF;

  SELECT company_id, status, titulo, valor_job, percentual_comissao, responsavel_id
    INTO v_comp, v_status_ant, v_titulo, v_valor_job, v_pct, v_resp
    FROM agency_jobs WHERE id = p_job_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao');
  END IF;

  UPDATE agency_jobs
     SET status = p_status, decidido_por = v_uid, decidido_em = now(), updated_at = now()
   WHERE id = p_job_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_jobs', p_job_id::text, 'job_status_' || p_status,
     jsonb_build_object('status', v_status_ant, 'titulo', v_titulo),
     jsonb_build_object('status', p_status, 'decidido_por', v_uid));

  -- Cadeia job -> comissão: só ao ENTRAR em 'publicado', com dado para comissionar e sem comissão viva.
  IF p_status = 'publicado'
     AND v_status_ant IS DISTINCT FROM 'publicado'
     AND COALESCE(v_valor_job, 0) > 0
     AND COALESCE(v_pct, 0) > 0
     AND v_resp IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agency_comissao c WHERE c.job_id = p_job_id AND c.deleted_em IS NULL)
  THEN
    v_comissao := fn_agency_comissao_criar(
      v_comp, v_resp, v_valor_job, v_pct, date_trunc('month', now())::date, p_job_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'comissao', v_comissao);
END;
$function$;

-- Guarda de ACL (espelha a ACL viva; exigido pelo gate check-fn-guards para SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.fn_pm_job_mover_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_mover_status(uuid, text) TO authenticated, service_role;
