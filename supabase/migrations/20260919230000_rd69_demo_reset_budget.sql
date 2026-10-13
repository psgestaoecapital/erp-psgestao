-- RD-69 Parte 1b — fn_demo_reset(company) + teto de custo do robô
--
-- Contexto (Eng. Chefe 19/09 · RD-69): empresas de DEMONSTRAÇÃO (companies.is_demo=true) são o
-- palco onde o robô e o CEO exercitam o ciclo completo sem tocar cliente real. Precisam de um botão
-- "recomeçar do zero" que reponha o seed determinístico da vertical — para que uma demo suja (dado
-- meio-editado numa sessão anterior) volte a um estado conhecido antes da próxima prova.
--
-- fn_demo_reset(p_company_id): SÓ age em empresa is_demo=true; despacha para o seed_reparar da
-- vertical daquela empresa. Em empresa real → recusa (jamais reescreve dado de cliente). Idempotente
-- (o próprio seed_reparar é idempotente). SECURITY DEFINER, mas trancada: só service_role chama.
--
-- Teto de custo (anthropic_budget_control): mês 20→50, dia 3→5 (RD-69: demo dá mais volume ao robô,
-- o teto precisa acompanhar sem virar surpresa de fatura). Aplicado no MERGE pelo deploy-migrations
-- (RD-52), não à mão.

-- ── fn_demo_reset ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_demo boolean;
  v_nome    text;
  v_seed    text;
  v_res     jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo');
  END IF;

  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text)
    INTO v_is_demo, v_nome
    FROM public.companies c
   WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente');
  END IF;

  -- Trava dura: reset só existe para demo. Empresa real jamais é reescrita por aqui.
  IF v_is_demo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome);
  END IF;

  -- Despacho por vertical: cada demo conhecida tem seu seed determinístico.
  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'  -- Oficina
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'       -- Agência/PM
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'  -- Revenda
    ELSE NULL
  END;

  IF v_seed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome);
  END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END;
$$;

COMMENT ON FUNCTION public.fn_demo_reset(uuid) IS
  'RD-69: repõe o seed determinístico de uma empresa is_demo. Recusa empresa real. service_role only.';

-- Nasce trancada (RD guarda): nada de anon/authenticated; só o backend (service_role) reseta demo.
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO service_role;

-- ── Teto de custo do robô (RD-69) ────────────────────────────────────────────────────────────────
-- Aplicado no merge pelo deploy-migrations. NÃO aplicar à mão via execute_sql — é limite de gasto,
-- entra por revisão de PR como qualquer outra mudança.
UPDATE public.anthropic_budget_control
   SET limite_max_custo_usd_mes = 50,
       limite_max_custo_usd_dia = 5,
       atualizado_em            = now()
 WHERE id = 1;
