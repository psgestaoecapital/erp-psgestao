-- DEV7CLAUDEPS · PDCA P&M · /dashboard/pm/comissao (auditor_pdca_2, BLOQUEADO).
--
-- PROVA NO DADO (RD-38): agency_comissao da DEMO P&M (b0700000-0000-4000-a000-000000000002) = 0 linhas → a tela só
-- mostra "Sem comissões no período" (jornada prevista→a pagar→paga não demonstrável). Além disso a ação "Marcar paga"
-- fazia UPDATE direto (page.tsx), sem RPC/guarda/rastro.
--
-- ESTA MIGRATION (ADITIVA):
--  1) agency_comissao ganha paga_em / paga_por (rastro de quem marcou paga).
--  2) fn_agency_comissao_marcar_paga: RPC com guarda (company + is_admin), exige status a_pagar, grava paga_em/paga_por
--     e registra em audit_log_global (RD-98 p4). Substitui o UPDATE cru da tela.
--  3) fn_demo_seed_pm_comissao: semeia comissões (prevista/a pagar/paga) ligadas a jobs e vendedores da DEMO (só is_demo,
--     idempotente). Irrigação imediata ao final (não altera fn_demo_reset para não conflitar com a PR da margem).
--  4) system_screens: origem do dado (views/RPCs) da rota (RD-98 p3).

-- (1) rastro -----------------------------------------------------------------------------------------------------
ALTER TABLE public.agency_comissao ADD COLUMN IF NOT EXISTS paga_em  timestamptz;
ALTER TABLE public.agency_comissao ADD COLUMN IF NOT EXISTS paga_por uuid;

-- (2) RPC guardada para marcar paga ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_marcar_paga(p_comissao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c agency_comissao%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_comissao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.status = 'paga' THEN
    RETURN jsonb_build_object('ok', true, 'ja_paga', true); END IF;
  IF v_c.status <> 'a_pagar' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'só comissão "a pagar" pode ser marcada paga'); END IF;

  UPDATE agency_comissao
     SET status = 'paga', paga_em = now(), paga_por = v_uid
   WHERE id = p_comissao_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', p_comissao_id,
          'comissao_marcar_paga',
          jsonb_build_object('status', v_c.status),
          jsonb_build_object('status', 'paga', 'paga_em', now(), 'paga_por', v_uid));

  RETURN jsonb_build_object('ok', true, 'valor', COALESCE(v_c.valor_comissao, 0));
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) TO authenticated;

-- (3) seed de comissões na DEMO ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_comissao(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_demo_seed_pm_comissao — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset/deploy (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_mes  date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_n int := 0; r record;
  v_vends uuid[] := ARRAY['4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb','74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa']::uuid[];
  v_base numeric; v_pct numeric; v_status text; v_comp date; v_vend uuid;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  FOR r IN
    SELECT j.id job_id, (row_number() OVER (ORDER BY j.created_at DESC))::int rn
    FROM agency_jobs j
    WHERE j.company_id = v_demo AND j.excluido_em IS NULL
    ORDER BY j.created_at DESC
    LIMIT 9
  LOOP
    -- 3 previstas (mês atual), 3 a pagar (mês passado), 3 pagas (2 meses atrás): a jornada inteira na vitrine.
    v_status := CASE WHEN r.rn <= 3 THEN 'prevista' WHEN r.rn <= 6 THEN 'a_pagar' ELSE 'paga' END;
    v_comp   := CASE WHEN r.rn <= 3 THEN v_mes WHEN r.rn <= 6 THEN (v_mes - interval '1 month')::date ELSE (v_mes - interval '2 months')::date END;
    v_base   := 800 + (r.rn * 170);              -- base determinística
    v_pct    := 5 + (r.rn % 4);                  -- 5–8%
    v_vend   := v_vends[1 + (r.rn % 2)];
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = v_vend);
    IF NOT EXISTS (SELECT 1 FROM agency_comissao WHERE company_id = v_demo AND job_id = r.job_id) THEN
      INSERT INTO agency_comissao (company_id, job_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status, paga_em, paga_por, tipo)
      VALUES (v_demo, r.job_id, v_vend, v_base, v_pct, round(v_base * v_pct / 100.0, 2), v_comp, v_status,
              CASE WHEN v_status = 'paga' THEN (v_comp + 20) ELSE NULL END,
              CASE WHEN v_status = 'paga' THEN v_vend ELSE NULL END, 'unica');
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'comissoes', v_n);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_demo_seed_pm_comissao(uuid) FROM PUBLIC, anon, authenticated;

-- (4) origem do dado (RD-98 p3) da rota --------------------------------------------------------------------------
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_comissao','agency_jobs']::text[],
       rpcs_chamadas    = ARRAY['fn_agency_comissao_aprovar','fn_agency_comissao_marcar_paga']::text[]
 WHERE rota = '/dashboard/pm/comissao'
   AND (coalesce(array_length(views_consumidas,1),0) = 0 OR coalesce(array_length(rpcs_chamadas,1),0) = 0);

-- irriga a DEMO P&M agora (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_pm_comissao('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;
