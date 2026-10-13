-- Acessos: equipe PS vinculada a todas as empresas (exceto Wealth/BOT) + criador vinculado.
-- Contexto 9a38849b (decisão CEO). Origem: tela preta do Rodrigo na VIANZ (empresa com 0 membros).
-- RDs 25·26·38·65·34-V5. Idempotente. NÃO roda o sincronizar geral aqui — isso é feito UMA vez
-- após o merge (a trigger cobre empresas NOVAS; as existentes entram no sync manual pós-merge).
-- Wealth identificado por tenant_subscriptions.plan_id = 'v15_wealth'. [BOT] pelo nome.

-- a) tabela da equipe PS ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ps_equipe_acesso (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  papel      text NOT NULL DEFAULT 'acesso_total',
  ativo      boolean NOT NULL DEFAULT true,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public.ps_equipe_acesso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ps_equipe_acesso_sel ON public.ps_equipe_acesso;
CREATE POLICY ps_equipe_acesso_sel ON public.ps_equipe_acesso FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));
-- escrita só via RPC (SECURITY DEFINER) — sem policy de INSERT/UPDATE/DELETE (RLS nega por padrão).
GRANT SELECT ON public.ps_equipe_acesso TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.ps_equipe_acesso FROM anon, authenticated;

-- seed dos 4 membros atuais (SPEC 9a38849b): Gilberto, Jordana, Rodrigo, André.
INSERT INTO public.ps_equipe_acesso (user_id, papel, ativo, observacao) VALUES
 ('4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb','acesso_total',true,'Gilberto (seed SPEC 9a38849b)'),
 ('43ef8386-3262-4e56-b31a-6f0e41d1e21c','acesso_total',true,'Jordana (seed SPEC 9a38849b)'),
 ('33464170-036f-4d3b-bc48-f2dc3dfde660','acesso_total',true,'Rodrigo (seed SPEC 9a38849b)'),
 ('f3867e65-94d6-43c0-aeb9-8da82fcfe433','acesso_total',true,'André (seed SPEC 9a38849b)')
ON CONFLICT (user_id) DO NOTHING;

-- b) origem em user_companies ----------------------------------------------------------------------
ALTER TABLE public.user_companies ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';
ALTER TABLE public.user_companies DROP CONSTRAINT IF EXISTS user_companies_origem_check;
ALTER TABLE public.user_companies ADD CONSTRAINT user_companies_origem_check
  CHECK (origem IN ('manual','equipe_ps','criador'));

-- helper: empresa fora da regra automática (Wealth v15_wealth OU [BOT]) -----------------------------
CREATE OR REPLACE FUNCTION public.fn_empresa_fora_regra_ps(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM tenant_subscriptions ts WHERE ts.company_id = p_company_id AND ts.plan_id = 'v15_wealth')
      OR EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company_id AND coalesce(c.nome_fantasia, c.razao_social) ILIKE '%[BOT]%');
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_empresa_fora_regra_ps(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_empresa_fora_regra_ps(uuid) TO authenticated, service_role;

-- c) sincronizar (interno; só service_role/dono chamam) --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_equipe_ps_sincronizar(p_company_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ins int := 0; v_rem int := 0; v_ig_w int := 0; v_ig_b int := 0;
BEGIN
  -- INSERT dos vínculos faltantes de membros ATIVOS × empresas alvo (exceto wealth/bot).
  -- Nunca altera vínculo existente (não rebaixa papel, não troca origem).
  WITH alvo AS (
    SELECT c.id FROM companies c
    WHERE (p_company_id IS NULL OR c.id = p_company_id) AND NOT fn_empresa_fora_regra_ps(c.id)
  ), ins AS (
    INSERT INTO user_companies (user_id, company_id, role, origem)
    SELECT m.user_id, a.id, m.papel, 'equipe_ps'
    FROM ps_equipe_acesso m CROSS JOIN alvo a
    WHERE m.ativo
      AND NOT EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = m.user_id AND uc.company_id = a.id)
    RETURNING 1
  ) SELECT count(*) INTO v_ins FROM ins;

  -- DELETE apenas dos vínculos 'equipe_ps' de membros INATIVOS (mantém 'manual'/'criador').
  WITH del AS (
    DELETE FROM user_companies uc USING ps_equipe_acesso m
    WHERE uc.user_id = m.user_id AND m.ativo = false AND uc.origem = 'equipe_ps'
      AND (p_company_id IS NULL OR uc.company_id = p_company_id)
    RETURNING 1
  ) SELECT count(*) INTO v_rem FROM del;

  SELECT count(*) INTO v_ig_w FROM companies c
   WHERE (p_company_id IS NULL OR c.id = p_company_id)
     AND EXISTS (SELECT 1 FROM tenant_subscriptions ts WHERE ts.company_id = c.id AND ts.plan_id = 'v15_wealth');
  SELECT count(*) INTO v_ig_b FROM companies c
   WHERE (p_company_id IS NULL OR c.id = p_company_id)
     AND coalesce(c.nome_fantasia, c.razao_social) ILIKE '%[BOT]%';

  RETURN jsonb_build_object('inseridos', v_ins, 'removidos', v_rem, 'ignorados_wealth', v_ig_w, 'ignorados_bot', v_ig_b);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.fn_equipe_ps_sincronizar(uuid) FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.fn_equipe_ps_sincronizar(uuid) TO service_role;

-- d) trigger AFTER INSERT em companies: liga o criador (e) + sincroniza a equipe PS ---------------
CREATE OR REPLACE FUNCTION public.fn_companies_ai_equipe_ps()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- (e) criador: quem cria a empresa fica vinculado na hora (inclusive Wealth/BOT — é dono dela),
  -- se autenticado e ainda não for membro. Cobre fn_admin_criar_empresa e qualquer outra via de criação.
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = NEW.id) THEN
    INSERT INTO user_companies (user_id, company_id, role, origem) VALUES (v_uid, NEW.id, 'acesso_total', 'criador');
  END IF;
  -- equipe PS entra automaticamente (a função pula Wealth/BOT).
  PERFORM public.fn_equipe_ps_sincronizar(NEW.id);
  RETURN NEW;
END; $function$;
DROP TRIGGER IF EXISTS trg_companies_ai_equipe_ps ON public.companies;
CREATE TRIGGER trg_companies_ai_equipe_ps AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_ai_equipe_ps();

-- f) RPCs de gestão (só PS_ADMIN; audit_log; chamam o sincronizar) ---------------------------------
CREATE OR REPLACE FUNCTION public.fn_equipe_ps_adicionar(p_user_id uuid, p_papel text DEFAULT 'acesso_total')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sync jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Apenas PS_ADMIN pode gerir a equipe PS' USING errcode='42501'; END IF;
  INSERT INTO ps_equipe_acesso (user_id, papel, ativo, created_by)
  VALUES (p_user_id, COALESCE(NULLIF(btrim(p_papel),''),'acesso_total'), true, auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET ativo = true, papel = EXCLUDED.papel;
  v_sync := public.fn_equipe_ps_sincronizar(NULL);
  INSERT INTO audit_log (user_id, action, detail, module)
  VALUES (auth.uid(), 'equipe_ps_adicionar', format('user=%s papel=%s sync=%s', p_user_id, p_papel, v_sync), 'acessos');
  RETURN jsonb_build_object('ok', true, 'sync', v_sync);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.fn_equipe_ps_adicionar(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_equipe_ps_adicionar(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_equipe_ps_remover(p_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sync jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Apenas PS_ADMIN pode gerir a equipe PS' USING errcode='42501'; END IF;
  UPDATE ps_equipe_acesso SET ativo = false WHERE user_id = p_user_id;
  v_sync := public.fn_equipe_ps_sincronizar(NULL);
  INSERT INTO audit_log (user_id, action, detail, module)
  VALUES (auth.uid(), 'equipe_ps_remover', format('user=%s desativado sync=%s', p_user_id, v_sync), 'acessos');
  RETURN jsonb_build_object('ok', true, 'sync', v_sync);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.fn_equipe_ps_remover(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_equipe_ps_remover(uuid) TO authenticated, service_role;

-- leitura da lista para a tela (só PS_ADMIN via RLS) — SELECT direto em ps_equipe_acesso já basta.
