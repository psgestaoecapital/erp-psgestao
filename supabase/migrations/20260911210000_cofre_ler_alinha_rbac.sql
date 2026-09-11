-- ============================================================
-- Cofre — alinhar o caminho HUMANO de fn_credencial_ler ao RBAC do Cofre (V2)
-- ============================================================
-- Follow-up autorizado do #1387. fn_credencial_ler é o leitor programático de credenciais em claro.
-- Guard atual: auth.role() = 'service_role' OR is_admin(). Dois caminhos:
--   • service_role (workers/edge) — ÚNICO chamador real: supabase/functions/aps-ingest (aps/client_id,
--     aps/client_secret). ESTE CAMINHO NÃO MUDA.
--   • humano (is_admin legado) — ZERO chamador (mapa do #1387). Caminho não exercitado (RD-59).
-- Mudança cirúrgica (RD-60): só o caminho humano passa a exigir fn_cofre_pode_acessar() — a mesma régua
-- do Cofre (PS_ADMIN/PS_ADMIN_CVM, NÃO robô, ativo). is_admin() continua intacta e usada em outros pontos.
-- Nada mais do corpo muda (leitura do Vault verbatim).

CREATE OR REPLACE FUNCTION public.fn_credencial_ler(p_provider text, p_chave text, p_escopo text DEFAULT 'global'::text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_val text;
BEGIN
  -- service_role (workers/edge, ex.: aps-ingest) segue passando; o caminho HUMANO agora usa a régua do Cofre.
  IF auth.role() <> 'service_role' AND NOT public.fn_cofre_pode_acessar() THEN
    RAISE EXCEPTION 'sem_acesso_ao_cofre';
  END IF;

  SELECT nome_secret_vault INTO v_nome
    FROM public.erp_credencial
   WHERE provider = p_provider
     AND chave    = p_chave
     AND escopo   = p_escopo
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(p_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND ativo
   LIMIT 1;

  IF v_nome IS NULL THEN
    v_nome := public.fn_credencial_nome(p_provider, p_chave, p_escopo, p_company_id);
  END IF;

  SELECT decrypted_secret INTO v_val FROM vault.decrypted_secrets WHERE name = v_nome;
  RETURN v_val;
END $function$;
