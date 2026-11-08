-- Contratos (GE) · tarefa GAPS auditor (dev7claudeps)
-- RD-95: a tela /dashboard/contratos tinha "?" só nos campos do formulário; faltava nos 5 KPIs do Dashboard
-- SaaS (MRR, Clientes ativos, Churn, Novo MRR, Renovações), no gráfico de evolução do MRR, nas abas e nos
-- 2 painéis (MRR por tipo, Top 5 clientes). Cadastra as chaves de ajuda desses indicadores (idempotente).
-- RD-98 p3 (origem do dado): preenche system_screens.views_consumidas/rpcs_chamadas da rota (derivado do
-- código: supabase.rpc('fn_*') e .from('...') da própria página). Aditivo/idempotente, sem tocar backend,
-- cálculo, RLS ou dado de cliente. Code: dev7claudeps

-- 1) Ajuda RD-95 dos indicadores do Dashboard SaaS
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.contrato.abas','Contratos','Abas da tela',
 'Navegação (não se preenche): Dashboard SaaS (indicadores), Contratos (lista), Solicitações & Fee, Modelos e Ações.',
 'Separa o que você vê: os números de recorrência ficam no Dashboard; a carteira e as operações ficam nas outras abas.',
 'Abrir "Dashboard SaaS" para ver MRR e churn; "Contratos" para a lista.',
 'Procurar um contrato específico no Dashboard: a lista fica na aba Contratos.',
 20,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.kpi_mrr','Contratos','MRR Mensal',
 'Indicador de leitura. Receita recorrente mensal somada de todos os contratos ativos da empresa; abaixo, o ARR (×12).',
 'É o termômetro do negócio recorrente: quanto entra, de forma previsível, por mês. Base para metas e projeção de caixa.',
 'MRR R$ 48.000 · ARR R$ 576.000.',
 'Confundir MRR com faturamento do mês: o MRR é só a parte recorrente dos contratos ativos, não vendas avulsas.',
 21,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.kpi_clientes_ativos','Contratos','Clientes Ativos',
 'Indicador de leitura. Quantos clientes têm pelo menos um contrato ativo; abaixo, o ticket médio (MRR ÷ clientes).',
 'Mostra o tamanho da carteira recorrente e o valor médio por cliente — útil para ver dependência de poucos contratos.',
 '32 clientes · ticket R$ 1.500.',
 'Contar contratos como clientes: um cliente pode ter vários contratos; aqui conta o cliente uma vez.',
 22,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.kpi_churn','Contratos','Churn Rate (12m)',
 'Indicador de leitura. Percentual de receita recorrente perdida por cancelamentos nos últimos 12 meses; abaixo, o LTV.',
 'Mede a perda de clientes/receita. Verde até ~5%, amarelo até ~10%, vermelho acima — quanto menor, mais saudável.',
 'Churn 4,2% · LTV R$ 36.000.',
 'Ignorar o churn com MRR crescendo: muita entrada pode esconder muita saída; os dois contam.',
 23,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.kpi_novo_mrr','Contratos','Novo MRR (30d)',
 'Indicador de leitura. Receita recorrente ganha em novos contratos nos últimos 30 dias; abaixo, o MRR perdido (churn) no período.',
 'Mostra o saldo recente de crescimento: o quanto entrou de recorrência nova contra o quanto saiu.',
 '+R$ 3.200 novo · -R$ 800 churn.',
 'Olhar só o novo e esquecer o churn ao lado: o crescimento real é a diferença entre os dois.',
 24,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.kpi_renovacoes','Contratos','Renovações 60d',
 'Indicador de leitura. Quantos contratos têm renovação/vencimento nos próximos 60 dias.',
 'Antecipa as renovações a negociar — amarelo quando há contratos a vencer, para não perder prazo.',
 '3 contratos a renovar nos próximos 60 dias.',
 'Deixar para a semana do vencimento: renovação sem antecedência vira risco de churn.',
 25,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.grafico_mrr','Contratos','Evolução do MRR',
 'Indicador de leitura. Gráfico da receita recorrente mês a mês nos últimos 12 meses.',
 'Mostra a tendência: se a recorrência cresce, estabiliza ou cai ao longo do ano.',
 'Linha subindo de R$ 30 mil para R$ 48 mil em 12 meses.',
 'Tirar conclusão de um mês só: a tendência aparece no conjunto dos meses, não num ponto.',
 26,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.painel_mrr_tipo','Contratos','MRR por Tipo de Serviço',
 'Indicador de leitura. Divide o MRR por tipo de contrato (BPO, Consultoria, SaaS, Serviços…), com a quantidade por tipo.',
 'Mostra de onde vem a recorrência — qual linha de serviço sustenta o faturamento mensal.',
 'SaaS R$ 20 mil (8) · Consultoria R$ 15 mil (5).',
 'Decidir preço olhando só o total: o mix por tipo mostra qual serviço puxa ou segura o MRR.',
 27,'/dashboard/contratos','gestao_empresarial','publicado'),
('ge.contrato.painel_top_clientes','Contratos','Top 5 Clientes por MRR',
 'Indicador de leitura. Os cinco clientes com maior receita recorrente mensal.',
 'Mostra a concentração da carteira — se poucos clientes respondem por grande parte do MRR, o risco de perdê-los é maior.',
 '1º Cliente A R$ 6.000 · 2º Cliente B R$ 4.500.',
 'Dar atenção só aos novos e esquecer os maiores: perder um Top 5 pesa muito mais no MRR.',
 28,'/dashboard/contratos','gestao_empresarial','publicado')
ON CONFLICT (chave) DO UPDATE SET
  grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  ordem=EXCLUDED.ordem, rota=EXCLUDED.rota, vertical=EXCLUDED.vertical, status=EXCLUDED.status,
  atualizado_em=now();

-- 2) RD-98 p3: origem do dado (sem UNION remove nada; só acrescenta o que a página realmente usa)
UPDATE public.system_screens SET
  rpcs_chamadas = ARRAY(SELECT DISTINCT unnest(COALESCE(rpcs_chamadas,'{}'::text[]) || ARRAY[
    'calcular_metricas_saas','historico_mrr','next_contrato_numero','fn_contrato_acoes_permitidas',
    'fn_contrato_aplicar_reajuste','fn_contrato_editar','fn_contrato_encerrar','fn_contrato_excluir',
    'fn_contrato_processar_lote_diario','fn_ajuda_campo_listar']::text[]) ORDER BY 1),
  views_consumidas = ARRAY(SELECT DISTINCT unnest(COALESCE(views_consumidas,'{}'::text[]) || ARRAY[
    'erp_contratos','erp_contratos_eventos','erp_contratos_reajustes','erp_clientes','agency_servico',
    'v_contratos_dashboard','v_contratos_mrr_por_tipo','v_contratos_top_clientes']::text[]) ORDER BY 1),
  atualizado_em = now()
WHERE rota = '/dashboard/contratos';
