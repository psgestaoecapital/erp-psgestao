-- ═══════════════════════════════════════════════════════════════
-- PR M.A.7.1 LOTE 1: oficina (5) + hub (5) + commerce (2) = 12 módulos
-- ═══════════════════════════════════════════════════════════════

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos, marcos_roadmap, observacao) VALUES

-- ═══ OFICINA (5 módulos) ═══

-- oficina_os: Ordens de Servico
('F.oficina_os.criar_os', 'oficina_os', 'operacional', 'Criar OS', 'Abertura de Ordem de Servico com cliente, veiculo, defeito, mecanico atribuido', 'previsto', 0, 'critica', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], 'Core do plano Oficina'),
('F.oficina_os.kanban_status', 'oficina_os', 'operacional', 'Kanban OS por status', 'Visao kanban: Aguardando, Diagnostico, Aprovacao, Execucao, Pronto, Entregue', 'previsto', 0, 'alta', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_os.aprovacao_orcamento', 'oficina_os', 'operacional', 'Aprovacao orcamento cliente', 'Cliente recebe link/WhatsApp com orcamento e aprova ou rejeita', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_os.checklist_entrega', 'oficina_os', 'operacional', 'Checklist de entrega', 'Itens conferidos antes da entrega (documentos, chaves, pertences)', 'previsto', 0, 'media', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_os.pdf_os', 'oficina_os', 'operacional', 'PDF da OS', 'Geracao de PDF para impressao com servicos, pecas, mao de obra, total', 'previsto', 0, 'alta', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),

-- oficina_estoque_pecas
('F.oficina_estoque_pecas.cadastro_peca', 'oficina_estoque_pecas', 'operacional', 'Cadastro de pecas', 'CRUD de pecas com codigo, descricao, fornecedor, NCM, custo, preco', 'previsto', 0, 'critica', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_estoque_pecas.entrada_saida', 'oficina_estoque_pecas', 'operacional', 'Movimentacao entrada/saida', 'Entrada por compra/devolucao, saida por uso na OS', 'previsto', 0, 'critica', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_estoque_pecas.alerta_minimo', 'oficina_estoque_pecas', 'operacional', 'Alerta estoque minimo', 'Notifica quando peca chega abaixo do minimo configurado', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_estoque_pecas.kit_servico', 'oficina_estoque_pecas', 'operacional', 'Kits de servico', 'Agrupar pecas comuns em kits (ex: revisao 10mil km)', 'previsto', 0, 'media', ARRAY['v15_oficina_grande'], ARRAY['M.A.7'], NULL),

-- oficina_veiculos_fipe
('F.oficina_veiculos_fipe.cadastro_veiculo', 'oficina_veiculos_fipe', 'operacional', 'Cadastro de veiculo', 'CRUD veiculo com placa, chassi, marca, modelo, ano, KM', 'previsto', 0, 'critica', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_veiculos_fipe.consulta_fipe', 'oficina_veiculos_fipe', 'operacional', 'Consulta tabela FIPE', 'Auto-preenchimento marca/modelo/ano e valor de mercado via API FIPE', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_veiculos_fipe.historico_servicos', 'oficina_veiculos_fipe', 'operacional', 'Historico de servicos por veiculo', 'Linha do tempo de OSs anteriores, KM e pecas trocadas', 'previsto', 0, 'alta', ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),

-- oficina_comissao
('F.oficina_comissao.config_mecanico', 'oficina_comissao', 'gerencial', 'Configurar comissao mecanico', 'Definir % por servico ou faixa de faturamento por mecanico', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_comissao.calculo_mensal', 'oficina_comissao', 'gerencial', 'Calculo comissao mensal', 'Apuracao automatica baseada nas OSs concluidas no mes', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_comissao.relatorio_pagamento', 'oficina_comissao', 'gerencial', 'Relatorio para pagamento', 'PDF/CSV com comissoes a pagar, integrado com folha', 'previsto', 0, 'media', ARRAY['v15_oficina_grande'], ARRAY['M.A.7'], NULL),

-- oficina_whatsapp_ia
('F.oficina_whatsapp_ia.notificacao_status', 'oficina_whatsapp_ia', 'ia_atendimento', 'Notificacao status via WhatsApp', 'Cliente recebe automaticamente: aguardando aprovacao, em execucao, pronto', 'previsto', 0, 'alta', ARRAY['v15_oficina_media','v15_oficina_grande'], ARRAY['M.A.7'], NULL),
('F.oficina_whatsapp_ia.atendimento_ia', 'oficina_whatsapp_ia', 'ia_atendimento', 'IA atende WhatsApp', 'IA responde duvidas, agenda, consulta status da OS pelo WhatsApp', 'previsto', 0, 'alta', ARRAY['v15_oficina_grande'], ARRAY['M.A.7'], 'Diferencial competitivo'),
('F.oficina_whatsapp_ia.agendamento_automatico', 'oficina_whatsapp_ia', 'ia_atendimento', 'Agendamento automatico', 'Cliente agenda servico pelo WhatsApp sem intervencao humana', 'previsto', 0, 'media', ARRAY['v15_oficina_grande'], ARRAY['M.A.7'], NULL),

-- ═══ HUB / OBRAS-CONSTRUCAO (5 módulos) ═══

-- hub_obras
('F.hub_obras.cadastro_obra', 'hub_obras', 'operacional', 'Cadastro de obra/projeto', 'CRUD obra com cliente, endereco, contrato, prazo, valor total', 'previsto', 0, 'critica', ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], 'Core Hub Projetos'),
('F.hub_obras.equipe_obra', 'hub_obras', 'operacional', 'Equipe da obra', 'Mestre obra, encarregados, operarios alocados', 'previsto', 0, 'alta', ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_obras.galeria_fotos', 'hub_obras', 'operacional', 'Galeria de fotos da obra', 'Upload fotos por etapa para evidencia e relatorio', 'previsto', 0, 'media', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),

-- hub_bom (Bill of Materials)
('F.hub_bom.composicao_servicos', 'hub_bom', 'operacional', 'Composicoes SINAPI', 'Insumos por servico (mao obra + material) seguindo padrao SINAPI', 'previsto', 0, 'critica', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_bom.curva_abc', 'hub_bom', 'gerencial', 'Curva ABC de insumos', 'Top materiais por valor agregado para gestao de compras', 'previsto', 0, 'alta', ARRAY['v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_bom.atualizacao_precos', 'hub_bom', 'operacional', 'Atualizacao precos insumos', 'Reajuste manual ou via importacao de tabela', 'previsto', 0, 'media', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),

-- hub_cronograma
('F.hub_cronograma.gantt', 'hub_cronograma', 'gerencial', 'Cronograma Gantt', 'Visao Gantt fisico-financeiro com etapas e dependencias', 'previsto', 0, 'critica', ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_cronograma.curva_s', 'hub_cronograma', 'gerencial', 'Curva S financeira', 'Avanço fisico vs avanço financeiro acumulado', 'previsto', 0, 'alta', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_cronograma.atraso_alerta', 'hub_cronograma', 'gerencial', 'Alerta de atraso', 'Notifica quando etapa fica >3 dias atrasada', 'previsto', 0, 'alta', ARRAY['v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),

-- hub_medicao
('F.hub_medicao.medicao_etapa', 'hub_medicao', 'operacional', 'Medicao por etapa', 'Registro de % execucao por etapa contratada', 'previsto', 0, 'critica', ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_medicao.boletim_medicao', 'hub_medicao', 'operacional', 'Boletim de medicao', 'PDF formal de medicao para apresentar ao cliente', 'previsto', 0, 'critica', ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_medicao.aditivo_contrato', 'hub_medicao', 'operacional', 'Aditivos contratuais', 'Registro de servicos extras nao previstos', 'previsto', 0, 'alta', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),

-- hub_nf_abi_cib_ret
('F.hub_nf_abi_cib_ret.cei_cno', 'hub_nf_abi_cib_ret', 'fiscal', 'Cadastro CEI/CNO', 'Matricula obra para INSS (CEI antigo, agora CNO)', 'previsto', 0, 'critica', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], 'Obrigatorio LC'),
('F.hub_nf_abi_cib_ret.retencoes_inss', 'hub_nf_abi_cib_ret', 'fiscal', 'Retencoes INSS construcao', 'Calculo retencao 11% sobre fatura de mao obra', 'previsto', 0, 'critica', ARRAY['v15_hub_t2','v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),
('F.hub_nf_abi_cib_ret.nf_abi', 'hub_nf_abi_cib_ret', 'fiscal', 'NF-ABI (Auto Bilhetagem Imobiliaria)', 'Geracao NF-ABI para servicos imobiliarios', 'previsto', 0, 'alta', ARRAY['v15_hub_t3','v15_hub_t4'], ARRAY['M.A.7'], NULL),

-- ═══ COMMERCE (2 módulos) ═══

-- commerce_compras
('F.commerce_compras.cotacao', 'commerce_compras', 'operacional', 'Cotacao com fornecedores', 'Solicitar cotacao a multiplos fornecedores e comparar', 'previsto', 0, 'alta', ARRAY['v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_compras.pedido_compra', 'commerce_compras', 'operacional', 'Pedido de compra', 'Geracao formal de pedido de compra com aprovacao', 'previsto', 0, 'critica', ARRAY['v15_commerce_basico','v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_compras.recebimento_nf', 'commerce_compras', 'operacional', 'Recebimento com NF-e', 'Conferencia NF-e do fornecedor com pedido + entrada estoque', 'previsto', 0, 'critica', ARRAY['v15_commerce_basico','v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_compras.aprovacao_compras', 'commerce_compras', 'operacional', 'Workflow aprovacao compras', 'Aprovacao em niveis por valor (gerente, diretor)', 'previsto', 0, 'alta', ARRAY['v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),

-- commerce_nfce
('F.commerce_nfce.emissao_nfce', 'commerce_nfce', 'fiscal', 'Emissao NFC-e', 'Emissao Nota Fiscal Consumidor eletronica', 'previsto', 0, 'critica', ARRAY['v15_commerce_basico','v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_nfce.contingencia', 'commerce_nfce', 'fiscal', 'Contingencia offline', 'Emissao NFC-e em contingencia quando SEFAZ fora do ar', 'previsto', 0, 'alta', ARRAY['v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_nfce.cancelamento', 'commerce_nfce', 'fiscal', 'Cancelamento NFC-e', 'Cancelamento dentro do prazo legal (30 min)', 'previsto', 0, 'critica', ARRAY['v15_commerce_basico','v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL),
('F.commerce_nfce.relatorio_diario', 'commerce_nfce', 'fiscal', 'Relatorio Z diario', 'Resumo de NFC-e emitidas no dia para fechamento de caixa', 'previsto', 0, 'media', ARRAY['v15_commerce_pro','v15_commerce_enterprise'], ARRAY['M.A.7'], NULL)

ON CONFLICT (id) DO NOTHING;
