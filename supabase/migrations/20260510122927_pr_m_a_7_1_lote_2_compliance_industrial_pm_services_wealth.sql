-- ═══════════════════════════════════════════════════════════════
-- PR M.A.7.1 LOTE 2: compliance (3) + industrial (3) + pm (4) +
--                    services (4) + wealth (1) + foundation (2) = 17 modulos
-- ═══════════════════════════════════════════════════════════════

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos, marcos_roadmap, observacao) VALUES

-- ═══ COMPLIANCE (3 módulos) ═══

-- compliance_epi (NR-6 EPI)
('F.compliance_epi.cadastro_epi', 'compliance_epi', 'compliance', 'Catalogo de EPIs', 'Cadastro de EPIs com CA (Certificado Aprovacao), validade, fornecedor', 'previsto', 0, 'critica', ARRAY['v15_compliance','v15_industrial_pequena','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], 'NR-6 obrigatorio'),
('F.compliance_epi.entrega_assinatura', 'compliance_epi', 'compliance', 'Entrega EPI com assinatura', 'Termo de entrega com assinatura digital + foto + hash integridade', 'previsto', 0, 'critica', ARRAY['v15_compliance','v15_industrial_pequena','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], 'Backend pronto via epi_assinatura table'),
('F.compliance_epi.rastreabilidade_funcionario', 'compliance_epi', 'compliance', 'Historico EPI por funcionario', 'Rastreabilidade completa para fiscalizacao MTE', 'previsto', 0, 'alta', ARRAY['v15_compliance','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.compliance_epi.alerta_validade', 'compliance_epi', 'compliance', 'Alerta validade CA', 'Notifica quando CA do EPI esta proximo de vencer', 'previsto', 0, 'alta', ARRAY['v15_compliance','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),

-- compliance_esocial
('F.compliance_esocial.eventos_periodicos', 'compliance_esocial', 'compliance', 'Eventos periodicos S-1200', 'Geracao XML eventos folha mensal eSocial', 'previsto', 0, 'critica', ARRAY['v15_compliance'], ARRAY['M.A.7'], 'Obrigatorio MTE'),
('F.compliance_esocial.eventos_iniciais', 'compliance_esocial', 'compliance', 'Eventos iniciais (S-2200, S-2206)', 'Admissao, alteracao contratual, mudanca cargo', 'previsto', 0, 'critica', ARRAY['v15_compliance'], ARRAY['M.A.7'], NULL),
('F.compliance_esocial.afastamentos', 'compliance_esocial', 'compliance', 'Afastamentos (S-2230)', 'Atestado, ferias, licenca maternidade, INSS', 'previsto', 0, 'alta', ARRAY['v15_compliance'], ARRAY['M.A.7'], NULL),
('F.compliance_esocial.transmissao_gov', 'compliance_esocial', 'compliance', 'Transmissao gov.br', 'Envio XMLs assinados via certificado digital A1/A3', 'previsto', 0, 'critica', ARRAY['v15_compliance'], ARRAY['M.A.7'], 'Bloqueio: ICP-Brasil'),

-- compliance_treinamentos
('F.compliance_treinamentos.matriz_nr', 'compliance_treinamentos', 'compliance', 'Matriz treinamentos por NR', 'Mapeamento NRs aplicaveis por funcao (NR-10, NR-12, NR-35)', 'previsto', 0, 'alta', ARRAY['v15_compliance','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.compliance_treinamentos.cronograma_reciclagem', 'compliance_treinamentos', 'compliance', 'Cronograma reciclagem', 'Lembrete reciclagem periodica (anual, bienal)', 'previsto', 0, 'alta', ARRAY['v15_compliance','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.compliance_treinamentos.certificados', 'compliance_treinamentos', 'compliance', 'Certificados digitais', 'Geracao certificados para funcionario com QR validacao', 'previsto', 0, 'media', ARRAY['v15_compliance'], ARRAY['M.A.7'], NULL),

-- ═══ INDUSTRIAL (3 módulos) ═══

-- industrial_cmms
('F.industrial_cmms.cadastro_ativos', 'industrial_cmms', 'operacional', 'Cadastro de ativos', 'Equipamentos, maquinas, infraestrutura com TAG, fabricante, modelo', 'previsto', 0, 'critica', ARRAY['v15_industrial_pequena','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_cmms.manutencao_preventiva', 'industrial_cmms', 'operacional', 'Manutencao preventiva', 'Plano preventivo por horas/km/ciclos com alertas', 'previsto', 0, 'critica', ARRAY['v15_industrial_pequena','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_cmms.os_manutencao', 'industrial_cmms', 'operacional', 'OS de manutencao', 'Ordem de servico interna para tecnico de manutencao', 'previsto', 0, 'alta', ARRAY['v15_industrial_pequena','v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_cmms.indicadores_mtbf_mttr', 'industrial_cmms', 'gerencial', 'Indicadores MTBF/MTTR', 'Tempo medio entre falhas e tempo medio reparo por ativo', 'previsto', 0, 'alta', ARRAY['v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),

-- industrial_iot
('F.industrial_iot.coleta_sensores', 'industrial_iot', 'operacional', 'Coleta dados sensores', 'Integracao MQTT/HTTP de sensores temperatura, vibracao, energia', 'previsto', 0, 'alta', ARRAY['v15_industrial_grande'], ARRAY['M.A.7'], 'Diferencial enterprise'),
('F.industrial_iot.alertas_anomalia', 'industrial_iot', 'operacional', 'Alertas anomalia', 'Notifica fora do range esperado (ex: temperatura motor > 80°C)', 'previsto', 0, 'alta', ARRAY['v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_iot.dashboard_realtime', 'industrial_iot', 'gerencial', 'Dashboard tempo real', 'Visao chao fabrica com status equipamentos', 'previsto', 0, 'media', ARRAY['v15_industrial_grande'], ARRAY['M.A.7'], NULL),

-- industrial_qualidade
('F.industrial_qualidade.nao_conformidade', 'industrial_qualidade', 'compliance', 'Registro nao conformidade', 'NC com causa raiz, acao corretiva, responsavel', 'previsto', 0, 'alta', ARRAY['v15_industrial_media','v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_qualidade.iso_9001', 'industrial_qualidade', 'compliance', 'Documentos ISO 9001', 'Procedimentos, instrucoes trabalho, registros qualidade', 'previsto', 0, 'alta', ARRAY['v15_industrial_grande'], ARRAY['M.A.7'], NULL),
('F.industrial_qualidade.auditorias', 'industrial_qualidade', 'compliance', 'Auditorias internas', 'Cronograma + checklists + relatorios auditoria', 'previsto', 0, 'media', ARRAY['v15_industrial_grande'], ARRAY['M.A.7'], NULL),

-- ═══ PM / Project Management (4 módulos) ═══

-- pm_jobs
('F.pm_jobs.cadastro_job', 'pm_jobs', 'operacional', 'Cadastro de Job', 'Job/projeto com cliente, briefing, prazo, valor', 'previsto', 0, 'critica', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], 'Core PM'),
('F.pm_jobs.kanban_jobs', 'pm_jobs', 'operacional', 'Kanban de jobs', 'Visao kanban: Brief, Producao, Aprovacao, Concluido', 'previsto', 0, 'alta', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),
('F.pm_jobs.tarefas_subjobs', 'pm_jobs', 'operacional', 'Tarefas e sub-jobs', 'Decomposicao em tarefas atribuiveis', 'previsto', 0, 'alta', ARRAY['v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),

-- pm_briefings
('F.pm_briefings.formulario_brief', 'pm_briefings', 'operacional', 'Formulario brief cliente', 'Cliente preenche brief estruturado online', 'previsto', 0, 'alta', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),
('F.pm_briefings.aprovacao_brief', 'pm_briefings', 'operacional', 'Aprovacao do brief', 'Cliente aprova ou solicita ajustes antes producao', 'previsto', 0, 'alta', ARRAY['v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),

-- pm_apontamento_horas
('F.pm_apontamento_horas.timesheet', 'pm_apontamento_horas', 'operacional', 'Timesheet por job', 'Equipe registra horas por job/tarefa', 'previsto', 0, 'critica', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),
('F.pm_apontamento_horas.cronometro', 'pm_apontamento_horas', 'operacional', 'Cronometro start/stop', 'Time tracker em tempo real', 'previsto', 0, 'alta', ARRAY['v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),

-- pm_margem_job
('F.pm_margem_job.calculo_margem', 'pm_margem_job', 'gerencial', 'Calculo margem por job', 'Receita - (horas x custo hora) - despesas externas = margem', 'previsto', 0, 'critica', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),
('F.pm_margem_job.ranking_jobs', 'pm_margem_job', 'gerencial', 'Ranking jobs por margem', 'Top jobs lucrativos vs deficitarios', 'previsto', 0, 'alta', ARRAY['v15_pm_media','v15_pm_grande'], ARRAY['M.A.7'], NULL),
('F.pm_margem_job.alerta_margem_negativa', 'pm_margem_job', 'gerencial', 'Alerta margem negativa', 'Notifica antes do job virar prejuizo', 'previsto', 0, 'alta', ARRAY['v15_pm_grande'], ARRAY['M.A.7'], NULL),

-- ═══ SERVICES (4 módulos) ═══

-- services_contratos_recorrentes
('F.services_contratos.cadastro_contrato', 'services_contratos_recorrentes', 'comercial', 'Cadastro contrato recorrente', 'Contrato mensal/anual com cliente, valor, vigencia', 'previsto', 0, 'critica', ARRAY['v15_services_solo','v15_services_equipe','v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], 'Core Services'),
('F.services_contratos.renovacao_automatica', 'services_contratos_recorrentes', 'comercial', 'Renovacao automatica', 'Renova contrato no vencimento se nao houver cancelamento', 'previsto', 0, 'alta', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_contratos.reajuste_anual', 'services_contratos_recorrentes', 'comercial', 'Reajuste anual indexado', 'Reajuste IPCA/IGPM automatico no aniversario', 'previsto', 0, 'media', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),

-- services_cobranca_recorrente
('F.services_cobranca.boleto_recorrente', 'services_cobranca_recorrente', 'financeiro', 'Boleto recorrente', 'Geracao automatica boleto mensal', 'previsto', 0, 'critica', ARRAY['v15_services_solo','v15_services_equipe','v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_cobranca.pix_recorrente', 'services_cobranca_recorrente', 'financeiro', 'Pix recorrente', 'Cobranca via Pix automatica', 'previsto', 0, 'alta', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_cobranca.regua_inadimplencia', 'services_cobranca_recorrente', 'financeiro', 'Regua de inadimplencia', 'Email/WhatsApp automatico em D+3, D+10, D+30', 'previsto', 0, 'alta', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),

-- services_nfse
('F.services_nfse.emissao_nfse', 'services_nfse', 'fiscal', 'Emissao NFS-e', 'Geracao NFS-e prefeitura local', 'previsto', 0, 'critica', ARRAY['v15_services_solo','v15_services_equipe','v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_nfse.cancelamento_nfse', 'services_nfse', 'fiscal', 'Cancelamento NFS-e', 'Cancelamento dentro prazo prefeitura', 'previsto', 0, 'critica', ARRAY['v15_services_solo','v15_services_equipe','v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_nfse.multimunicipios', 'services_nfse', 'fiscal', 'Multi municipios', 'Suporte a varios padroes prefeitura (>50 cidades)', 'previsto', 0, 'alta', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], 'Diferencial competitivo'),

-- services_dashboard_saas
('F.services_dashboard.mrr_arr', 'services_dashboard_saas', 'gerencial', 'MRR e ARR', 'Monthly/Annual Recurring Revenue tracking', 'previsto', 0, 'critica', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], 'Critico SaaS'),
('F.services_dashboard.churn', 'services_dashboard_saas', 'gerencial', 'Taxa de churn', 'Cancelamentos / total ativos por periodo', 'previsto', 0, 'critica', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_dashboard.ltv_cac', 'services_dashboard_saas', 'gerencial', 'LTV e CAC', 'Lifetime Value vs Customer Acquisition Cost', 'previsto', 0, 'alta', ARRAY['v15_services_agencia','v15_services_enterprise'], ARRAY['M.A.7'], NULL),
('F.services_dashboard.cohort', 'services_dashboard_saas', 'gerencial', 'Analise de cohort', 'Retencao por safra de clientes', 'previsto', 0, 'media', ARRAY['v15_services_enterprise'], ARRAY['M.A.7'], NULL),

-- ═══ WEALTH (1 módulo) ═══

-- wealth (Wealth/MFO - regulado CVM)
('F.wealth.cadastro_cliente_wealth', 'wealth', 'wealth', 'Cadastro cliente Wealth', 'KYC + perfil investidor + suitability ANBIMA', 'previsto', 0, 'critica', ARRAY['wealth'], ARRAY['M.A.7'], 'Plano legado, normalizar M.A.7.2'),
('F.wealth.consolidacao_patrimonio', 'wealth', 'wealth', 'Consolidacao patrimonio', 'Visao unificada multi-corretora, multi-banco', 'previsto', 0, 'critica', ARRAY['wealth'], ARRAY['M.A.7'], NULL),
('F.wealth.rebalanceamento', 'wealth', 'wealth', 'Rebalanceamento carteira', 'Sugestoes baseadas em alocacao alvo', 'previsto', 0, 'alta', ARRAY['wealth'], ARRAY['M.A.7'], NULL),
('F.wealth.relatorio_cvm', 'wealth', 'wealth', 'Relatorio mensal CVM', 'Performance mensal padrao Anbima/CVM 19', 'previsto', 0, 'critica', ARRAY['wealth'], ARRAY['M.A.7'], NULL),

-- ═══ FOUNDATION (2 módulos: dev, fale_ps) ═══

-- dev (interno)
('F.dev.deploy_automatizado', 'dev', 'admin', 'Deploy automatizado', 'CI/CD via Vercel + GitHub Actions', 'pronto', 100, 'media', ARRAY['v15_pm_grande'], ARRAY['M.A.7'], 'Uso interno PS Gestao'),

-- fale_ps (suporte)
('F.fale_ps.chat_suporte', 'fale_ps', 'ia_atendimento', 'Chat com suporte PS', 'Cliente conversa com suporte via chat in-app', 'previsto', 0, 'alta', ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande','v15_services_solo','v15_services_equipe','v15_services_pro','v15_services_agencia','v15_services_enterprise','v15_commerce_basico','v15_commerce_pro','v15_commerce_enterprise','v15_industrial_pequena','v15_industrial_media','v15_industrial_grande','v15_oficina_pequena','v15_oficina_media','v15_oficina_grande','v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4','v15_bpo','v15_compliance','v15_custeio_a'], ARRAY['M.A.7'], 'Disponivel todos planos V1.5'),
('F.fale_ps.tickets', 'fale_ps', 'ia_atendimento', 'Sistema de tickets', 'Ticket com SLA, priorizacao, historico', 'previsto', 0, 'media', ARRAY['v15_services_pro','v15_services_agencia','v15_services_enterprise','v15_commerce_enterprise','v15_industrial_grande','v15_oficina_grande','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], 'Planos enterprise/pro')

ON CONFLICT (id) DO NOTHING;
