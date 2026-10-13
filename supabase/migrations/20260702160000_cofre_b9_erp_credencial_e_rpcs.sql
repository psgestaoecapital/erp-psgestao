-- Cofre B.9 — genérico + APS · RD-41 Pilar 2.
-- Tabela SO de METADADOS (o valor mora cifrado no Vault).
-- Predicado admin: public.is_admin() (users.role IN ('adm','acesso_total')).
-- Coexiste com fn_banco_* (não muda nada do que está no ar).
-- Aplicada via MCP em 2026-07-02.

CREATE TABLE IF NOT EXISTS public.erp_credencial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  chave    text NOT NULL,
  escopo   text NOT NULL DEFAULT 'global' CHECK (escopo IN ('global','empresa')),
  company_id uuid,
  nome_secret_vault text NOT NULL,
  label text,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid, atualizado_em timestamptz,
  revelado_ultima_vez_por uuid, revelado_ultima_vez_em timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_credencial_ident
  ON public.erp_credencial
     (provider, chave, escopo,
      (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)));

ALTER TABLE public.erp_credencial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_credencial_admin_only ON public.erp_credencial;
CREATE POLICY erp_credencial_admin_only ON public.erp_credencial
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.fn_credencial_nome(
  p_provider text, p_chave text, p_escopo text, p_company_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_escopo = 'global'
      THEN upper(p_provider) || '_' || upper(p_chave)
    ELSE lower(p_provider) || '_' || lower(p_chave) || '_' || p_company_id::text
  END
$$;

CREATE OR REPLACE FUNCTION public.fn_credencial_salvar(
  p_provider text,
  p_chave text,
  p_valor text,
  p_escopo text DEFAULT 'global',
  p_company_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_nome_vault_override text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_nome text;
  v_sid uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'apenas_admin');
  END IF;

  IF p_provider IS NULL OR p_chave IS NULL OR p_valor IS NULL OR p_valor = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'campos_obrigatorios');
  END IF;
  IF p_escopo NOT IN ('global','empresa') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'escopo_invalido');
  END IF;
  IF p_escopo = 'empresa' AND p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'company_id_obrigatorio_para_empresa');
  END IF;

  v_nome := COALESCE(
    NULLIF(p_nome_vault_override, ''),
    public.fn_credencial_nome(p_provider, p_chave, p_escopo, p_company_id)
  );

  SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
  IF v_sid IS NULL THEN
    PERFORM vault.create_secret(p_valor, v_nome, 'cofre:' || p_provider);
  ELSE
    PERFORM vault.update_secret(v_sid, p_valor);
  END IF;

  INSERT INTO public.erp_credencial (
    provider, chave, escopo, company_id, nome_secret_vault, label,
    criado_por, atualizado_por, atualizado_em, ativo
  )
  VALUES (
    p_provider, p_chave, p_escopo, p_company_id, v_nome, p_label,
    auth.uid(), auth.uid(), now(), true
  )
  ON CONFLICT (provider, chave, escopo,
               (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET
    nome_secret_vault = EXCLUDED.nome_secret_vault,
    label = COALESCE(EXCLUDED.label, public.erp_credencial.label),
    atualizado_por = auth.uid(),
    atualizado_em = now(),
    ativo = true;

  RETURN jsonb_build_object(
    'sucesso', true,
    'provider', p_provider,
    'chave', p_chave,
    'nome_vault', v_nome
  );
END $$;

CREATE OR REPLACE FUNCTION public.fn_credencial_ler(
  p_provider text,
  p_chave text,
  p_escopo text DEFAULT 'global',
  p_company_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_nome text;
  v_val text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'acesso_negado';
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
END $$;

CREATE OR REPLACE FUNCTION public.fn_credencial_revelar(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_nome text;
  v_val text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas_admin';
  END IF;

  SELECT nome_secret_vault INTO v_nome
    FROM public.erp_credencial WHERE id = p_id AND ativo;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'credencial_nao_encontrada';
  END IF;

  SELECT decrypted_secret INTO v_val FROM vault.decrypted_secrets WHERE name = v_nome;

  UPDATE public.erp_credencial
     SET revelado_ultima_vez_por = auth.uid(),
         revelado_ultima_vez_em  = now()
   WHERE id = p_id;

  RETURN v_val;
END $$;

CREATE OR REPLACE FUNCTION public.fn_credencial_listar()
RETURNS TABLE(
  id uuid, provider text, chave text, escopo text, company_id uuid, label text,
  tem_valor boolean, atualizado_em timestamptz,
  revelado_ultima_vez_por uuid, revelado_ultima_vez_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas_admin';
  END IF;

  RETURN QUERY
    SELECT c.id, c.provider, c.chave, c.escopo, c.company_id, c.label,
           EXISTS(SELECT 1 FROM vault.secrets s WHERE s.name = c.nome_secret_vault) AS tem_valor,
           c.atualizado_em,
           c.revelado_ultima_vez_por, c.revelado_ultima_vez_em
      FROM public.erp_credencial c
     WHERE c.ativo
     ORDER BY c.provider, c.chave, c.escopo, c.company_id NULLS FIRST;
END $$;

CREATE OR REPLACE FUNCTION public.fn_credencial_inativar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas_admin';
  END IF;
  UPDATE public.erp_credencial SET ativo = false,
         atualizado_por = auth.uid(), atualizado_em = now()
    WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('sucesso', v_count > 0);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_credencial_nome(text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credencial_salvar(text, text, text, text, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credencial_ler(text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credencial_revelar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credencial_listar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credencial_inativar(uuid) TO authenticated, service_role;
