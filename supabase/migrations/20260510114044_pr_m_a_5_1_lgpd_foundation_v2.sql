-- PR M.A.5.1 v2: foundation LGPD com trigger ao inves de generated column
-- Fix: data_prazo_legal generated falhou IMMUTABLE - usar trigger

-- ETAPA 1: bases_legais
CREATE TABLE IF NOT EXISTS public.lgpd_bases_legais (
  id text PRIMARY KEY,
  nome text NOT NULL,
  descricao text NOT NULL,
  artigo_lgpd text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('dados_pessoais', 'dados_sensiveis')),
  exige_consentimento boolean NOT NULL DEFAULT false,
  exige_dpo boolean NOT NULL DEFAULT false,
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT NOW()
);

INSERT INTO public.lgpd_bases_legais (id, nome, descricao, artigo_lgpd, tipo, exige_consentimento) VALUES
  ('consentimento', 'Consentimento do titular', 'Manifestacao livre, informada e inequivoca do titular', 'Art. 7º I', 'dados_pessoais', true),
  ('obrigacao_legal', 'Obrigacao legal/regulatoria', 'Cumprimento de obrigacao legal pelo controlador', 'Art. 7º II', 'dados_pessoais', false),
  ('politicas_publicas', 'Execucao de politicas publicas', 'Tratamento por administracao publica', 'Art. 7º III', 'dados_pessoais', false),
  ('estudos_pesquisa', 'Estudos e pesquisa', 'Realizacao de estudos por orgao de pesquisa', 'Art. 7º IV', 'dados_pessoais', false),
  ('execucao_contrato', 'Execucao de contrato', 'Necessario para execucao de contrato do qual titular eh parte', 'Art. 7º V', 'dados_pessoais', false),
  ('exercicio_direitos', 'Exercicio regular de direitos', 'Em processo judicial, administrativo ou arbitral', 'Art. 7º VI', 'dados_pessoais', false),
  ('protecao_vida', 'Protecao da vida', 'Protecao da vida ou incolumidade fisica', 'Art. 7º VII', 'dados_pessoais', false),
  ('tutela_saude', 'Tutela da saude', 'Tutela da saude por profissionais ou autoridades sanitarias', 'Art. 7º VIII', 'dados_pessoais', false),
  ('legitimo_interesse', 'Legitimo interesse', 'Interesses legitimos do controlador ou terceiro', 'Art. 7º IX', 'dados_pessoais', false),
  ('protecao_credito', 'Protecao do credito', 'Protecao do credito (Lei 12.414/2011)', 'Art. 7º X', 'dados_pessoais', false)
ON CONFLICT (id) DO NOTHING;

-- ETAPA 2: finalidades_tratamento
CREATE TABLE IF NOT EXISTS public.lgpd_finalidades_tratamento (
  id text PRIMARY KEY,
  nome text NOT NULL,
  descricao text NOT NULL,
  base_legal_id text NOT NULL REFERENCES public.lgpd_bases_legais(id),
  modulo_relacionado text,
  retencao_dias integer,
  exige_consentimento_explicito boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT NOW(),
  atualizado_em timestamptz DEFAULT NOW()
);

INSERT INTO public.lgpd_finalidades_tratamento (id, nome, descricao, base_legal_id, modulo_relacionado, retencao_dias, exige_consentimento_explicito) VALUES
  ('execucao_servico_erp', 'Execucao do servico ERP', 'Processar lancamentos financeiros, DRE, fluxo de caixa', 'execucao_contrato', 'core_erp', 1825, false),
  ('integracao_omie_nibo', 'Integracao com sistemas externos', 'Sincronizar dados com Omie/Nibo/SIGA', 'execucao_contrato', 'integrations', 1825, false),
  ('analise_ia_dre', 'Analise por IA dos dados financeiros', 'Gerar insights, recomendacoes e Truth Auditor', 'consentimento', 'consultor_ia', 1825, true),
  ('comunicacao_marketing', 'Comunicacao de marketing', 'Envio de novidades, conteudo educativo, ofertas', 'consentimento', 'marketing', 365, true),
  ('compliance_fiscal', 'Compliance fiscal e tributario', 'Apuracao de impostos, retencoes, calculos fiscais', 'obrigacao_legal', 'fiscal', 1825, false),
  ('compliance_trabalhista', 'Compliance trabalhista', 'Folha pagamento, eSocial, NR-6', 'obrigacao_legal', 'compliance', 1825, false),
  ('analise_credito', 'Analise de credito (Wealth)', 'Score, score behavioral, decisao de credito', 'protecao_credito', 'wealth', 365, false),
  ('seguranca_acesso', 'Seguranca e logs de acesso', 'Audit log, deteccao de fraude, MFA', 'legitimo_interesse', 'security', 365, false)
ON CONFLICT (id) DO NOTHING;

-- ETAPA 3: consentimentos_granulares
CREATE TABLE IF NOT EXISTS public.lgpd_consentimentos_granulares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  finalidade_id text NOT NULL REFERENCES public.lgpd_finalidades_tratamento(id),
  consentido boolean NOT NULL,
  versao_termos text NOT NULL,
  ip text,
  user_agent text,
  data_consentimento timestamptz NOT NULL DEFAULT NOW(),
  data_revogacao timestamptz,
  motivo_revogacao text,
  criado_em timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_gran_user ON public.lgpd_consentimentos_granulares(user_id, finalidade_id);
CREATE INDEX IF NOT EXISTS idx_consent_gran_email ON public.lgpd_consentimentos_granulares(user_email);
CREATE INDEX IF NOT EXISTS idx_consent_gran_ativo ON public.lgpd_consentimentos_granulares(user_id, finalidade_id, data_revogacao) WHERE data_revogacao IS NULL;

ALTER TABLE public.lgpd_consentimentos_granulares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_can_read_own_consent" ON public.lgpd_consentimentos_granulares;
CREATE POLICY "user_can_read_own_consent" ON public.lgpd_consentimentos_granulares
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service_role_writes_consent" ON public.lgpd_consentimentos_granulares;
CREATE POLICY "service_role_writes_consent" ON public.lgpd_consentimentos_granulares
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ETAPA 4: solicitacoes_titular (FIX: data_prazo_legal via trigger)
CREATE TABLE IF NOT EXISTS public.lgpd_solicitacoes_titular (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  user_email text NOT NULL,
  user_cpf text,
  tipo_solicitacao text NOT NULL CHECK (tipo_solicitacao IN (
    'confirmacao_existencia', 'acesso_dados', 'correcao', 'anonimizacao',
    'portabilidade', 'eliminacao', 'informacao_compartilhamento',
    'revogacao_consentimento', 'oposicao_tratamento'
  )),
  status text NOT NULL DEFAULT 'recebida' CHECK (status IN (
    'recebida', 'em_analise', 'aguardando_titular', 'concluida', 'rejeitada', 'expirada'
  )),
  motivo_rejeicao text,
  detalhes jsonb DEFAULT '{}'::jsonb,
  prazo_resposta_dias integer NOT NULL DEFAULT 15,
  data_recebimento timestamptz NOT NULL DEFAULT NOW(),
  data_prazo_legal timestamptz,  -- preenchido por trigger
  data_conclusao timestamptz,
  resultado jsonb,
  ip_origem text,
  responsavel_dpo uuid REFERENCES auth.users(id),
  criado_em timestamptz DEFAULT NOW(),
  atualizado_em timestamptz DEFAULT NOW()
);

-- Trigger para calcular data_prazo_legal
CREATE OR REPLACE FUNCTION public.fn_lgpd_calcular_prazo_legal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.data_prazo_legal := NEW.data_recebimento + (NEW.prazo_resposta_dias || ' days')::interval;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lgpd_calcular_prazo ON public.lgpd_solicitacoes_titular;
CREATE TRIGGER trg_lgpd_calcular_prazo
BEFORE INSERT OR UPDATE OF data_recebimento, prazo_resposta_dias
ON public.lgpd_solicitacoes_titular
FOR EACH ROW EXECUTE FUNCTION public.fn_lgpd_calcular_prazo_legal();

CREATE INDEX IF NOT EXISTS idx_lgpd_solic_user ON public.lgpd_solicitacoes_titular(user_id);
CREATE INDEX IF NOT EXISTS idx_lgpd_solic_status ON public.lgpd_solicitacoes_titular(status, data_prazo_legal);

ALTER TABLE public.lgpd_solicitacoes_titular ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_can_read_own_requests" ON public.lgpd_solicitacoes_titular;
CREATE POLICY "user_can_read_own_requests" ON public.lgpd_solicitacoes_titular
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service_role_writes_requests" ON public.lgpd_solicitacoes_titular;
CREATE POLICY "service_role_writes_requests" ON public.lgpd_solicitacoes_titular
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ETAPA 5: inventario_dados
CREATE TABLE IF NOT EXISTS public.lgpd_inventario_dados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela text NOT NULL,
  coluna text NOT NULL,
  classificacao text NOT NULL CHECK (classificacao IN (
    'pii_basico', 'pii_documento', 'pii_endereco', 'pii_financeiro',
    'pii_sensivel', 'pii_credenciais', 'metadado', 'nao_pessoal'
  )),
  finalidade_id text REFERENCES public.lgpd_finalidades_tratamento(id),
  base_legal_id text REFERENCES public.lgpd_bases_legais(id),
  retencao_dias integer,
  criptografado boolean NOT NULL DEFAULT false,
  observacao text,
  validado_em timestamptz,
  validado_por text,
  criado_em timestamptz DEFAULT NOW(),
  UNIQUE (tabela, coluna)
);

CREATE INDEX IF NOT EXISTS idx_inventario_classificacao ON public.lgpd_inventario_dados(classificacao);
CREATE INDEX IF NOT EXISTS idx_inventario_tabela ON public.lgpd_inventario_dados(tabela);
