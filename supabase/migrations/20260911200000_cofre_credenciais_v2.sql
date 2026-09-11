-- ============================================================
-- Cofre de Credenciais V2 — RD-41 · Pilar 2 (Segurança + LGPD) · Saneamento F3
-- ============================================================
-- SPEC "Cofre de Credenciais V2" (CEO Gilberto, 11/09/2026). O Cofre passa a guardar também
-- LOGIN/SENHA dos sistemas que a PS contratou pra operar o ERP (Resend, Registro.br, Vercel, ...),
-- com RBAC correto (system_role, não o legado users.role), trilha completa de revelação e — o ponto
-- inegociável de Pilar 2 — CONTAS DE ROBÔ BLOQUEADAS (o Playwright/Gold é PS_ADMIN e fotografa telas
-- pra um bucket PÚBLICO; não pode abrir o Cofre).
--
-- Auditoria RD-26/RD-44 (lida do banco 11/09/2026) e correções de premissa:
--   • erp_credencial tem 29 linhas (não 27) → prova esperada: tipo tecnica=29, sistema=0.
--   • O índice único do upsert EXISTE (ux_erp_credencial_ident) → o ON CONFLICT da salvar funciona.
--   • fn_credencial_revelar NÃO muda assinatura de retorno (RETURNS text) → CREATE OR REPLACE basta;
--     só fn_credencial_listar muda colunas → DROP + CREATE.
--   • Existe uma 5ª função, fn_credencial_ler(provider,chave) (leitor programático, guard
--     is_admin() OR service_role). NÃO está na tela do Cofre → não afeta a ameaça do robô-screenshot.
--     Mantida INTACTA aqui (RD-60 cirúrgico); alinhamento do caminho humano dela fica p/ decisão do CEO.
--
-- RD-60: NÃO alteramos is_admin() (usada em outros pontos). Só trocamos as CHAMADAS dentro das 4 RPCs
-- do Cofre e na policy da tabela. RD-30: a trilha nunca é apagada. RD-55/RD-61: tudo aditivo, com
-- DEFAULT que preserva as 29 linhas existentes como 'tecnica'.

-- ------------------------------------------------------------
-- (3.1) Marca de conta de robô (aditivo, sem UUID hardcoded)
-- ------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_robo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_robo IS
  'Conta de automação (Playwright, Gold, workers). Nunca acessa o Cofre de Credenciais.';

UPDATE public.users SET is_robo = true WHERE email = 'screenshot@psgestao.com';

-- ------------------------------------------------------------
-- (3.2) Helper de acesso ao Cofre — system_role PS + NÃO robô + ATIVO
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cofre_pode_acessar()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = auth.uid()
       AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')
       AND COALESCE(u.is_robo, false) = false
       AND COALESCE(u.is_active, true) = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_cofre_pode_acessar() TO authenticated, service_role;

-- ------------------------------------------------------------
-- (3.3) Trilha completa de revelação (nunca apagada — RD-30)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_credencial_revelacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credencial_id   uuid NOT NULL REFERENCES public.erp_credencial(id) ON DELETE CASCADE,
  revelado_por    uuid NOT NULL,
  revelado_em     timestamptz NOT NULL DEFAULT now(),
  provider        text,
  chave           text
);
CREATE INDEX IF NOT EXISTS idx_cred_revelacao_cred ON public.erp_credencial_revelacao (credencial_id, revelado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cred_revelacao_quem ON public.erp_credencial_revelacao (revelado_por, revelado_em DESC);

ALTER TABLE public.erp_credencial_revelacao ENABLE ROW LEVEL SECURITY;
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_credencial_revelacao'::regclass AND polname='erp_credencial_revelacao_cofre') THEN
    CREATE POLICY erp_credencial_revelacao_cofre ON public.erp_credencial_revelacao
      FOR ALL TO public USING (public.fn_cofre_pode_acessar());
  END IF;
END $rls$;

-- ------------------------------------------------------------
-- (3.4) Campos do sistema contratado (aditivo — RD-61 blinda com DEFAULT)
-- ------------------------------------------------------------
ALTER TABLE public.erp_credencial
  ADD COLUMN IF NOT EXISTS url_login   text,
  ADD COLUMN IF NOT EXISTS observacao  text,
  ADD COLUMN IF NOT EXISTS tipo        text NOT NULL DEFAULT 'tecnica';

ALTER TABLE public.erp_credencial DROP CONSTRAINT IF EXISTS erp_credencial_tipo_check;
ALTER TABLE public.erp_credencial
  ADD CONSTRAINT erp_credencial_tipo_check CHECK (tipo IN ('tecnica','sistema'));

COMMENT ON COLUMN public.erp_credencial.tipo IS
  'V2: tecnica = token/cert/secret (padrão, as 29 existentes); sistema = login/senha de sistema contratado.';

-- ------------------------------------------------------------
-- (3.5 / 3.6) Troca do guard: is_admin() → fn_cofre_pode_acessar() SÓ nas RPCs do Cofre e na policy.
--             is_admin() PERMANECE INTACTA (RD-60). fn_credencial_ler NÃO é tocada.
-- ------------------------------------------------------------

-- inativar: mesma assinatura; só o guard.
CREATE OR REPLACE FUNCTION public.fn_credencial_inativar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RAISE EXCEPTION 'sem_acesso_ao_cofre';
  END IF;
  UPDATE public.erp_credencial SET ativo = false,
         atualizado_por = auth.uid(), atualizado_em = now()
    WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('sucesso', v_count > 0);
END $function$;

-- salvar: corpo verbatim (RD-60), só o guard troca (retorna sem_acesso_ao_cofre).
CREATE OR REPLACE FUNCTION public.fn_credencial_salvar(p_provider text, p_chave text, p_valor text, p_escopo text DEFAULT 'global'::text, p_company_id uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_nome_vault_override text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_sid uuid;
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso_ao_cofre');
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
END $function$;

-- revelar: mesma assinatura (RETURNS text); guard troca + GRAVA A TRILHA (mantém revelado_ultima_vez_*).
CREATE OR REPLACE FUNCTION public.fn_credencial_revelar(p_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_val text;
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RAISE EXCEPTION 'sem_acesso_ao_cofre';
  END IF;

  SELECT nome_secret_vault INTO v_nome
    FROM public.erp_credencial WHERE id = p_id AND ativo;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'credencial_nao_encontrada';
  END IF;

  SELECT decrypted_secret INTO v_val FROM vault.decrypted_secrets WHERE name = v_nome;

  -- trilha completa (nunca apagada) — quem revelou, quando, o quê
  INSERT INTO public.erp_credencial_revelacao (credencial_id, revelado_por, provider, chave)
  SELECT p_id, auth.uid(), c.provider, c.chave FROM public.erp_credencial c WHERE c.id = p_id;

  -- resumo (compat: a tela lê isto para "última revelação")
  UPDATE public.erp_credencial
     SET revelado_ultima_vez_por = auth.uid(),
         revelado_ultima_vez_em  = now()
   WHERE id = p_id;

  RETURN v_val;
END $function$;

-- listar: MUDA colunas de retorno (tipo, url_login, observacao, revelacoes_total) → DROP + CREATE.
DROP FUNCTION IF EXISTS public.fn_credencial_listar();
CREATE FUNCTION public.fn_credencial_listar()
 RETURNS TABLE(id uuid, provider text, chave text, escopo text, company_id uuid, label text,
               tipo text, url_login text, observacao text,
               tem_valor boolean, revelacoes_total bigint,
               atualizado_em timestamp with time zone,
               revelado_ultima_vez_por uuid, revelado_ultima_vez_em timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RAISE EXCEPTION 'sem_acesso_ao_cofre';
  END IF;

  RETURN QUERY
    SELECT c.id, c.provider, c.chave, c.escopo, c.company_id, c.label,
           c.tipo, c.url_login, c.observacao,
           EXISTS(SELECT 1 FROM vault.secrets s WHERE s.name = c.nome_secret_vault) AS tem_valor,
           (SELECT count(*) FROM public.erp_credencial_revelacao r WHERE r.credencial_id = c.id) AS revelacoes_total,
           c.atualizado_em,
           c.revelado_ultima_vez_por, c.revelado_ultima_vez_em
      FROM public.erp_credencial c
     WHERE c.ativo
     ORDER BY c.provider, c.chave, c.escopo, c.company_id NULLS FIRST;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_credencial_listar() TO anon, authenticated, service_role;

-- policy da tabela: troca is_admin() → fn_cofre_pode_acessar()
DROP POLICY IF EXISTS erp_credencial_admin_only ON public.erp_credencial;
DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_credencial'::regclass AND polname='erp_credencial_cofre') THEN
    CREATE POLICY erp_credencial_cofre ON public.erp_credencial
      FOR ALL TO public USING (public.fn_cofre_pode_acessar());
  END IF;
END $pol$;

-- ------------------------------------------------------------
-- (3.7) RPC nova — salvar um sistema inteiro (login + senha + url + observação)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_credencial_salvar_sistema(
  p_sistema    text,
  p_usuario    text,
  p_senha      text,
  p_url_login  text DEFAULT NULL,
  p_observacao text DEFAULT NULL,
  p_label      text DEFAULT NULL,
  p_escopo     text DEFAULT 'global',
  p_company_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','vault','pg_temp'
AS $$
DECLARE r1 jsonb; r2 jsonb; v_sistema text;
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso_ao_cofre');
  END IF;
  v_sistema := lower(btrim(p_sistema));
  IF v_sistema IS NULL OR v_sistema = '' OR p_usuario IS NULL OR p_usuario = ''
     OR p_senha IS NULL OR p_senha = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sistema_usuario_e_senha_obrigatorios');
  END IF;

  r1 := public.fn_credencial_salvar(v_sistema, 'usuario', p_usuario, p_escopo, p_company_id, p_label);
  r2 := public.fn_credencial_salvar(v_sistema, 'senha',   p_senha,   p_escopo, p_company_id, p_label);

  UPDATE public.erp_credencial
     SET tipo = 'sistema', url_login = p_url_login, observacao = p_observacao
   WHERE provider = v_sistema AND chave IN ('usuario','senha') AND escopo = p_escopo
     AND COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_company_id,'00000000-0000-0000-0000-000000000000'::uuid);

  RETURN jsonb_build_object('sucesso', (r1->>'sucesso')::boolean AND (r2->>'sucesso')::boolean,
                            'sistema', v_sistema, 'usuario', r1, 'senha', r2);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_credencial_salvar_sistema(text,text,text,text,text,text,text,uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- (apoio à §4.4) Histórico completo de revelações de uma credencial, com quem revelou (e-mail)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_credencial_revelacoes(p_id uuid)
RETURNS TABLE(revelado_em timestamptz, revelado_por uuid, revelador_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NOT public.fn_cofre_pode_acessar() THEN
    RAISE EXCEPTION 'sem_acesso_ao_cofre';
  END IF;
  RETURN QUERY
    SELECT r.revelado_em, r.revelado_por, u.email
      FROM public.erp_credencial_revelacao r
      LEFT JOIN public.users u ON u.id = r.revelado_por
     WHERE r.credencial_id = p_id
     ORDER BY r.revelado_em DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_credencial_revelacoes(uuid) TO authenticated, service_role;
