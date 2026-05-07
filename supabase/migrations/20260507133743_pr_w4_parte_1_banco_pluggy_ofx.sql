-- supabase/migrations/20260507133743_pr_w4_parte_1_banco_pluggy_ofx.sql
-- PR-W4 BLOCO 2 (PARTE 1) — Banco Pluggy + OFX
--
-- Cria 6 tabelas para integracao com Pluggy (Open Finance Brasil) e
-- upload OFX, com termo de consentimento LGPD versionado e RLS multi-camada
-- (admin / operador / service role). Insere termo Pluggy v1.0.
--
-- Pre-requisito: PR-W4 PARTE 0 aplicada (cria fn_wealth_user_eh_operador
-- e fn_wealth_consultores_updated_at). Pre-flight DO block aborta caso
-- contrario.
--
-- Autorizacao: CEO Gilberto Paravizi (Estrela Polar Secao 4 V1.2).

BEGIN;

-- ============================================================
-- 1.0 Pre-flight (audit embutido pois MCP Supabase indisponivel)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_wealth_user_pode_ver_tudo'
  ) THEN
    RAISE EXCEPTION 'Pre-flight FAIL: fn_wealth_user_pode_ver_tudo nao existe (Sprint 1?)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_wealth_user_eh_operador'
  ) THEN
    RAISE EXCEPTION 'Pre-flight FAIL: fn_wealth_user_eh_operador nao existe (PARTE 0 nao aplicada?)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_wealth_consultores_updated_at'
  ) THEN
    RAISE EXCEPTION 'Pre-flight FAIL: fn_wealth_consultores_updated_at nao existe (PARTE 0 nao aplicada?)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM companies WHERE id = '25305b15-09e1-4abe-944f-9bff31743350'
  ) THEN
    RAISE EXCEPTION 'Pre-flight FAIL: company PS Consultoria (25305b15-...) nao encontrada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'gen_random_uuid'
  ) THEN
    RAISE EXCEPTION 'Pre-flight FAIL: gen_random_uuid nao disponivel (pgcrypto ou pg13+ necessario)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'wealth_pluggy_consents', 'wealth_pluggy_items', 'wealth_pluggy_sync_log',
        'wealth_pluggy_raw', 'wealth_ofx_uploads', 'wealth_consent_templates'
      )
  ) THEN
    RAISE WARNING 'Pre-flight WARN: ao menos uma das 6 tabelas ja existe; CREATE TABLE IF NOT EXISTS preservara estado';
  END IF;

  RAISE NOTICE 'Pre-flight OK: funcoes Sprint 1 + PARTE 0 presentes, company PS encontrada, gen_random_uuid disponivel';
END $$;

-- ============================================================
-- 1.1 wealth_pluggy_consents — termo LGPD versionado
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_pluggy_consents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES wealth_clients(id) ON DELETE CASCADE,
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  texto_consentimento_v    text NOT NULL,
  texto_consentimento_md5  text NOT NULL,
  assinatura_canvas        text,
  hash_consentimento       text NOT NULL,
  ip                       inet,
  ip_v6                    text,
  user_agent               text,
  aceito_em                timestamptz NOT NULL DEFAULT now(),
  aceito_por_user_id       uuid REFERENCES users(id),
  revogado_em              timestamptz,
  revogado_por_user_id     uuid REFERENCES users(id),
  motivo_revogacao         text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pluggy_consents_client
  ON wealth_pluggy_consents (client_id) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_pluggy_consents_company
  ON wealth_pluggy_consents (company_id);

ALTER TABLE wealth_pluggy_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pluggy_consents_admin_all ON wealth_pluggy_consents;
CREATE POLICY pluggy_consents_admin_all
  ON wealth_pluggy_consents FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS pluggy_consents_operador_all ON wealth_pluggy_consents;
CREATE POLICY pluggy_consents_operador_all
  ON wealth_pluggy_consents FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

-- ============================================================
-- 1.2 wealth_pluggy_items — conexoes ativas
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_pluggy_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES wealth_clients(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  consent_id          uuid REFERENCES wealth_pluggy_consents(id),
  pluggy_item_id      text NOT NULL UNIQUE,
  connector_id        int NOT NULL,
  connector_name      text NOT NULL,
  connector_type      text,
  connector_image_url text,
  status              text NOT NULL DEFAULT 'LOGIN_IN_PROGRESS' CHECK (status IN (
                          'LOGIN_IN_PROGRESS', 'WAITING_USER_INPUT', 'UPDATING',
                          'UPDATED', 'LOGIN_ERROR', 'OUTDATED', 'REVOKED', 'DELETED'
                      )),
  ultimo_sync_em      timestamptz,
  proxima_sync_em     timestamptz,
  ultimo_erro_msg     text,
  ultimo_erro_em      timestamptz,
  metadata            jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pluggy_items_client
  ON wealth_pluggy_items (client_id) WHERE status NOT IN ('REVOKED', 'DELETED');
CREATE INDEX IF NOT EXISTS idx_pluggy_items_status
  ON wealth_pluggy_items (status);
CREATE INDEX IF NOT EXISTS idx_pluggy_items_proxima_sync
  ON wealth_pluggy_items (proxima_sync_em) WHERE status = 'UPDATED';

ALTER TABLE wealth_pluggy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pluggy_items_admin_all ON wealth_pluggy_items;
CREATE POLICY pluggy_items_admin_all
  ON wealth_pluggy_items FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS pluggy_items_operador_all ON wealth_pluggy_items;
CREATE POLICY pluggy_items_operador_all
  ON wealth_pluggy_items FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

-- Trigger updated_at: reusa fn_wealth_consultores_updated_at criada na PARTE 0
-- (funcao generica que apenas seta NEW.updated_at = now()).
DROP TRIGGER IF EXISTS trg_pluggy_items_updated_at ON wealth_pluggy_items;
CREATE TRIGGER trg_pluggy_items_updated_at
  BEFORE UPDATE ON wealth_pluggy_items
  FOR EACH ROW EXECUTE FUNCTION fn_wealth_consultores_updated_at();

-- ============================================================
-- 1.3 wealth_pluggy_sync_log — auditoria operacional
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_pluggy_sync_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                 uuid NOT NULL REFERENCES wealth_pluggy_items(id) ON DELETE CASCADE,
  client_id               uuid NOT NULL REFERENCES wealth_clients(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  executado_em            timestamptz NOT NULL DEFAULT now(),
  origem                  text NOT NULL CHECK (origem IN (
                              'cron', 'webhook', 'manual_consultor', 'cliente_refresh', 'item_created'
                          )),
  total_accounts          int DEFAULT 0,
  total_investments       int DEFAULT 0,
  total_transactions      int DEFAULT 0,
  total_dividends         int DEFAULT 0,
  total_inseridas         int DEFAULT 0,
  total_atualizadas       int DEFAULT 0,
  total_descartadas       int DEFAULT 0,
  duracao_ms              int,
  status                  text NOT NULL CHECK (status IN ('sucesso', 'parcial', 'erro')),
  erro_msg                text,
  payload_resumo          jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pluggy_sync_log_item
  ON wealth_pluggy_sync_log (item_id, executado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pluggy_sync_log_status
  ON wealth_pluggy_sync_log (status, executado_em DESC);

ALTER TABLE wealth_pluggy_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pluggy_sync_log_admin_select ON wealth_pluggy_sync_log;
CREATE POLICY pluggy_sync_log_admin_select
  ON wealth_pluggy_sync_log FOR SELECT
  USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS pluggy_sync_log_operador_select ON wealth_pluggy_sync_log;
CREATE POLICY pluggy_sync_log_operador_select
  ON wealth_pluggy_sync_log FOR SELECT
  USING (fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS pluggy_sync_log_service_insert ON wealth_pluggy_sync_log;
CREATE POLICY pluggy_sync_log_service_insert
  ON wealth_pluggy_sync_log FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- 1.4 wealth_pluggy_raw — payload bruto retencao 5 anos CVM
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_pluggy_raw (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id     uuid REFERENCES wealth_pluggy_sync_log(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES wealth_pluggy_items(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES wealth_clients(id) ON DELETE CASCADE,
  tipo_payload    text NOT NULL CHECK (tipo_payload IN (
                      'accounts', 'investments', 'transactions', 'webhook_event', 'item_status'
                  )),
  payload         jsonb NOT NULL,
  recebido_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pluggy_raw_sync_log
  ON wealth_pluggy_raw (sync_log_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_raw_client_data
  ON wealth_pluggy_raw (client_id, recebido_em DESC);
CREATE INDEX IF NOT EXISTS idx_pluggy_raw_tipo
  ON wealth_pluggy_raw (tipo_payload, recebido_em DESC);

ALTER TABLE wealth_pluggy_raw ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pluggy_raw_admin_select ON wealth_pluggy_raw;
CREATE POLICY pluggy_raw_admin_select
  ON wealth_pluggy_raw FOR SELECT
  USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS pluggy_raw_operador_select ON wealth_pluggy_raw;
CREATE POLICY pluggy_raw_operador_select
  ON wealth_pluggy_raw FOR SELECT
  USING (client_id IS NOT NULL AND fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS pluggy_raw_service_insert ON wealth_pluggy_raw;
CREATE POLICY pluggy_raw_service_insert
  ON wealth_pluggy_raw FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- 1.5 wealth_ofx_uploads — registro de uploads OFX
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_ofx_uploads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES wealth_clients(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by_user_id     uuid REFERENCES users(id),
  filename                text NOT NULL,
  file_size_bytes         int,
  storage_path            text,
  corretora_detectada     text,
  periodo_inicio          date,
  periodo_fim             date,
  total_transactions      int DEFAULT 0,
  total_inseridas         int DEFAULT 0,
  total_descartadas       int DEFAULT 0,
  status                  text NOT NULL DEFAULT 'recebido' CHECK (status IN (
                              'recebido', 'processando', 'sucesso', 'parcial', 'erro'
                          )),
  erro_msg                text,
  payload_resumo          jsonb DEFAULT '{}'::jsonb,
  raw_content_sample      text,
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  processed_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ofx_uploads_client
  ON wealth_ofx_uploads (client_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ofx_uploads_status
  ON wealth_ofx_uploads (status);

ALTER TABLE wealth_ofx_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofx_uploads_admin_all ON wealth_ofx_uploads;
CREATE POLICY ofx_uploads_admin_all
  ON wealth_ofx_uploads FOR ALL
  USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS ofx_uploads_operador_all ON wealth_ofx_uploads;
CREATE POLICY ofx_uploads_operador_all
  ON wealth_ofx_uploads FOR ALL
  USING (fn_wealth_user_eh_operador(client_id))
  WITH CHECK (fn_wealth_user_eh_operador(client_id));

-- ============================================================
-- 1.6 wealth_consent_templates — templates de termos
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_consent_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  versao          text NOT NULL UNIQUE,
  tipo            text NOT NULL CHECK (tipo IN ('pluggy_open_finance', 'ofx_upload', 'lgpd_geral')),
  titulo          text NOT NULL,
  texto_md        text NOT NULL,
  texto_md5       text NOT NULL,
  vigente_de      timestamptz NOT NULL DEFAULT now(),
  vigente_ate     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wealth_consent_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_tpl_select_all ON wealth_consent_templates;
CREATE POLICY consent_tpl_select_all
  ON wealth_consent_templates FOR SELECT
  USING (true);

DROP POLICY IF EXISTS consent_tpl_admin_modify ON wealth_consent_templates;
CREATE POLICY consent_tpl_admin_modify
  ON wealth_consent_templates FOR ALL
  USING (fn_wealth_user_pode_ver_tudo())
  WITH CHECK (fn_wealth_user_pode_ver_tudo());

-- Inserir termo padrao Pluggy v1.0
INSERT INTO wealth_consent_templates (versao, tipo, titulo, texto_md, texto_md5)
VALUES (
  'pluggy_v1_2026_05_07',
  'pluggy_open_finance',
  'Termo de Consentimento - Compartilhamento de Dados via Open Finance (Pluggy)',
  'TERMO DE CONSENTIMENTO PARA COMPARTILHAMENTO DE DADOS FINANCEIROS

1. OBJETO
Este termo autoriza a PS GESTAO E CAPITAL (CNPJ 49.701.612/0001-09) a acessar, por meio da plataforma Pluggy (autorizada pelo BACEN como ITP no ambito do Open Finance Brasil), os dados de minhas contas e investimentos nas instituicoes financeiras que eu autorizar.

2. DADOS COMPARTILHADOS
- Saldos e extratos de conta corrente e poupanca
- Posicoes e movimentacoes de investimentos (RV, RF, FIIs, Tesouro, Fundos)
- Proventos recebidos (dividendos, JCP, juros)
- Eventos corporativos (desdobramentos, grupamentos, bonificacoes)

3. FINALIDADE
Os dados serao utilizados exclusivamente para:
- Consolidacao do meu patrimonio em painel unico
- Calculo de performance e diagnostico financeiro
- Geracao de relatorios mensais
- Suporte a recomendacoes de investimento (CVM 19/2021)

4. SEGURANCA
- A PS Gestao NAO tera acesso as minhas senhas (login feito direto na instituicao via Pluggy)
- Os dados sao criptografados em transito e em repouso
- Acesso restrito a profissionais autorizados sob NDA

5. DIREITOS LGPD (Lei 13.709/2018)
Posso a qualquer momento:
- Acessar meus dados (Art 18 II)
- Corrigir dados (Art 18 III)
- Solicitar exclusao (Art 18 VI)
- REVOGAR este consentimento (Art 8 paragrafo 5)

A revogacao pode ser feita pelo botao Revogar conexao no portal, que desconecta imediatamente o acesso da PS Gestao aos meus dados.

6. RETENCAO
Os dados serao retidos por 5 anos apos o termino da relacao consultivo, conforme exigencia CVM 19/2021. Apos esse prazo, serao excluidos.

7. NAO COMPARTILHAMENTO COM TERCEIROS
A PS Gestao NAO compartilha estes dados com terceiros, exceto quando:
- Exigido por lei ou autoridade reguladora (CVM, BACEN, COAF)
- Autorizado expressamente pelo cliente

8. DECLARACAO
Declaro que li, entendi e concordo com este termo. A assinatura eletronica abaixo, junto com IP, user agent e timestamp do servidor, constitui prova juridica do meu consentimento (Lei 14.063/2020).',
  md5('TERMO_PLUGGY_V1_2026_05_07_PS_GESTAO_CAPITAL')
)
ON CONFLICT (versao) DO NOTHING;

-- ============================================================
-- 1.7 Validacoes finais
-- ============================================================
DO $$
DECLARE
  v_tabelas int;
  v_termo_pluggy int;
BEGIN
  SELECT COUNT(*) INTO v_tabelas
  FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN (
      'wealth_pluggy_consents',
      'wealth_pluggy_items',
      'wealth_pluggy_sync_log',
      'wealth_pluggy_raw',
      'wealth_ofx_uploads',
      'wealth_consent_templates'
    );

  IF v_tabelas <> 6 THEN
    RAISE EXCEPTION 'Erro: deveriam existir 6 tabelas novas, encontradas %', v_tabelas;
  END IF;

  SELECT COUNT(*) INTO v_termo_pluggy
  FROM wealth_consent_templates
  WHERE tipo = 'pluggy_open_finance';

  IF v_termo_pluggy = 0 THEN
    RAISE EXCEPTION 'Erro: termo Pluggy v1.0 nao foi inserido';
  END IF;

  RAISE NOTICE 'PARTE 1 OK: 6 tabelas criadas, % termo(s) Pluggy', v_termo_pluggy;
END $$;

COMMIT;
