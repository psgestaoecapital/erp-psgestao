-- Gestao Empresarial — popular a sidebar com TODAS as funcoes mapeadas
-- (Conta Azul + PS), distinguindo PRONTO (telas reais) de PREVISTO
-- (placeholder com descricao). Aplicada via MCP em 2026-06-30.
--
-- Novos items vivem em module_catalog com prefixo 'ge_prev_', status
-- 'previsto' em feature_catalog e vinculados ao plano
-- v15_gestao_empresarial_pro. Rota aponta pra pagina parametrizada
-- /dashboard/gestao-empresarial/previsto/{id} (uma so, le o modulo
-- do catalogo e mostra nome + descricao + prioridade).

ALTER TABLE public.module_catalog ADD COLUMN IF NOT EXISTS prioridade text;

WITH novos(id, nome, subgrupo, ordem, icone, prioridade, descricao) AS (
  VALUES
  ('ge_prev_favoritos','Favoritos','inicio',20,'Star','baixa','Atalhos favoritados pelo usuario no menu'),
  ('ge_prev_transportadoras','Transportadoras','cadastros',60,'Truck','media','Cadastro de transportadoras (frete/logistica)'),
  ('ge_prev_centros_custo','Centros de custo','cadastros',70,'GitBranch','media','Centros de custo'),
  ('ge_prev_marcas','Marcas','cadastros',80,'Tag','baixa','Cadastro de marcas'),
  ('ge_prev_tabelas_precos','Tabelas de precos','cadastros',90,'List','media','Tabelas de precos'),
  ('ge_prev_unidades_medida','Unidades de medida','cadastros',100,'Ruler','baixa','Cadastro de unidades de medida'),
  ('ge_prev_categorias_produtos','Categorias de produtos','cadastros',110,'Folder','baixa','Cadastro de categorias de produtos'),
  ('ge_prev_consulta_serasa','Consulta Serasa','cadastros',120,'Search','baixa','Consulta de credito/Serasa do cliente'),
  ('ge_prev_vendas_produto','Vendas de produtos','vendas',10,'ShoppingCart','alta','Registro de vendas de produto'),
  ('ge_prev_orcamentos_produto','Orcamentos de produto','vendas',20,'FileText','alta','Criacao de orcamentos de produto'),
  ('ge_prev_contratos_produto','Contratos (produto)','vendas',30,'FileSignature','media','Contratos recorrentes de produto'),
  ('ge_prev_modelo_email_venda','Modelo de e-mail de venda','vendas',40,'Mail','baixa','Template do e-mail enviado ao cliente na venda'),
  ('ge_prev_pdv_caixa','Frente de caixa (PDV)','pdv',10,'Calculator','alta','Ponto de venda / frente de caixa'),
  ('ge_prev_pdv_movimentacao','Movimentacao do caixa','pdv',20,'Wallet','media','Abertura/fechamento e movimento do caixa'),
  ('ge_prev_pdv_nfce','Notas fiscais de consumidor (NFC-e)','pdv',30,'Receipt','alta','Emissao de NFC-e no PDV'),
  ('ge_prev_pdv_vendas_vendedor','Vendas por vendedor no PDV','pdv',40,'Users','media','Relatorio de vendas por vendedor'),
  ('ge_prev_pdv_config','Configuracoes do PDV','pdv',50,'Settings','baixa','Configuracoes da frente de caixa'),
  ('ge_prev_pdv_menu_fiscal','Menu fiscal','pdv',60,'Sliders','baixa','Configuracoes fiscais do PDV'),
  ('ge_prev_estoque_locais','Locais de estoque','estoque',10,'MapPin','media','Multiplos locais/depositos de estoque'),
  ('ge_prev_estoque_inventarios','Inventarios','estoque',20,'ClipboardList','media','Inventario / contagem de estoque'),
  ('ge_prev_estoque_config','Configurar estoque','estoque',30,'Settings','baixa','Configuracoes do estoque'),
  ('ge_prev_antecipacao_recebiveis','Antecipacao de recebiveis','financeiro',100,'Zap','baixa','Antecipacao de recebiveis via parceiro'),
  ('ge_prev_conta_pj','Conta PJ e Cobranca','financeiro',110,'CreditCard','media','Conta digital embarcada + cobranca'),
  ('ge_prev_dda','DDA','financeiro',120,'FileText','media','Debito Direto Autorizado (boletos)'),
  ('ge_prev_extrato_open_finance','Extrato Conta PJ (Open Finance)','financeiro',130,'Banknote','alta','Extrato bancario integrado (Open Finance)'),
  ('ge_prev_lembretes_vencimento','Lembretes de vencimento','financeiro',140,'Bell','media','Lembretes automaticos de vencimento'),
  ('ge_prev_outras_contas','Outras contas','financeiro',150,'Layers','media','Gestao de outras contas bancarias'),
  ('ge_prev_visao_competencia','Visao de competencia','financeiro',160,'Calendar','media','Resultado por regime de competencia'),
  ('ge_prev_nfe_compra','NF-e de compra (entrada/MDe)','notas_fiscais',10,'FileInput','alta','Entrada de NF-e de compra (manifesto MDe)'),
  ('ge_prev_nfse_tomadas','NFS-e tomadas','notas_fiscais',20,'FileInput','media','Importa NFS-e tomadas e gera contas a pagar'),
  ('ge_prev_nf_importacao','Notas de importacao','notas_fiscais',30,'Plane','baixa','Emissao de NF de importacao'),
  ('ge_prev_series_nf','Series de notas fiscais','notas_fiscais',40,'Hash','media','Gestao das series de numeracao das notas fiscais'),
  ('ge_prev_relatorios_vendas','Relatorios de vendas','analises',50,'BarChart3','media','CMV, lucro/margem, impostos, por cliente/vendedor'),
  ('ge_prev_relatorios_compras','Relatorios de compras','analises',60,'BarChart3','baixa','Compras por categoria, relacoes detalhadas'),
  ('ge_prev_relatorios_estoque','Relatorios de estoque','analises',70,'BarChart3','media','Giro, posicao, Curva ABC, historico de movimentacoes'),
  ('ge_prev_relatorio_personalizado','Relatorio personalizado','analises',80,'Wrench','alta','Construtor de relatorios personalizados'),
  ('ge_prev_agendador_relatorios','Agendador de relatorios','analises',90,'Clock','media','Agendamento/envio automatico de relatorios'),
  ('ge_prev_visao_caixa_dre','Visao de caixa (DRE caixa)','analises',100,'PieChart','media','Resultado por regime de caixa'),
  ('ge_prev_marketplace_integracoes','Marketplace de integracoes','administracao',100,'Plug','media','Marketplace + automatizadores'),
  ('ge_prev_conta_ai_captura','Conta AI Captura','inteligencia_protecao',20,'ScanLine','alta','Captura de documentos por IA')
)
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, descricao, icone, prioridade, layer, is_shared, legacy, diferencial)
SELECT n.id, n.nome, 'gestao_empresarial', n.subgrupo,
       '/dashboard/gestao-empresarial/previsto/' || n.id,
       n.ordem, true, n.descricao, n.icone, n.prioridade,
       'feature', false, false, false
FROM novos n
ON CONFLICT (id) DO UPDATE SET
  prioridade = EXCLUDED.prioridade,
  descricao = EXCLUDED.descricao;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
SELECT mc.id, mc.id, 'gestao_empresarial', mc.nome, coalesce(mc.descricao, mc.nome),
       'previsto', 0, coalesce(mc.prioridade, 'media')
FROM public.module_catalog mc
WHERE mc.id LIKE 'ge_prev_%'
ON CONFLICT (id) DO UPDATE SET status='previsto';

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT 'v15_gestao_empresarial_pro', mc.id
FROM public.module_catalog mc
WHERE mc.id LIKE 'ge_prev_%'
ON CONFLICT DO NOTHING;
