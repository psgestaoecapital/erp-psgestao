-- RD-69 Parte 1 · SEGURANÇA (contexto f04713ca, base da RD-70)
--
-- (b) fn_set_is_demo: a flag companies.is_demo passa a ser mexida SÓ por PS_ADMIN, com registro em
--     audit_log_global, e RECUSA ligar is_demo numa empresa com DADO REAL (protege cliente de ser
--     marcado como demo e depois resetado/limpo pelo fn_demo_reset). Desligar é permitido (com audit).
-- (d) Renomeia as duas empresas [BOT] atuais para a identidade de DEMONSTRAÇÃO (já are is_demo=true).
--
-- A allowlist do robô (só is_demo) vive no app (src/lib/gold/roboEmpresaPermitida.ts) — nas 3 rotas.

-- ── (b) fn_set_is_demo ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_is_demo(p_company_id uuid, p_on boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_sysrole text;
  v_atual boolean;
  v_nome text;
  v_tem_dado_real boolean;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;

  SELECT system_role, email INTO v_sysrole, v_email FROM public.users WHERE id = v_uid;
  -- Só PS_ADMIN (ou chamada interna/service_role) mexe na flag. coalesce = null-safe: sem ele,
  -- v_sysrole NULL faz `IN (...)` virar NULL e o IF NÃO dispara → usuário sem system_role passaria.
  IF NOT (v_interno OR coalesce(auth.role(), '') = 'service_role'
          OR coalesce(v_sysrole, '') IN ('PS_ADMIN', 'PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Só PS_ADMIN pode marcar is_demo' USING errcode = '42501';
  END IF;

  SELECT is_demo, coalesce(nome_fantasia, razao_social, id::text) INTO v_atual, v_nome
    FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;

  -- Recusa LIGAR em empresa com dado real (fiscal/financeiro): jamais transformar cliente em demo.
  IF p_on IS TRUE AND v_atual IS DISTINCT FROM true THEN
    SELECT EXISTS (SELECT 1 FROM erp_receber WHERE company_id = p_company_id)
        OR EXISTS (SELECT 1 FROM erp_pagar   WHERE company_id = p_company_id)
      INTO v_tem_dado_real;
    IF v_tem_dado_real THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'empresa_com_dado_real', 'empresa', v_nome);
    END IF;
  END IF;

  UPDATE public.companies SET is_demo = p_on WHERE id = p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, v_email, 'companies.is_demo', p_company_id::text,
          CASE WHEN p_on THEN 'set_is_demo_on' ELSE 'set_is_demo_off' END,
          jsonb_build_object('is_demo', v_atual),
          jsonb_build_object('is_demo', p_on, 'motivo', p_motivo));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'is_demo', p_on);
END; $$;

COMMENT ON FUNCTION public.fn_set_is_demo(uuid, boolean, text) IS
  'RD-69: marca companies.is_demo. Só PS_ADMIN; audita em audit_log_global; recusa ligar em empresa com dado real.';

REVOKE ALL ON FUNCTION public.fn_set_is_demo(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_set_is_demo(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_set_is_demo(uuid, boolean, text) TO authenticated, service_role;

-- ── (d) Identidade de demonstração das duas [BOT] atuais ────────────────────────────────────────────
UPDATE public.companies
   SET nome_fantasia = 'Demonstração · Oficina', razao_social = 'Demonstração Oficina LTDA'
 WHERE id = 'b0700000-0000-4000-a000-000000000001';
UPDATE public.companies
   SET nome_fantasia = 'Demonstração · Agência (P&M)', razao_social = 'Demonstração Agência P&M LTDA'
 WHERE id = 'b0700000-0000-4000-a000-000000000002';
