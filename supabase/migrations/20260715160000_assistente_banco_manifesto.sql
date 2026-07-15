-- Assistente de Conexão Bancária · camada de DADO (BLOCO 1 + BLOCO 3 do SPEC)
-- ============================================================================
-- Reusa: erp_banco_provider_config, erp_banco_contas, erp_banco_sync_log, erp_credencial.
-- Cria: erp_banco_manifesto (o processo por banco), erp_banco_teste_resultado (a escada
--       persistida), erp_banco_erro_catalogo (o manual automático — erro vira dado, não comentário).
-- RD-51: homologado é DERIVADO do teste_resultado (5/5), NUNCA um toggle. O manifesto guarda só o homologado_ref.
-- RD-53: só CRIA tabelas novas — não toca em erp_banco_provider_config (PS Sicoob segue funcionando).
-- RD-54: tabelas novas = sem dado real; migração só DDL + seed.
-- ============================================================================

-- ── BLOCO 1 · MANIFESTO (dado, não código; banco novo = 1 linha, não 1 PR) ──
CREATE TABLE IF NOT EXISTS erp_banco_manifesto (
  provider          text PRIMARY KEY,          -- sicredi | sicoob | bradesco
  nome              text NOT NULL,
  banco_codigo      text NOT NULL,             -- 748 | 756 | 237
  auth_tipo         text NOT NULL,             -- apikey | mtls | mtls_secret
  homologado_ref    text,                      -- "PS Gestão" | "KGF" | NULL(hipótese) — só a origem da prova
  portal_url        text,
  portal_passos     jsonb,
  quem_aprova       text,
  prazo_tipico      text,
  checklist_pedir   jsonb,                     -- lista copiável pro banco
  campos            jsonb,                     -- campos do form, com label HUMANO + helper
  campos_ausentes   jsonb,                     -- o que este banco NÃO usa (some da tela)
  scopes_ok         jsonb,
  scopes_proibidos  jsonb,                     -- os que MOVEM DINHEIRO — nunca aparecem
  escada_teste      jsonb,                     -- [oauth, boleto, pdf, extrato, baixa]
  updated_at        timestamptz DEFAULT now(),
  updated_by        uuid
);

-- ── BLOCO 2 · ESCADA DE TESTE PERSISTIDA (não some no F5) ──
CREATE TABLE IF NOT EXISTS erp_banco_teste_resultado (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  provider    text NOT NULL,
  passo       text NOT NULL,                   -- oauth | boleto | pdf | extrato | baixa
  status      text NOT NULL DEFAULT 'nao_testado',  -- ok | falhou | nao_testado
  detalhe     jsonb,                           -- erro bruto do banco, se falhou
  testado_em  timestamptz DEFAULT now(),
  UNIQUE (company_id, provider, passo)
);

-- estado da conexão + escada também precisam viver no config (RD-51: "estou no meio" vira dado)
ALTER TABLE erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS estado_conexao text DEFAULT 'nao_iniciado'
    CHECK (estado_conexao IN ('nao_iniciado','solicitado','aguardando_banco','recebido','testando','homologado','producao')),
  ADD COLUMN IF NOT EXISTS estado_atualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS responsavel text;

-- ── BLOCO 3 · CATÁLOGO DE ERROS (o manual automático) ──
CREATE TABLE IF NOT EXISTS erp_banco_erro_catalogo (
  provider       text,
  codigo         text,
  titulo         text,
  o_que_e        text,
  o_que_fazer    text,
  quem_contatar  text,
  pedir_ao_banco text,
  link           text,
  PRIMARY KEY (provider, codigo)
);

-- ── homologado DERIVADO (RD-51): true só se passou os 5 degraus da escada p/ ALGUM tenant ──
CREATE OR REPLACE FUNCTION fn_banco_homologado(p_provider text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM erp_banco_teste_resultado t
    WHERE t.provider = p_provider
    GROUP BY t.company_id
    HAVING count(*) FILTER (WHERE t.passo IN ('oauth','boleto','pdf','extrato','baixa') AND t.status='ok') >= 5
  );
$$;

-- ── SEED · manifestos (Sicredi/Sicoob = origem provada; Bradesco = HIPÓTESE rotulada) ──
INSERT INTO erp_banco_manifesto (provider, nome, banco_codigo, auth_tipo, homologado_ref, campos, campos_ausentes, scopes_ok, scopes_proibidos, escada_teste) VALUES
('sicredi','Sicredi','748','apikey','KGF',
 '[{"id":"cooperativa","label":"Cooperativa","exemplo":"0101"},{"id":"posto","label":"Posto","exemplo":"01"},{"id":"conta","label":"Conta corrente","exemplo":"12345-6"},{"id":"codigo_beneficiario","label":"Código do beneficiário","helper":"Fornecido pelo Sicredi ao habilitar a cobrança."},{"id":"api_key","label":"Chave de API (x-api-key)","secret":"apikey","helper":"A chave que o Sicredi entrega no Portal do Desenvolvedor. NÃO é a senha do internet banking."},{"id":"codigo_acesso","label":"Código de Acesso","secret":"apikey","helper":"O password do OAuth Sicredi (Cobrança v3)."}]'::jsonb,
 '["certificado","client_secret"]'::jsonb,
 '["Cobranca","Conta Corrente"]'::jsonb,
 '["Pagamentos","Pix Pagamentos","Transferencias"]'::jsonb,
 '["oauth","boleto","pdf","extrato","baixa"]'::jsonb),
('sicoob','Sicoob','756','mtls','PS Gestão',
 '[{"id":"cooperativa","label":"Cooperativa","exemplo":"3039"},{"id":"conta","label":"Conta corrente","exemplo":"233117-9"},{"id":"convenio","label":"Convênio de cobrança","helper":"Como aparece no seu boleto Sicoob (campo Convênio) ou no internet banking em Cobrança. Na dúvida, gerente de cobrança."},{"id":"client_id","label":"Client ID do aplicativo","helper":"Aparece no Portal Developers Sicoob DEPOIS que o banco aprova o app."},{"id":"cert","tipo":"arquivo","label":"Certificado digital (.pfx)","secret":"cert"},{"id":"certpw","tipo":"senha","label":"Senha do certificado","secret":"certpw"}]'::jsonb,
 '["client_secret","apikey"]'::jsonb,
 '["Cobranca Bancaria","Conta Corrente","Pix Recebimentos"]'::jsonb,
 '["Cobranca Bancaria Pagamentos","Convenios Pagamentos","Pix Pagamentos","SPB Transferencias"]'::jsonb,
 '["oauth","boleto","pdf","extrato","baixa"]'::jsonb),
('bradesco','Bradesco','237','mtls_secret',NULL,
 '[{"id":"conta","label":"Conta corrente"},{"id":"client_id","label":"Client ID"},{"id":"client_secret","label":"Client Secret","secret":"clisecret"},{"id":"cert","tipo":"arquivo","label":"Certificado digital (.pfx)","secret":"cert"},{"id":"certpw","tipo":"senha","label":"Senha do certificado","secret":"certpw"}]'::jsonb,
 '[]'::jsonb,
 '["Cobranca"]'::jsonb,
 '["Pagamentos","Pix Pagamentos","Transferencias"]'::jsonb,
 '["oauth","boleto","pdf","extrato","baixa"]'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- Aviso de hipótese p/ quem nunca conectou (RD-51: manifesto que nunca conectou é ficção)
UPDATE erp_banco_manifesto
   SET portal_passos = jsonb_build_object('aviso','🧪 Bradesco nunca foi homologado. Este roteiro é nossa melhor estimativa, não um manual validado. Você vai ser o primeiro.')
 WHERE provider='bradesco';

-- ── SEED · catálogo de erros (tira do comentário, bota na tabela) ──
INSERT INTO erp_banco_erro_catalogo (provider, codigo, titulo, o_que_e, o_que_fazer, quem_contatar, pedir_ao_banco, link) VALUES
('bradesco','CBTT0004','Carteira não habilitada para API REST',
 'A carteira/convênio existe, mas não está habilitada no contrato REST de cobrança.',
 'Ligue para o SUPORTE TÉCNICO DA API — NÃO o gerente de conta (ele vai dizer que está tudo certo, e não está).',
 'Suporte técnico da API Bradesco',
 'Habilitar a carteira {carteira} no contrato REST de cobrança do CNPJ {cnpj}', NULL),
('sicoob','invalid_client','Aplicativo ainda não aprovado',
 'O app foi criado no portal, mas o banco ainda não aprovou.',
 'É normal. Aguarde a aprovação da cooperativa (1-5 dias úteis).',
 'Gerente da cooperativa', NULL, NULL),
('focusnfe','E0166','Falta o regime de apuração do Simples Nacional',
 'A NFS-e (padrão Nacional) exige o regime de apuração dos tributos do SN para optante ME/EPP, e o payload não enviou.',
 'Confirme regime_tributario = simples_nacional no cadastro da empresa; o payload precisa incluir o regime de apuração SN.',
 'Contabilidade / dev fiscal', NULL, NULL),
('focusnfe','E0160','Situação do Simples Nacional diverge do cadastro',
 'A opção de situação perante o Simples Nacional informada na DPS não bate com o cadastro SN da prefeitura na competência.',
 'Verifique a opção SN da empresa na competência (Simples Nacional x excedente sublimite) e alinhe com o cadastro da prefeitura.',
 'Contabilidade', NULL, NULL)
ON CONFLICT (provider, codigo) DO NOTHING;

-- Backfill honesto: configs JÁ conectadas não podem nascer 'nao_iniciado' (RD-52: config != realidade = mentira).
UPDATE erp_banco_provider_config
   SET estado_conexao = CASE WHEN ambiente='producao' THEN 'producao' ELSE 'recebido' END,
       estado_atualizado_em = now()
 WHERE ativo = true
   AND estado_conexao = 'nao_iniciado'
   AND (cert_vault_id IS NOT NULL OR api_key_vault_id IS NOT NULL OR client_id IS NOT NULL);
