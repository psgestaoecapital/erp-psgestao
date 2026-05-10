-- ═══════════════════════════════════════════════════════════════
-- ROADMAP V1: Tabela de marcos + 22 marcos iniciais + 2 views
-- ═══════════════════════════════════════════════════════════════
-- Autor: Claude (Engenheiro Chefe Senior)
-- Data: 10/05/2026 sessao 5 | Decisao estrategica CEO
--
-- OBJETIVO:
-- Criar bussola estrategica viva. CEO sente perda de visao do todo
-- enquanto corrige bugs no chao da fabrica. Roadmap responde
-- "onde estamos? falta o que pra vender?" em todas as sessoes.
--
-- ESTRUTURA:
-- 4 Trilhas paralelas:
-- - A: Core Plataforma (foundation tecnica)
-- - B: Comercial IA + Humano
-- - C: Suporte ao Cliente IA
-- - D: Suporte Tecnico IA + Operacao Recorrente
--
-- 22 marcos no total (5-7 por trilha) com criterio de "feito" claro.
--
-- IDEMPOTENTE. CUSTO R$ 0/mes. ZERO impacto em producao (so adiciona).
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- ETAPA 1: Tabela erp_roadmap_marcos
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.erp_roadmap_marcos (
  id text PRIMARY KEY,  -- ex: M.A.1, M.B.3

  trilha text NOT NULL CHECK (trilha IN ('A_core', 'B_comercial', 'C_suporte', 'D_operacao')),
  trilha_nome text NOT NULL,
  ordem_na_trilha integer NOT NULL,

  titulo text NOT NULL,
  descricao text NOT NULL,
  criterio_pronto text NOT NULL,

  status text NOT NULL DEFAULT 'nao_iniciado'
    CHECK (status IN ('nao_iniciado', 'em_andamento', 'pausado', 'concluido', 'cancelado')),
  percentual_concluido integer NOT NULL DEFAULT 0 CHECK (percentual_concluido BETWEEN 0 AND 100),

  iniciado_em date,
  concluido_em date,
  estimativa_conclusao date,

  ondas_relacionadas text[],
  prs_relacionados text[],
  regras_estrela_polar integer[],

  bloqueador text,
  observacao text,

  prioridade text NOT NULL DEFAULT 'media'
    CHECK (prioridade IN ('critica', 'alta', 'media', 'baixa')),

  caminho_critico boolean NOT NULL DEFAULT false,

  criado_em timestamptz DEFAULT NOW(),
  atualizado_em timestamptz DEFAULT NOW()
);

COMMENT ON TABLE public.erp_roadmap_marcos IS
'Roadmap V1 PS Gestao - 22 marcos em 4 trilhas (Core/Comercial/Suporte/Operacao). Bussola estrategica viva. Atualizada automaticamente conforme avancos. Criada em 10/05/2026.';

CREATE INDEX IF NOT EXISTS idx_roadmap_trilha ON public.erp_roadmap_marcos(trilha, ordem_na_trilha);
CREATE INDEX IF NOT EXISTS idx_roadmap_status ON public.erp_roadmap_marcos(status, prioridade);
CREATE INDEX IF NOT EXISTS idx_roadmap_caminho_critico ON public.erp_roadmap_marcos(caminho_critico, status) WHERE caminho_critico = true;

ALTER TABLE public.erp_roadmap_marcos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_can_read_roadmap" ON public.erp_roadmap_marcos;
CREATE POLICY "auth_can_read_roadmap" ON public.erp_roadmap_marcos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_role_writes_roadmap" ON public.erp_roadmap_marcos;
CREATE POLICY "service_role_writes_roadmap" ON public.erp_roadmap_marcos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_roadmap_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_roadmap_atualizado_em ON public.erp_roadmap_marcos;
CREATE TRIGGER trg_roadmap_atualizado_em
BEFORE UPDATE ON public.erp_roadmap_marcos
FOR EACH ROW EXECUTE FUNCTION public.fn_roadmap_atualizado_em();

-- ───────────────────────────────────────────────────────────────
-- ETAPA 2: Popular 22 marcos iniciais
-- ───────────────────────────────────────────────────────────────

INSERT INTO public.erp_roadmap_marcos (
  id, trilha, trilha_nome, ordem_na_trilha,
  titulo, descricao, criterio_pronto,
  status, percentual_concluido,
  ondas_relacionadas, prs_relacionados, regras_estrela_polar,
  prioridade, caminho_critico,
  observacao
) VALUES

-- ═══ TRILHA A — CORE PLATAFORMA (6 marcos) ═══

('M.A.1', 'A_core', 'Core Plataforma', 1,
 'Foundation tecnica V1.5/V1.6',
 'Modelagem de dados, multi-tenant, planos comerciais catalogados',
 'V1.6 vigente, 12 planos catalogados, 15 tenants ativos com subscriptions, MRR teorico R$ 23.434/mes',
 'concluido', 100,
 ARRAY['1.1', '1.2'], ARRAY['1.2.1', '1.2.2', '1.2.3a-c', '1.2.4a-b', '1.2.5'], ARRAY[6, 18, 19, 31],
 'critica', true,
 'Concluido em 09/05/2026 sessao 1+2'),

('M.A.2', 'A_core', 'Core Plataforma', 2,
 'RBAC granular operacional (backend)',
 'Sistema de permissoes role x company x action funcionando via fn_user_can',
 'fn_user_can + tenant_user_roles + 1.201 permissoes operacionais em producao',
 'concluido', 100,
 ARRAY['1.3'], ARRAY['1.3.1', '1.3.1+', '1.3.2'], ARRAY[18, 19],
 'critica', true,
 'Backend 100%. Falta integracao frontend (M.A.3 separado)'),

('M.A.3', 'A_core', 'Core Plataforma', 3,
 'RBAC integrado no frontend',
 'Hooks React useUserPermissions + gates UI ativos em todas as telas',
 'Botoes de acao habilitados/desabilitados conforme permissao do usuario logado',
 'nao_iniciado', 0,
 ARRAY['1.3'], ARRAY['1.3.3'], ARRAY[18, 19],
 'alta', false,
 'Adiado para depois de Onda 4 - decisao CEO sessao 4'),

('M.A.4', 'A_core', 'Core Plataforma', 4,
 'Truth Auditor 24/7 ativo',
 'Sistema de auditoria continua de integridade dos numeros operando em producao',
 '12 regras Truth Auditor + cron rodando + alertas chegando + 0 divergencia psgc_dre vs erp_receber em todas as 14 empresas',
 'em_andamento', 60,
 ARRAY['4'], ARRAY['4.1', '4.2', '4.3a', '4.3b', '4.3b-fix'], ARRAY[34, 35, 36],
 'critica', true,
 'PR 4.1 + 4.2 + 4.3a + 4.3b aplicados. 4.3b-fix gerado, aguarda aplicacao. 4.3c+ sequencia.'),

('M.A.5', 'A_core', 'Core Plataforma', 5,
 'Compliance LGPD + INPI + Reforma Tributaria',
 'Plataforma legal: LGPD certificado, INPI registrado, IBS+CBS preparado para 2027',
 'Certificado ICP-Brasil ativo + INPI registro concluido + tabela legislacao_vigente populada com IBS estadual/municipal/CBS + Privacy Policy + Terms publicados',
 'em_andamento', 35,
 ARRAY['4'], ARRAY['4.3a (legislacao_vigente seed)'], ARRAY[34],
 'alta', true,
 'INPI declaracao verdade pendente ICP-Brasil. legislacao_vigente criada com 7 seed federais (PR 4.3a). Falta UF/IBS/CBS.'),

('M.A.6', 'A_core', 'Core Plataforma', 6,
 'Insight Auditor + Smoke Tester ativos',
 'Auditor de UX/oportunidades 1x/noite + Smoke Tester sob demanda em staging',
 'Insight Auditor gerando user stories noturnas + Smoke Tester executando testes funcionais sob demanda',
 'nao_iniciado', 0,
 ARRAY['5', '6'], NULL, ARRAY[34],
 'media', false,
 'Ondas 5 e 6 do Ecossistema Agentes V1.7'),

-- ═══ TRILHA B — COMERCIAL IA + HUMANO (6 marcos) ═══

('M.B.1', 'B_comercial', 'Comercial IA + Humano', 1,
 'Site institucional + landing pages publicadas',
 'Site responsivo apresentando os 12 planos, casos de uso, prova social',
 'erp-psgestao.vercel.app substituido por site.psgestao.com com landing por persona (Comercio, Servicos, BPO, Wealth)',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'critica', true,
 'Caminho critico para venda recorrente'),

('M.B.2', 'B_comercial', 'Comercial IA + Humano', 2,
 'Funil de aquisicao automatizado',
 'Lead chega -> qualificacao IA -> demo agendada -> trial -> conversao',
 'CRM operacional + pipeline 5 estagios + automacoes (email, WhatsApp) + tracking conversao',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'critica', true,
 'Stephany lidera. CRM pode ser HubSpot free ou propio'),

('M.B.3', 'B_comercial', 'Comercial IA + Humano', 3,
 'IA comercial qualificando leads',
 'Chatbot (site + WhatsApp) qualifica leads automaticamente, agenda demos, responde duvidas pre-vendas',
 'IA atende 100% dos leads inbound, 60%+ qualificados sem human-in-the-loop',
 'nao_iniciado', 0,
 NULL, NULL, ARRAY[34],
 'alta', false,
 'Apos M.B.1 e M.B.2 estabelecidos'),

('M.B.4', 'B_comercial', 'Comercial IA + Humano', 4,
 'Time comercial humano operando',
 'Stephany ou outro comercial fechando deals (closing humano apos qualificacao IA)',
 'Pelo menos 1 fundador OU 1 comercial dedicado fechando 5+ deals/mes',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'alta', true,
 'Indispensavel para enterprise/MFO. SMB pode ser self-service.'),

('M.B.5', 'B_comercial', 'Comercial IA + Humano', 5,
 'Onboarding self-service de cliente novo',
 'Cliente assina online, configura empresa, importa dados, comeca a usar - sem human-in-the-loop',
 'Trial em ate 5 minutos: assinatura -> CNPJ -> import Omie -> primeiro DRE renderizado',
 'nao_iniciado', 0,
 NULL, NULL, ARRAY[34],
 'critica', true,
 'Critico para escala. Sem isso, cada cliente novo = horas de Jordana.'),

('M.B.6', 'B_comercial', 'Comercial IA + Humano', 6,
 'Primeiros 10 clientes novos pagantes recorrentes',
 'Clientes que NAO sao do circulo PS Gestao Capital (publico aberto)',
 '10 contratos ativos vindos do funil publico (nao sociedade/conhecidos), MRR > R$ 5K/mes deles',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'critica', true,
 'Marco da prova de mercado. Atualmente 15 tenants sao todos circulo proximo.'),

-- ═══ TRILHA C — SUPORTE AO CLIENTE IA (4 marcos) ═══

('M.C.1', 'C_suporte', 'Suporte ao Cliente IA', 1,
 'Base de conhecimento estruturada',
 'Wiki com tutoriais, perguntas frequentes, casos de uso de cada modulo',
 'Min 50 artigos cobrindo as 14 areas ativas + indexacao para retrieval IA',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'alta', true,
 'Pre-requisito para IA conversacional treinada'),

('M.C.2', 'C_suporte', 'Suporte ao Cliente IA', 2,
 'Consultor IA dentro do app (existe parcial)',
 'IA conversacional dentro do PS Gestao respondendo duvidas operacionais (existe versao basica)',
 'IA resolve 60%+ duvidas operacionais sem escalar humano',
 'em_andamento', 25,
 NULL, NULL, ARRAY[34],
 'alta', false,
 'Versao basica ja existe. Falta evoluir para 60% resolucao.'),

('M.C.3', 'C_suporte', 'Suporte ao Cliente IA', 3,
 'Tutoriais contextuais + onboarding guiado',
 'Cliente novo recebe walkthrough da plataforma. Tutoriais aparecem na hora certa por modulo.',
 'Walkthrough automatico no primeiro login + tutoriais contextuais em 14 modulos',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'media', false,
 'Apos M.C.1 base de conhecimento'),

('M.C.4', 'C_suporte', 'Suporte ao Cliente IA', 4,
 'Escalacao IA -> Humano operacional',
 'Quando IA nao resolve, abre ticket para humano. Humano usa mesma base de conhecimento.',
 'SLA primeira resposta humana <= 4h util + 80% tickets resolvidos pela IA antes de escalar',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'media', false,
 'Apos M.C.2 IA madura'),

-- ═══ TRILHA D — SUPORTE TECNICO + OPERACAO RECORRENTE (6 marcos) ═══

('M.D.1', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 1,
 'NOC + monitoring 24/7',
 'Painel de saude do sistema, alertas automaticos, uptime tracking',
 'NOC dashboard ativo + uptime > 99.5% + Truth Auditor + Insight Auditor rodando 24h',
 'em_andamento', 40,
 ARRAY['4'], ARRAY['4.1'], NULL,
 'alta', false,
 'NOC ja existe. Truth Auditor sendo construido (M.A.4)'),

('M.D.2', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 2,
 'BPO Financeiro recorrente operando',
 'Jordana lidera operacao BPO para clientes contratantes (BPO Comercio, BPO Servicos)',
 'Pelo menos 5 clientes ativos em BPO + Jordana com SLA mensal de fechamento operacional',
 'em_andamento', 70,
 ARRAY['1.1', '1.2'], NULL, NULL,
 'alta', false,
 'Ja existem clientes BPO ativos (Tryo group, PDOIS, Mariele). Falta SLA formalizado e escala.'),

('M.D.3', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 3,
 'Suporte tecnico humano com escalacao IA',
 'Quando algo tecnico quebra, IA tenta auto-corrigir. Se nao consegue, abre ticket pra Gilberto/Andre.',
 'IA auto-corrige 60%+ problemas tecnicos nao-criticos (re-trigger ETL, retry API, etc)',
 'nao_iniciado', 0,
 NULL, NULL, ARRAY[34],
 'media', false,
 'Apos M.A.4 Truth Auditor maduro'),

('M.D.4', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 4,
 'Backup + DR (Disaster Recovery) automatizado',
 'Backup diario Google Drive + restore testado + RPO < 24h + RTO < 4h',
 'Backup semanal Drive funcionando + 1 restore drill mensal sem downtime',
 'nao_iniciado', 0,
 NULL, NULL, ARRAY[34],
 'critica', true,
 'Pendencia critica - cliente paga, dado precisa estar seguro'),

('M.D.5', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 5,
 'SLA formalizado + indicadores publicos',
 'Status page publico (status.psgestao.com) + SLA contratual nas assinaturas + relatorio mensal',
 'Status page com uptime real + SLA 99.5% nos contratos novos + report mensal automatizado',
 'nao_iniciado', 0,
 NULL, NULL, NULL,
 'media', false,
 'Apos M.D.1 NOC maduro'),

('M.D.6', 'D_operacao', 'Suporte Tecnico + Operacao Recorrente', 6,
 'Operacao escalavel: 50+ clientes sem dobrar equipe',
 'Plataforma + agentes IA permitem operar 50+ clientes ativos com mesma equipe (Gilberto, Andre, Stephany, Jordana, Rodrigo)',
 '50 clientes ativos + custo operacional/cliente decrescente + NPS estavel',
 'nao_iniciado', 0,
 NULL, NULL, ARRAY[34],
 'critica', true,
 'Marco da escalabilidade real. Define se PS Gestao pode crescer ou estagna em 15 clientes.')

ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- ETAPA 3: View v_roadmap_snapshot (resumo executivo)
-- ───────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_roadmap_snapshot CASCADE;

CREATE VIEW public.v_roadmap_snapshot AS
SELECT
  trilha,
  trilha_nome,
  COUNT(*) AS total_marcos,
  COUNT(*) FILTER (WHERE status = 'concluido') AS concluidos,
  COUNT(*) FILTER (WHERE status = 'em_andamento') AS em_andamento,
  COUNT(*) FILTER (WHERE status = 'nao_iniciado') AS nao_iniciados,
  ROUND(AVG(percentual_concluido)::numeric, 1) AS percentual_medio,
  ROUND((COUNT(*) FILTER (WHERE status = 'concluido')::numeric / COUNT(*)::numeric * 100), 1) AS percentual_concluidos,
  COUNT(*) FILTER (WHERE caminho_critico = true) AS marcos_caminho_critico,
  COUNT(*) FILTER (WHERE caminho_critico = true AND status = 'concluido') AS criticos_concluidos
FROM erp_roadmap_marcos
GROUP BY trilha, trilha_nome
ORDER BY trilha;

COMMENT ON VIEW public.v_roadmap_snapshot IS
'Snapshot executivo do roadmap por trilha. Usada no Protocolo de Abertura V1.8.';

-- ───────────────────────────────────────────────────────────────
-- ETAPA 4: View v_roadmap_proximos_marcos (proximos passos)
-- ───────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_roadmap_proximos_marcos CASCADE;

CREATE VIEW public.v_roadmap_proximos_marcos AS
SELECT
  m.id,
  m.trilha,
  m.titulo,
  m.descricao,
  m.criterio_pronto,
  m.status,
  m.percentual_concluido,
  m.prioridade,
  m.caminho_critico,
  m.bloqueador,
  m.observacao,
  m.ondas_relacionadas,
  m.prs_relacionados
FROM erp_roadmap_marcos m
WHERE m.status IN ('em_andamento', 'nao_iniciado')
  AND m.caminho_critico = true
ORDER BY
  CASE m.status
    WHEN 'em_andamento' THEN 1
    WHEN 'nao_iniciado' THEN 2
    ELSE 3
  END,
  CASE m.prioridade
    WHEN 'critica' THEN 1
    WHEN 'alta' THEN 2
    WHEN 'media' THEN 3
    ELSE 4
  END,
  m.trilha,
  m.ordem_na_trilha;

COMMENT ON VIEW public.v_roadmap_proximos_marcos IS
'Lista priorizada dos proximos marcos do caminho critico. Usada no briefing de abertura.';
