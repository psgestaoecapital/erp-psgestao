-- Onboarding Fase A · fn_admin_criar_empresa — cria empresa + assinaturas numa transação.
--
-- Generaliza o padrão de fn_bpo_admin_onboarding_cliente (que é específico de BPO) para servir
-- qualquer vertical (Comércio, Oficina, Indústria, BPO). Chamada pelo wizard "Incluir nova empresa"
-- em /dashboard/admin/acessos. Os convites (master + equipe) são feitos DEPOIS pelo front via
-- fn_acessos_convidar_pessoa (RD-26) — esta RPC só cuida da company + planos.
--
-- Premissas auditadas (premissa-primeiro, RD-38):
--  • companies exige apenas org_id + razao_social (resto nullable); tem todos os campos do SPEC
--    (inscricao_estadual/municipal, cidade_estado, endereco, cnae, regime_tributario, group_id, is_matriz).
--  • O onboarding dispara pelo trigger trg_psgc_empresa_nova no INSERT de companies (nome real;
--    o SPEC citou 'trg_psgc_onboarding_nova_empresa'). Insert + trigger validados em BEGIN/ROLLBACK.
--  • plan_catalog.id e tenant_subscriptions.plan_id são TEXT; assinatura mínima = company_id + plan_id.
--  • Pilar 2 / RD-25: só admin PS cria empresa → guard is_admin(). RD-54: CNPJ-dup check antes de criar.

CREATE OR REPLACE FUNCTION public.fn_admin_criar_empresa(
  p_razao_social text,
  p_nome_fantasia text DEFAULT NULL,
  p_cnpj text DEFAULT NULL,
  p_inscricao_estadual text DEFAULT NULL,
  p_inscricao_municipal text DEFAULT NULL,
  p_cidade_estado text DEFAULT NULL,
  p_endereco text DEFAULT NULL,
  p_cnae text DEFAULT NULL,
  p_regime_tributario text DEFAULT NULL,
  p_plan_ids text[] DEFAULT '{}'::text[],
  p_group_id uuid DEFAULT NULL,
  p_is_matriz boolean DEFAULT true,
  p_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_cnpj text;
  v_existente uuid;
  v_company uuid;
  v_plan text;
  v_subs int := 0;
  v_uid uuid := auth.uid();
BEGIN
  -- Pilar 2 / RD-25: criação de empresa é do admin PS.
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  IF COALESCE(btrim(p_razao_social), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'razao_social_obrigatoria');
  END IF;

  v_cnpj := regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g');
  IF length(v_cnpj) <> 14 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cnpj_invalido');
  END IF;

  -- RD-54 · não duplicar: se já existe empresa ATIVA com esse CNPJ, devolve a existente.
  SELECT id INTO v_existente FROM companies
   WHERE regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = v_cnpj
     AND is_active = true
   LIMIT 1;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cnpj_ja_existe', 'company_id', v_existente);
  END IF;

  v_org := COALESCE(p_org_id, (SELECT id FROM organizations LIMIT 1));
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'org_inexistente');
  END IF;

  -- 1) Cria a company (o INSERT dispara trg_psgc_empresa_nova = onboarding).
  INSERT INTO companies (
    org_id, razao_social, nome_fantasia, cnpj,
    inscricao_estadual, inscricao_municipal, cidade_estado, endereco, cnae,
    regime_tributario, group_id, is_matriz, is_active
  ) VALUES (
    v_org, btrim(p_razao_social), NULLIF(btrim(COALESCE(p_nome_fantasia, '')), ''), v_cnpj,
    p_inscricao_estadual, p_inscricao_municipal, p_cidade_estado, p_endereco, p_cnae,
    p_regime_tributario, p_group_id, COALESCE(p_is_matriz, true), true
  ) RETURNING id INTO v_company;

  -- 2) Uma assinatura ATIVA por plano escolhido (só planos válidos e ativos; distinct anti-dupla).
  FOR v_plan IN SELECT DISTINCT unnest(COALESCE(p_plan_ids, '{}'::text[])) LOOP
    IF v_plan IS NOT NULL AND EXISTS (SELECT 1 FROM plan_catalog WHERE id = v_plan AND ativo = true) THEN
      IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = v_company AND plan_id = v_plan) THEN
        INSERT INTO tenant_subscriptions (company_id, plan_id, status, created_by, created_at, updated_at)
        VALUES (v_company, v_plan, 'active', v_uid, now(), now());
        v_subs := v_subs + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'company_id', v_company, 'assinaturas', v_subs, 'org_id', v_org);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_admin_criar_empresa(text, text, text, text, text, text, text, text, text, text[], uuid, boolean, uuid) FROM anon;
