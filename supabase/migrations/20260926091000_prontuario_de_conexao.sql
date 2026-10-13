-- PRONTUARIO DE CONEXAO (decisao CEO 26/09, contexto c87993c6) · camada de auditoria RD-35
-- (1) erp_fiscal_erro_catalogo — espelho do erp_banco_erro_catalogo: erro fiscal -> o que e, causa (provada ou hipotese), o que fazer
-- (2) v_prontuario_conexao — ficha por empresa: fiscal + banco, estado real, ultimo erro traduzido, o que falta

CREATE TABLE IF NOT EXISTS public.erp_fiscal_erro_catalogo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'focusnfe',           -- focusnfe | sefaz | nfse_nacional | gov_nfse | sistema
  documento     text NOT NULL,                              -- nfe | nfse | nfce | cte | certificado | todos
  codigo        text NOT NULL,                              -- E0713, 966, 232, PKCS12, IE_DEST...
  padrao_msg    text,                                       -- trecho da mensagem que identifica (ILIKE)
  titulo        text NOT NULL,
  o_que_e       text NOT NULL,
  causa_provada boolean NOT NULL DEFAULT false,             -- RD-70: sem prova descrita e HIPOTESE
  causa         text,
  como_provado  text,                                       -- RD-70 corolario: COMO foi provado
  o_que_fazer   text NOT NULL,                              -- linguagem do usuario (Jordana), passo a passo
  quem_contatar text,                                       -- contador | provedor (Focus) | prefeitura | Eng. Chefe
  fonte         text,                                       -- MOC/NT/leiaute/ticket (RD-72)
  contexto_id   uuid,                                       -- erp_contexto_projeto de origem
  pr_numero     int,
  ocorrencias   int NOT NULL DEFAULT 0,
  ultima_vez_em timestamptz,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, documento, codigo)
);
COMMENT ON TABLE public.erp_fiscal_erro_catalogo IS 'Catalogo de erros fiscais vividos: o que e, causa (provada/hipotese), o que fazer. Consultar ANTES de investigar (RD-70). Espelho do erp_banco_erro_catalogo.';
ALTER TABLE public.erp_fiscal_erro_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalogo fiscal leitura autenticados" ON public.erp_fiscal_erro_catalogo;
CREATE POLICY "catalogo fiscal leitura autenticados" ON public.erp_fiscal_erro_catalogo FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.erp_fiscal_erro_catalogo TO authenticated;

-- tradutor: dado provider/documento + mensagem, devolve a linha do catalogo (codigo explicito ou padrao_msg)
CREATE OR REPLACE FUNCTION public.fn_fiscal_erro_traduzir(p_documento text, p_mensagem text)
RETURNS public.erp_fiscal_erro_catalogo LANGUAGE sql STABLE AS $$
  SELECT c.* FROM public.erp_fiscal_erro_catalogo c
  WHERE c.ativo AND c.documento IN (p_documento, 'todos')
    AND (p_mensagem ILIKE c.codigo || '%' OR p_mensagem ILIKE '%' || c.codigo || ':%' OR p_mensagem ILIKE '% ' || c.codigo || ' %'
         OR (c.padrao_msg IS NOT NULL AND p_mensagem ILIKE '%' || c.padrao_msg || '%'))
  ORDER BY (c.padrao_msg IS NOT NULL) DESC, length(c.codigo) DESC
  LIMIT 1
$$;

-- ---------- SEED: rejeicoes ja vividas (provider focusnfe salvo indicado) ----------
INSERT INTO public.erp_fiscal_erro_catalogo
 (provider, documento, codigo, padrao_msg, titulo, o_que_e, causa_provada, causa, como_provado, o_que_fazer, quem_contatar, fonte, pr_numero)
VALUES
 ('nfse_nacional','nfse','E0713','Para Não Optante do SN os campos',
  'Não optante sem tributos aproximados',
  'O Ambiente Nacional passou a exigir os tributos aproximados (Lei 12.741) de todo emitente NÃO optante do Simples. A mensagem cita os campos do Simples e engana: o problema é campo FALTANDO, não sobrando.',
  true, 'Payload sem o grupo percentual_total_tributos_{federais,estaduais,municipais} (pTotTribFed/Est/Mun). Resolvido: o sistema envia os percentuais da tabela IBPT (LC116 x UF).',
  'Resposta oficial Focus ticket #243166 (25/09); NFS-e 421 da FC Pisos autorizada 26/09 com 13.45/0/3.15 no payload.',
  'Nada a fazer no cadastro. Se voltar: conferir se a tabela IBPT esta vigente (Configuracoes > Fiscal > IBPT) e a UF fiscal da empresa. Sem linha IBPT o sistema trava antes de enviar com a mensagem ibpt_pendente.',
  'Eng. Chefe', 'Focus #243166; guia Focus Campos do Provedor', 1807),
 ('nfse_nacional','nfse','E0162','regime de apuração dos tributos apurados',
  'Regime de apuração enviado para não optante',
  'Só optante ME/EPP (opSimpNac=3) pode informar o regime de apuração do SN. Não optante e MEI não podem.',
  true, 'Sistema enviava regime_apuracao_sn/opcao para empresa de Regime Normal (caminho construido assumindo Simples).', 'Corrigido no #1791; FC Pisos passou deste erro em 25/09.',
  'Conferir o Regime Tributario da empresa (Dados da Empresa) e a opcao do Simples na Configuracao Fiscal: Regime Normal = opcao 1, sem regime de apuracao.', 'Eng. Chefe', 'Leiaute DPS nacional (opSimpNac/regApTribSN)', 1791),
 ('nfse_nacional','nfse','E0116','A IM deve ser informada para o emitente',
  'Inscrição Municipal ausente ou errada',
  'O municipio emissor exige a IM do prestador no CNC. A DANFSe ja autorizada mostra a IM valida em "Indicador Municipal (Inscricao)".',
  true, 'IM vazia (KGF, jun) ou IM trocada por um numero "verbal" (FC: 6617 correto vs 162268088). Documento autorizado e a verdade (RD-73).',
  'FC: E0116 apareceu logo apos trocar a IM no #1769; voltou a passar com 6617.',
  'Preencher a Inscricao Municipal em Dados da Empresa exatamente como aparece em uma nota ja autorizada ou no cadastro da prefeitura. Nao usar numero de contrato/alvara.', 'contador', 'DANFSe autorizada; CNC do municipio', 1769),
 ('nfse_nacional','nfse','E0037','código do município emissor informado na DPS é inexistente no cadastro de convênio',
  'Município emissor não conveniado',
  'O codigo IBGE do municipio emissor nao esta no convenio do Sistema Nacional (ou foi enviado errado).',
  true, 'Municipio emissor errado na config (FC: Iporã do Oeste 4207650 precisa estar como emissor; primeiro envio saiu com outro codigo).', 'Recusas 22/09; passou apos ajuste do municipio emissor.',
  'Conferir o codigo IBGE do municipio SEDE da empresa em Dados da Empresa. Se o municipio nao aderiu ao padrao nacional, a emissao e pelo sistema da prefeitura.', 'Eng. Chefe', 'Portal NFS-e Nacional (municipios conveniados)', NULL),
 ('nfse_nacional','nfse','E0370','grupo de informações de obra é obrigatório',
  'Serviço de obra sem dados da obra',
  'Para subitens 07.02, 07.04, 07.05 (obras) a DPS exige o grupo de obra (endereco da obra e/ou CNO).',
  true, 'Nota de construcao sem o bloco de obra preenchido.', 'Passou quando o bloco Obra do Hub foi preenchido (FC 421).',
  'Na tela de emissao, preencher "Obra do Hub" ou o endereco da obra (CEP, logradouro, cidade). CNO so se a obra tiver.', 'Eng. Chefe', 'Leiaute DPS nacional (grupo obra)', NULL),
 ('nfse_nacional','nfse','E0625','Não é permitido informar alíquota quando não há indicação de retenção',
  'Alíquota informada em ME/EPP sem retenção',
  'Optante ME/EPP (opSimpNac=3) sem retencao do ISS nao pode informar aliquota: o Simples calcula.',
  true, 'Sistema enviava aliquota para optante.', 'Corrigido na familia campo-SN (#1791); KGF/PS passaram.',
  'Empresa do Simples: deixar a aliquota em branco (o sistema ja faz isso). Se a nota tiver ISS retido pelo tomador, marcar Retido.', 'Eng. Chefe', 'Leiaute DPS nacional', 1791),
 ('nfse_nacional','nfse','E0712','Para ME/EPP o indicador de informação de valor total de tributos não pode ser informado',
  'Indicador de total de tributos em ME/EPP',
  'ME/EPP usa o percentual do Simples (pTotTribSN), nao o indicador.', true, 'Sistema enviava indicador_total_tributacao para optante 3.', 'Corrigido; PS nota 140 autorizada 22/07.',
  'Nada a fazer no cadastro; e regra do sistema por opcao do Simples.', 'Eng. Chefe', 'Leiaute DPS nacional', NULL),
 ('nfse_nacional','nfse','E0160','opção de situação perante o Simples Nacional, do prestador, informada na DPS não está de acordo',
  'Opção do Simples diferente do cadastro nacional',
  'A opcao informada (1/2/3) nao bate com a situacao da empresa no cadastro do Simples na competencia.', false, 'Hipotese: opcao_simples_nacional na Configuracao Fiscal desatualizada (empresa mudou de regime).', NULL,
  'Conferir com o contador a situacao da empresa no Simples na competencia da nota e ajustar a opcao na Configuracao Fiscal.', 'contador', 'Leiaute DPS nacional', NULL),
 ('nfse_nacional','nfse','E0166','obrigatorio o preenchimento do campo de regime de apuração dos tributos do SN',
  'ME/EPP sem regime de apuração',
  'Optante ME/EPP precisa informar o regime de apuracao do SN.', true, 'Config sem regime_apuracao_sn para empresa opcao 3.', 'KGF junho; passou apos preencher.',
  'Preencher o regime de apuracao do SN na Configuracao Fiscal (perguntar ao contador qual).', 'contador', 'Leiaute DPS nacional', NULL),
 ('nfse_nacional','nfse','E0207','CPF do tomador não encontrado no cadastro CPF',
  'CPF do tomador inválido',
  'O CPF informado nao existe na base da Receita.', true, 'CPF digitado errado no cadastro do cliente.', 'KGF junho.',
  'Corrigir o CPF no cadastro do cliente e reemitir.', 'operacao', 'Leiaute DPS nacional', NULL),
 ('nfse_nacional','nfse','E0010','A série informada na DPS não pertence à faixa',
  'Série fora da faixa do emissor',
  'A serie da DPS precisa estar na faixa definida para o tipo de emissor (ex.: 900 para emissao via API/terceiro).', false, 'Hipotese: serie_nfse_padrao configurada fora da faixa permitida.', NULL,
  'Conferir a serie na Configuracao Fiscal com o provedor (Focus) — normalmente 900 no padrao nacional.', 'provedor (Focus)', 'Leiaute DPS nacional', NULL),
 ('nfse_nacional','nfse','E0014','Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe',
  'Número de DPS já usado',
  'A combinacao serie+numero+municipio+CNPJ ja gerou uma NFS-e.', true, 'proxima_numeracao_nfse atras do que a Focus/Nacional ja consumiu.', 'PROPLAY 24/07: numeracao ajustada para 396.',
  'Consultar a ultima nota autorizada no painel do provedor e ajustar a proxima numeracao na Configuracao Fiscal.', 'Eng. Chefe', 'Leiaute DPS nacional', NULL),
 ('focusnfe','nfse','habilita_nfsen_producao','habilita_nfsen_producao',
  'Município no Ambiente Nacional sem a opção ativada na Focus',
  'A Focus exige ativar a opcao habilita_nfsen_producao no cadastro da empresa no painel deles.', true, 'Empresa cadastrada na Focus sem a flag.', 'KGF junho: passou apos ativar no painel Focus.',
  'Ativar habilita_nfsen_producao no painel da Focus (Empresas > empresa > editar).', 'provedor (Focus)', 'Focus (painel)', NULL),
 ('focusnfe','todos','PKCS12','PKCS12',
  'Certificado A1 ilegível',
  'O arquivo .pfx nao abre (senha errada, arquivo corrompido ou exportado sem chave privada).', true, 'Certificado gravado como ativo e valido ate 2027 mas ilegivel; ficou 16 dias assim (RD-74).', 'Contexto 26/06 e reprovacao em 25/09.',
  'Reenviar o .pfx exportado COM a chave privada e a senha correta; o sistema agora valida na entrada. Se persistir, pedir ao cliente o arquivo original da AC.', 'cliente / AC', 'Cofre + erp_certificados_a1', NULL),
 ('sefaz','nfe','IE_DEST','IE do destinatario nao informada',
  'IE do destinatário não informada (rej. 232)',
  'Destinatario contribuinte (CNPJ com IE) precisa ir com a IE e indIEDest=1.', true, 'Tres caminhos do builder (pedido, financeiro, manual/OS) montavam o destinatario sem IE. Corrigidos em #1739, #1800 e #1805.', 'KGF nota 623 autorizada 25/09 com IE 250891042 (RD-71: 3 caminhos).',
  'Conferir no cadastro do cliente: IE preenchida e "contribuinte_icms" correto. Se o cliente e isento, marcar isento.', 'operacao', 'MOC NF-e (indIEDest)', 1805),
 ('sefaz','nfe','966','icms_origem',
  'Origem da mercadoria ausente (rej. 966)',
  'Item sem origem (nacional/importada) no ICMS.', true, 'Campo enviado como "origem" em vez de "icms_origem".', 'FIX-NFE-ICMS-ORIGEM-v1 (jun).',
  'Nada no cadastro; se voltar, conferir a origem no cadastro do produto.', 'Eng. Chefe', 'MOC NF-e (orig)', NULL),
 ('sefaz','nfe','vBCSTRet','vBCSTRet, pST, vICMSSubstituto e vICMSSTRet',
  'Campos de ST retido ausentes (CST 60)',
  'Item com CST 60 (ICMS cobrado por ST) exige base/valor do ST retido.', false, 'Hipotese: nome de campo deduzido por busca web (icms_base_calculo_st_retido x icms_base_calculo_retido_st) — RD-72.', NULL,
  'Nao emitir com CST 60 ate o campo entrar com a Nota Tecnica citada. Pedir ao Eng. Chefe.', 'Eng. Chefe', 'NT 2018.005 (a citar)', NULL),
 ('sefaz','nfe','CFOP_IDDEST','CFOP de operacao interna e idDest',
  'CFOP interno com destinatário de outra UF',
  'CFOP 5.xxx e para operacao dentro do estado; destinatario em outra UF exige 6.xxx.', true, 'CFOP fixo do item nao acompanha a UF do destinatario.', 'Rejeicao 10/09.',
  'Conferir a UF do cliente e usar CFOP 6.xxx para fora do estado.', 'contador', 'MOC NF-e (idDest x CFOP)', NULL),
 ('sefaz','nfe','FRETE_TOTAL','Total do Frete difere',
  'Total do frete não bate com os itens',
  'Soma do frete dos itens difere do total da nota.', false, 'Hipotese: arredondamento na distribuicao do frete por item.', NULL,
  'Zerar o frete por item ou informar so no total; avisar o Eng. Chefe.', 'Eng. Chefe', 'MOC NF-e (vFrete)', NULL),
 ('sefaz','nfe','4226','Duplicidade de NF-e, com diferença na Chave de Acesso',
  'Número de NF-e já usado (duplicidade)',
  'Ja existe NF-e autorizada com o mesmo numero/serie e chave diferente.', true, 'proxima_numeracao_nfe atras da numeracao real.', 'KGF 23/09 e jun/12.',
  'Consultar a ultima nota autorizada e ajustar a proxima numeracao na Configuracao Fiscal.', 'Eng. Chefe', 'MOC NF-e (rej 204/4226)', NULL)
ON CONFLICT (provider, documento, codigo) DO UPDATE SET
  padrao_msg = EXCLUDED.padrao_msg, titulo = EXCLUDED.titulo, o_que_e = EXCLUDED.o_que_e, causa_provada = EXCLUDED.causa_provada,
  causa = EXCLUDED.causa, como_provado = EXCLUDED.como_provado, o_que_fazer = EXCLUDED.o_que_fazer, quem_contatar = EXCLUDED.quem_contatar,
  fonte = EXCLUDED.fonte, pr_numero = EXCLUDED.pr_numero, atualizado_em = now();

-- ocorrencias/ultima_vez a partir do historico real
WITH r AS (
  SELECT 'nfse' doc, motivo_rejeicao m, criado_em FROM erp_nfse_emitidas WHERE motivo_rejeicao IS NOT NULL
  UNION ALL SELECT 'nfe', motivo_rejeicao, criado_em FROM erp_nfe_emitidas WHERE motivo_rejeicao IS NOT NULL
), t AS (
  SELECT (fn_fiscal_erro_traduzir(r.doc, r.m)).id cid, count(*) n, max(r.criado_em) ult FROM r GROUP BY 1
)
UPDATE erp_fiscal_erro_catalogo c SET ocorrencias = t.n, ultima_vez_em = t.ult FROM t WHERE t.cid = c.id;

-- ---------- (2) PRONTUARIO DE CONEXAO ----------
CREATE OR REPLACE VIEW public.v_prontuario_conexao AS
WITH cert AS (
  SELECT DISTINCT ON (company_id) company_id, validade_fim, status, ultima_validacao_focus_ok, ultima_validacao_focus_erro
  FROM erp_certificados_a1 WHERE removido_em IS NULL ORDER BY company_id, validade_fim DESC
), nfe AS (
  SELECT company_id,
    max(criado_em) FILTER (WHERE status='autorizada') ult_autorizada,
    count(*) FILTER (WHERE status='autorizada') n_autorizadas,
    (array_agg(motivo_rejeicao ORDER BY criado_em DESC) FILTER (WHERE status='rejeitada'))[1] ult_rejeicao,
    max(criado_em) FILTER (WHERE status='rejeitada') ult_rejeicao_em
  FROM erp_nfe_emitidas GROUP BY company_id
), nfse AS (
  SELECT company_id,
    max(criado_em) FILTER (WHERE status='autorizada') ult_autorizada,
    count(*) FILTER (WHERE status='autorizada') n_autorizadas,
    (array_agg(motivo_rejeicao ORDER BY criado_em DESC) FILTER (WHERE status='rejeitada'))[1] ult_rejeicao,
    max(criado_em) FILTER (WHERE status='rejeitada') ult_rejeicao_em
  FROM erp_nfse_emitidas GROUP BY company_id
), fcfg AS (
  -- um provedor por empresa: o ATIVO (KGF/PS/Proplay tem gov_nfse inativo ao lado do focusnfe)
  SELECT DISTINCT ON (company_id) * FROM erp_fiscal_provider_config ORDER BY company_id, ativo DESC NULLS LAST, atualizado_em DESC NULLS LAST
), banco AS (
  SELECT company_id,
    jsonb_agg(jsonb_build_object('banco', banco_codigo, 'provider', provider, 'ambiente', ambiente, 'ativo', ativo,
      'estado', estado_conexao, 'ultimo_sync_em', ultimo_sync_em, 'ultimo_sync_status', ultimo_sync_status,
      'cert_expira_em', cert_expira_em, 'extrato', cap_extrato, 'boleto', cap_boleto, 'pagamento', cap_pagamento) ORDER BY ativo DESC, updated_at DESC) conexoes,
    bool_or(ativo) alguma_ativa,
    bool_or(ativo AND coalesce(cap_extrato,false)) extrato_ativo,
    min(cert_expira_em) FILTER (WHERE ativo) cert_expira_min,
    max(ultimo_sync_em) FILTER (WHERE ativo) ult_sync
  FROM erp_banco_provider_config GROUP BY company_id
)
SELECT
  c.id company_id, c.razao_social, c.cnpj, c.is_demo,
  -- FISCAL: cadastro
  c.regime_tributario, c.inscricao_estadual ie, c.inscricao_municipal im, c.uf_fiscal, c.cnae,
  f.provider fiscal_provider, f.ambiente fiscal_ambiente, f.ativo fiscal_ativo, f.opcao_simples_nacional opc_sn, f.regime_apuracao_sn,
  f.serie_nfe_padrao, f.proxima_numeracao_nfe, f.serie_nfse_padrao, f.proxima_numeracao_nfse,
  f.ultima_validacao_em fiscal_validado_em,
  -- FISCAL: certificado
  cert.validade_fim a1_validade_fim, cert.status a1_status, cert.ultima_validacao_focus_ok a1_focus_ok,
  (cert.validade_fim - current_date) a1_dias_restantes,
  -- FISCAL: historico
  nfe.n_autorizadas nfe_autorizadas, nfe.ult_autorizada nfe_ult_autorizada, nfe.ult_rejeicao nfe_ult_rejeicao, nfe.ult_rejeicao_em nfe_ult_rejeicao_em,
  (fn_fiscal_erro_traduzir('nfe', nfe.ult_rejeicao)).titulo nfe_ult_rejeicao_traduzida,
  nfse.n_autorizadas nfse_autorizadas, nfse.ult_autorizada nfse_ult_autorizada, nfse.ult_rejeicao nfse_ult_rejeicao, nfse.ult_rejeicao_em nfse_ult_rejeicao_em,
  (fn_fiscal_erro_traduzir('nfse', nfse.ult_rejeicao)).titulo nfse_ult_rejeicao_traduzida,
  -- FISCAL: o que falta (RD-74)
  ARRAY_REMOVE(ARRAY[
    CASE WHEN f.id IS NULL THEN 'config fiscal' END,
    CASE WHEN f.id IS NOT NULL AND NOT coalesce(f.ativo,false) THEN 'provedor inativo' END,
    CASE WHEN cert.company_id IS NULL THEN 'certificado A1' END,
    CASE WHEN cert.validade_fim IS NOT NULL AND cert.validade_fim < current_date THEN 'A1 vencido' END,
    CASE WHEN cert.validade_fim IS NOT NULL AND cert.validade_fim BETWEEN current_date AND current_date + 15 THEN 'A1 vence em 15d' END,
    CASE WHEN cert.ultima_validacao_focus_ok IS FALSE THEN 'A1 ilegivel na Focus' END,
    CASE WHEN nullif(btrim(c.inscricao_municipal),'') IS NULL THEN 'inscricao municipal' END,
    CASE WHEN nullif(btrim(c.uf_fiscal),'') IS NULL THEN 'UF fiscal' END,
    CASE WHEN c.regime_tributario IS NULL THEN 'regime tributario' END,
    CASE WHEN f.opcao_simples_nacional = 3 AND f.regime_apuracao_sn IS NULL THEN 'regime apuracao SN' END,
    CASE WHEN f.id IS NOT NULL AND coalesce(nfe.n_autorizadas,0) + coalesce(nfse.n_autorizadas,0) = 0 THEN 'nenhuma emissao real autorizada (RD-59)' END
  ], NULL) fiscal_faltando,
  -- BANCO
  banco.conexoes banco_conexoes, banco.alguma_ativa banco_ativo, banco.ult_sync banco_ult_sync, banco.cert_expira_min banco_cert_expira,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN banco.company_id IS NULL THEN 'sem conexao bancaria' END,
    CASE WHEN banco.company_id IS NOT NULL AND NOT coalesce(banco.alguma_ativa,false) THEN 'conexao inativa' END,
    CASE WHEN banco.extrato_ativo AND banco.ult_sync IS NULL THEN 'extrato ativo, nunca sincronizou' END,
    CASE WHEN banco.extrato_ativo AND banco.ult_sync < now() - interval '3 days' THEN 'sync parado >3d' END,
    CASE WHEN banco.cert_expira_min IS NOT NULL AND banco.cert_expira_min BETWEEN current_date AND current_date + 15 THEN 'cert banco vence em 15d' END,
    CASE WHEN banco.cert_expira_min IS NOT NULL AND banco.cert_expira_min < current_date THEN 'cert banco vencido' END
  ], NULL) banco_faltando
FROM companies c
LEFT JOIN fcfg f ON f.company_id = c.id
LEFT JOIN cert ON cert.company_id = c.id
LEFT JOIN nfe ON nfe.company_id = c.id
LEFT JOIN nfse ON nfse.company_id = c.id
LEFT JOIN banco ON banco.company_id = c.id;
COMMENT ON VIEW public.v_prontuario_conexao IS 'Prontuario de conexao por empresa (fiscal + banco): estado real, ultimo erro traduzido, o que falta para funcionar. Abrir ANTES de investigar ou onboardar.';
GRANT SELECT ON public.v_prontuario_conexao TO authenticated;
