-- SIC-F1 · fundação do conector Sicredi Cobrança (banco 748). 🧊 Sicoob (756) NÃO é tocado.
-- Auditado antes (RD-38): erp_banco_erro_catalogo já tem PK (provider,codigo); config tem todas as colunas
-- e NÃO tem boleto_seq/especie_documento/valida_cep_pagador/webhook_*; system_screens.id e feature_catalog.id
-- são TEXT sem default (a SPEC omitia o id — corrigido aqui).
--
-- CORREÇÃO PÓS-DEPLOY (RD-38): a versão original deste arquivo NÃO era aplicável. Três premissas de schema
-- do SPEC estavam erradas e só o banco real revelou:
--   (1) erp_banco_manifesto.campos_ausentes é JSONB (o SPEC atribuía text[] → 42804);
--   (2) erp_banco_manifesto.scopes_ok / scopes_proibidos são JSONB (idem);
--   (3) feature_catalog.pilar_inviolavel é INTEGER (o SPEC passava o texto 'seguranca_lgpd' → 22P02).
-- Abaixo já corrigido para bater byte a byte com o que foi aplicado em produção.

-- 1.1 · campos que a API Sicredi exige e a config não tinha
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS boleto_seq          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS especie_documento   text,
  ADD COLUMN IF NOT EXISTS valida_cep_pagador  boolean,   -- NULL = DESCONHECIDO (RD-51)
  ADD COLUMN IF NOT EXISTS webhook_contrato_id text,
  ADD COLUMN IF NOT EXISTS webhook_url         text;
COMMENT ON COLUMN public.erp_banco_provider_config.boleto_seq IS
  'Sequencial de seuNumero (Sicredi limita a 10 chars). Nunca usar UUID.';
COMMENT ON COLUMN public.erp_banco_provider_config.valida_cep_pagador IS
  'NULL=desconhecido. Só o primeiro HTTP 422 do Sicredi responde. Proibido assumir false.';

-- 1.2 · manifesto Sicredi (o atual mente: auth_tipo errado, dois segredos no mesmo slot). SÓ provider=sicredi.
-- campos_ausentes / scopes_ok / scopes_proibidos são JSONB no schema real — literais jsonb, não text[].
UPDATE public.erp_banco_manifesto SET
  auth_tipo = 'apikey_oauth_password',
  homologado_ref = NULL,          -- NUNCA houve homologação; dizia 'KGF' e é falso (RD-51)
  portal_url = 'https://developer.sicredi.com.br/api-portal/pt-br',
  quem_aprova = 'PJ Tech · pjtech@sicredi.com.br · (51) 3358-8000 · 9h-18h seg-sex',
  prazo_tipico = 'SLA 24h; média real 30min-1h (Cartilha do Portal)',
  campos_ausentes = '["certificado","client_id","convenio","carteira","agencia"]'::jsonb,
  scopes_ok = '["cobranca"]'::jsonb,
  scopes_proibidos = '["Pagamentos","Pix Pagamentos","Transferencias"]'::jsonb,
  campos = '[
    {"id":"cooperativa","label":"Cooperativa","exemplo":"0313","helper":"4 dígitos. É a agência no e-mail do Sicredi."},
    {"id":"posto","label":"Posto","exemplo":"15","helper":"2 dígitos."},
    {"id":"codigo_beneficiario","label":"Código do beneficiário","exemplo":"99251","helper":"5 dígitos. É o código do convênio, gerado na contratação."},
    {"id":"api_key","label":"Access Token (x-api-key)","secret":"apikey","helper":"UUID do Portal do Desenvolvedor, liberado após chamado. NÃO é a senha do banco."},
    {"id":"codigo_acesso","label":"Código de Acesso","secret":"clisecret","helper":"Gerado pelo Usuário Master no Internet Banking: Cobrança >> Código de Acesso >> Gerar."}
  ]'::jsonb,
  portal_passos = jsonb_build_object(
    'ordem', jsonb_build_array(
      '1. Portal do Desenvolvedor > Criar Conta (usar e-mail CORPORATIVO — a app pertence a quem criou)',
      '2. Minha Conta > Minhas Apps > Cadastrar Nova App',
      '3. Marcar Open API - OAuth - Parceiros 1.0.0 E Open API - Cobranca - Parceiros 1.0.0',
      '4. Preencher Nome do estabelecimento (obrigatório, não citado na Cartilha) e E-mail',
      '5. Registrar > copiar o Client ID',
      '6. Suporte > Abra um chamado > Tipo: API Cobrança Boletos > Motivo: Solicitar Access Token > Ambiente: PRODUÇÃO > colar Client ID',
      '7. Minhas Apps > Detalhes > copiar o Access Token (x-api-key)'
    ),
    'aviso', 'A Cartilha recomenda criar DIRETO em produção. App criada em sandbox exige repetir tudo depois.'
  ),
  updated_at = now()
WHERE provider = 'sicredi';

-- 1.3 · catálogo de erro Sicredi (hoje zero linhas → a tela cospe erro cru). PK (provider,codigo) já existe.
INSERT INTO public.erp_banco_erro_catalogo (provider, codigo, titulo, o_que_e, o_que_fazer, quem_contatar, pedir_ao_banco) VALUES
('sicredi','401_x_api_key','Access Token ausente ou inválido',
 'O header x-api-key não foi enviado ou não corresponde ao ambiente.',
 'Confirme que o token é o de PRODUÇÃO. O token de sandbox não funciona em produção.',
 'Portal do Desenvolvedor > Minhas Apps > Detalhes', NULL),
('sicredi','401_invalid_user_credentials','Usuário ou Código de Acesso inválidos',
 'username (beneficiário+cooperativa) ou password (Código de Acesso) errados.',
 'Confirme o username: código do beneficiário seguido da cooperativa, 9 dígitos, sem separador. Se persistir, gere novo Código de Acesso.',
 'Usuário Master no Internet Banking', 'Regerar Código de Acesso em Cobrança >> Código de Acesso >> Gerar'),
('sicredi','401_cooperativa_diferente','Cooperativa diferente da do usuário',
 'A cooperativa do header não bate com a do token.',
 'Cooperativa, posto e beneficiário do cadastro têm de ser os mesmos que geraram o Código de Acesso.',
 'PJ Tech', NULL),
('sicredi','422_ecomm','Beneficiário sem Cobrança Online (ECOMM)',
 'O convênio existe mas não tem a modalidade API habilitada.',
 'Confirme com o gerente. Sintoma: o menu "Código de Acesso" não aparece no Internet Banking.',
 'Gerente da cooperativa', 'Habilitar modalidade API (Cobrança Online) no convênio {codigo_beneficiario}'),
('sicredi','422_hibrido','Boleto híbrido não contratado',
 'tipoCobranca=HIBRIDO exige o produto Pix contratado no convênio.',
 'Emita como NORMAL até a cooperativa habilitar o híbrido.',
 'Gerente da cooperativa', 'Habilitar boleto híbrido (QR Code) no convênio {codigo_beneficiario}'),
('sicredi','422_cep_pagador','Beneficiário optou por validar CEP do pagador',
 'O convênio exige CEP válido do pagador; o CEP enviado não foi localizado.',
 'Complete o cadastro do cliente (CEP, cidade, UF, endereço). Este erro RESPONDE se o convênio valida CEP — gravar valida_cep_pagador = true.',
 'Cadastro de clientes', NULL),
('sicredi','422_vencimento_retroativo','Vencimento anterior a hoje',
 'A API recusa boleto com vencimento retroativo.',
 'Títulos já vencidos não podem ser registrados. Renegocie o vencimento antes de emitir.',
 NULL, NULL),
('sicredi','422_convenio_encerrado','Convênio encerrado',
 'O cadastro do beneficiário está encerrado.',
 'Verificar situação do convênio.',
 'Gerente da cooperativa', 'Verificar status do convênio {codigo_beneficiario}'),
('sicredi','400_seu_numero','seuNumero acima de 10 caracteres',
 'O campo seuNumero é obrigatório e limitado a 10 caracteres.',
 'Usar o sequencial de fn_banco_proximo_seu_numero. O ID interno vai em idTituloEmpresa (25 chars).',
 NULL, NULL),
('sicredi','429','Muitas requisições',
 'Limite de 20 requisições/segundo no cadastro; a impressão de PDF também limita.',
 'O conector já faz backoff. Se persistir, reduza o tamanho do lote.',
 NULL, NULL)
ON CONFLICT (provider, codigo) DO UPDATE SET
  titulo=EXCLUDED.titulo, o_que_e=EXCLUDED.o_que_e, o_que_fazer=EXCLUDED.o_que_fazer,
  quem_contatar=EXCLUDED.quem_contatar, pedir_ao_banco=EXCLUDED.pedir_ao_banco;

-- 6 · catálogo da tela: parar de mentir na sidebar. (system_screens.id/feature_catalog.id: TEXT, sem default → id explícito)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, modulo) VALUES
 ('S.financeiro.conexoes_bancarias','/dashboard/financeiro/conexoes-bancarias','gestao_empresarial','Conexões Bancárias',
  'Cadastro de credenciais bancárias por empresa (Vault), escada de teste e estado da integração.','parcial','financeiro'),
 ('S.financeiro.conexoes_bancarias_assistente','/dashboard/financeiro/conexoes-bancarias/assistente','gestao_empresarial','Assistente de Conexão Bancária',
  'Passo a passo guiado por manifesto do banco para obter e salvar credenciais.','parcial','financeiro')
ON CONFLICT (rota) DO NOTHING;

-- Sicoob (756) opera em produção com boletos emitidos e a tela mostra PREVISTO por AUSÊNCIA de linha em
-- feature_catalog. Isso é RD-58. Consertamos o CATÁLOGO da tela — o Sicoob em si não é tocado.
-- feature_catalog.pilar_inviolavel é INTEGER (não texto) e é nullable → omitido (deixa NULL).
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('F.banco.conexao_api','49af8f38-9262-41a9-844c-132d8fee4e36','gestao_empresarial','Conexão bancária por API',
  'Conectar o banco da empresa para emitir boleto e ler extrato sem depender de arquivo CNAB.',
  'parcial', 60, 'alta')
ON CONFLICT (id) DO UPDATE SET status='parcial', percentual_pronto=60;
