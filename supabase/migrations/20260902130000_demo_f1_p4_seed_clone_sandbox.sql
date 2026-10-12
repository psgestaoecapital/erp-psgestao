-- DEMO-F1 parte 3 · §4 — Seed versionado (clone) + Oficina Sandbox + comando de reset.
--
-- O seed da Mecanica Modelo (demo, ded...001) nunca foi versionado no repo. Em vez de reescrever à mão
-- 78 linhas em ~10 tabelas (onde moram as 6 correções: org_id NOT NULL, e-mail, roles CLIENT_*, status
-- de erp_receber, palavra reservada 'desc', coluna v.doc), esta migration versiona um CLONE fiel do
-- tenant demo — que JÁ está corrigido em produção. Clonar dado válido satisfaz as 6 correções POR
-- CONSTRUÇÃO, e via jsonb nunca se escreve à mão os nomes que quebravam (RD-26/RD-38).
--
-- Auditado: as tabelas de seed só têm FK para companies (não entre si); as refs externas da demo
-- (conta_bancaria_id, fornecedor_id, movimento_banco_id, tecnico_id…) são TODAS nulas; o único vínculo
-- intra-tenant é cliente_id (os, receber) — remapeado no clone. Validado por ROLLBACK: sandbox com
-- cli=12/os=14/rec=14, acesso do CEO=1, e ZERO OS apontando p/ cliente de outro tenant.

-- ── clone genérico de um tenant (origem → destino), com remap de cliente_id e ids novos ──
CREATE OR REPLACE FUNCTION public.fn_demo_clonar_tenant(
  p_origem uuid, p_destino uuid, p_ambiente text, p_cnpj text, p_razao text, p_fantasia text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_map jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_origem) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tenant_origem_inexistente'); END IF;

  -- companies do destino: copia a origem, sobrescreve identidade + ambiente (org_id herdado → correção 1)
  INSERT INTO companies SELECT (jsonb_populate_record(NULL::companies, to_jsonb(c)
     || jsonb_build_object('id', p_destino, 'cnpj', p_cnpj, 'ambiente_tenant', p_ambiente,
                           'razao_social', p_razao, 'nome_fantasia', p_fantasia))).*
  FROM companies c WHERE c.id = p_origem
  ON CONFLICT (id) DO UPDATE
     SET ambiente_tenant = EXCLUDED.ambiente_tenant, razao_social = EXCLUDED.razao_social,
         nome_fantasia = EXCLUDED.nome_fantasia;

  -- wipe do destino (idempotente / reset). psgc_onboarding_status fica por conta do trigger de company.
  -- Libera o hard-delete SÓ nesta transação (o guard fn_bloqueia_delete_fisico protege documento
  -- financeiro real; aqui é manutenção deliberada de tenant demo/sandbox descartável — o HINT do guard).
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM erp_receber WHERE company_id = p_destino;
  DELETE FROM erp_pagar   WHERE company_id = p_destino;
  DELETE FROM erp_os      WHERE company_id = p_destino;
  DELETE FROM erp_oficina_servicos WHERE company_id = p_destino;
  DELETE FROM erp_produtos WHERE company_id = p_destino;
  DELETE FROM erp_clientes WHERE company_id = p_destino;
  DELETE FROM tenant_user_roles WHERE company_id = p_destino;
  DELETE FROM user_companies    WHERE company_id = p_destino;

  -- mapa cliente antigo→novo (único vínculo intra-tenant a remapear)
  SELECT jsonb_object_agg(id::text, gen_random_uuid()::text) INTO v_map
    FROM erp_clientes WHERE company_id = p_origem;
  v_map := COALESCE(v_map, '{}'::jsonb);

  INSERT INTO erp_clientes SELECT (jsonb_populate_record(NULL::erp_clientes, to_jsonb(t)
     || jsonb_build_object('id', v_map->>(t.id::text), 'company_id', p_destino))).*
  FROM erp_clientes t WHERE t.company_id = p_origem;

  INSERT INTO erp_produtos SELECT (jsonb_populate_record(NULL::erp_produtos, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino))).*
  FROM erp_produtos t WHERE t.company_id = p_origem;

  INSERT INTO erp_oficina_servicos SELECT (jsonb_populate_record(NULL::erp_oficina_servicos, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino))).*
  FROM erp_oficina_servicos t WHERE t.company_id = p_origem;

  INSERT INTO erp_os SELECT (jsonb_populate_record(NULL::erp_os, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino, 'cliente_id', v_map->>(t.cliente_id::text)))).*
  FROM erp_os t WHERE t.company_id = p_origem;

  INSERT INTO erp_receber SELECT (jsonb_populate_record(NULL::erp_receber, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino, 'cliente_id', v_map->>(t.cliente_id::text)))).*
  FROM erp_receber t WHERE t.company_id = p_origem;

  INSERT INTO erp_pagar SELECT (jsonb_populate_record(NULL::erp_pagar, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino))).*
  FROM erp_pagar t WHERE t.company_id = p_origem;

  -- acesso: liga os mesmos usuários da origem (o CEO) ao destino, para abrir o tenant
  INSERT INTO user_companies SELECT (jsonb_populate_record(NULL::user_companies, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino))).*
  FROM user_companies t WHERE t.company_id = p_origem;

  INSERT INTO tenant_user_roles SELECT (jsonb_populate_record(NULL::tenant_user_roles, to_jsonb(t)
     || jsonb_build_object('id', gen_random_uuid(), 'company_id', p_destino))).*
  FROM tenant_user_roles t WHERE t.company_id = p_origem;

  RETURN jsonb_build_object('ok', true, 'destino', p_destino, 'ambiente', p_ambiente,
    'clientes', (SELECT count(*) FROM erp_clientes WHERE company_id = p_destino),
    'os', (SELECT count(*) FROM erp_os WHERE company_id = p_destino),
    'receber', (SELECT count(*) FROM erp_receber WHERE company_id = p_destino));
END $fn$;

REVOKE ALL ON FUNCTION public.fn_demo_clonar_tenant(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_demo_clonar_tenant(uuid, uuid, text, text, text, text) TO service_role;

-- ── comando de reset: apaga e re-semeia SÓ o sandbox (a partir da demo), guardado por admin ──
CREATE OR REPLACE FUNCTION public.fn_demo_reset_sandbox()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'somente_admin'); END IF;
  RETURN public.fn_demo_clonar_tenant(
    'ded00000-0000-4000-a000-000000000001'::uuid,   -- demo (origem)
    'ded00000-0000-4000-a000-000000000002'::uuid,   -- sandbox (destino)
    'sandbox', '00000000000272', 'MECANICA MODELO SANDBOX LTDA', 'Oficina Sandbox');
END $fn$;

REVOKE ALL ON FUNCTION public.fn_demo_reset_sandbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset_sandbox() TO authenticated, service_role;

-- ── cria a Oficina Sandbox agora (ded...002, ambiente sandbox, CNPJ livre) a partir da demo ──
DO $mig$
DECLARE v jsonb;
BEGIN
  v := public.fn_demo_clonar_tenant(
    'ded00000-0000-4000-a000-000000000001'::uuid,
    'ded00000-0000-4000-a000-000000000002'::uuid,
    'sandbox', '00000000000272', 'MECANICA MODELO SANDBOX LTDA', 'Oficina Sandbox');
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION '[DEMO-F1 p4] falha ao criar sandbox: %', v; END IF;
  RAISE NOTICE '[DEMO-F1 p4] Oficina Sandbox criada: %', v;
END $mig$;
