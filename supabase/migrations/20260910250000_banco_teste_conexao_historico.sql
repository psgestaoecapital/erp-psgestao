-- ============================================================
-- Conexões Bancárias · TESTE DE CONEXÃO — histórico (chamado #14, Rodrigo · pedido do CEO)
-- ============================================================
-- Hoje a pessoa configura certificado/agência/conta/convênio, salva, e NÃO sabe se funciona — descobre
-- quando uma remessa REAL falha, com boleto de cliente dentro. Este é o ledger append-only do botão
-- "Testar conexão": guarda QUANDO, QUEM testou e o RESULTADO, pra saber "quando funcionou pela última vez".
-- O teste em si (rota /api/banco/testar-conexao) é READ-ONLY: valida o certificado (existe, senha confere,
-- não venceu) e faz a autenticação real no banco (OAuth/mTLS) — NUNCA emite boleto nem envia remessa.
-- GENÉRICO: serve pra Sicoob, Sicredi, Bradesco e qualquer banco que entrar (não é só Bradesco).

CREATE TABLE IF NOT EXISTS public.erp_banco_teste_conexao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  provider           text NOT NULL,
  banco_codigo       text,
  ambiente           text,
  provider_config_id uuid,
  status             text NOT NULL CHECK (status IN ('ok','erro','parcial')),
  cert_status        text,          -- ok | ausente | senha_invalida | vencido | expirando | nao_aplicavel | erro
  cert_expira_em     date,
  auth_ok            boolean,
  erro               text,
  detalhe            jsonb,
  latencia_ms        integer,
  testado_por        uuid,
  testado_por_email  text,
  testado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_banco_teste_conexao_cfg
  ON public.erp_banco_teste_conexao (provider_config_id, testado_em DESC);
CREATE INDEX IF NOT EXISTS ix_banco_teste_conexao_company
  ON public.erp_banco_teste_conexao (company_id, provider, testado_em DESC);

ALTER TABLE public.erp_banco_teste_conexao ENABLE ROW LEVEL SECURITY;

-- Mesma régua multi-tenant das outras tabelas erp_banco_* (espelha erp_banco_provider_config).
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_banco_teste_conexao'::regclass AND polname='p_banco_teste_conexao_sel') THEN
    CREATE POLICY p_banco_teste_conexao_sel ON public.erp_banco_teste_conexao
      FOR SELECT USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_banco_teste_conexao'::regclass AND polname='p_banco_teste_conexao_adm') THEN
    CREATE POLICY p_banco_teste_conexao_adm ON public.erp_banco_teste_conexao
      FOR ALL USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $rls$;

COMMENT ON TABLE public.erp_banco_teste_conexao IS
  'Histórico append-only dos testes de conexão bancária (auth + validação de certificado, READ-ONLY). Quem/quando/resultado — pra saber quando a conexão funcionou pela última vez.';

-- Registrador (SECURITY DEFINER): a rota /api/banco/testar-conexao roda como service role e chama esta fn
-- passando o usuário autenticado (p_testado_por). Ponto único de escrita do ledger.
CREATE OR REPLACE FUNCTION public.fn_banco_teste_conexao_registrar(
  p_company_id uuid, p_provider text, p_banco_codigo text, p_ambiente text,
  p_provider_config_id uuid, p_status text, p_cert_status text, p_cert_expira_em date,
  p_auth_ok boolean, p_erro text, p_detalhe jsonb, p_latencia_ms integer,
  p_testado_por uuid, p_testado_por_email text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.erp_banco_teste_conexao (
    company_id, provider, banco_codigo, ambiente, provider_config_id, status,
    cert_status, cert_expira_em, auth_ok, erro, detalhe, latencia_ms, testado_por, testado_por_email
  ) VALUES (
    p_company_id, p_provider, p_banco_codigo, p_ambiente, p_provider_config_id, p_status,
    p_cert_status, p_cert_expira_em, p_auth_ok, p_erro, p_detalhe, p_latencia_ms, p_testado_por, p_testado_por_email
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_banco_teste_conexao_registrar(uuid,text,text,text,uuid,text,text,date,boolean,text,jsonb,integer,uuid,text)
  TO authenticated, service_role;
