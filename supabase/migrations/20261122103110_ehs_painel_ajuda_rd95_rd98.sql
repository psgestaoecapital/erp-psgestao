-- RD-95 + RD-98 p3 (/dashboard/ehs · Hub PS EHS, painel): a landing não tinha nenhuma
-- chave de ajuda (aud8, nota 58). Cadastra os textos de ajuda dos 5 KPIs do cockpit
-- (Funcionários ativos, Não emitidos, Vencidos, Vencendo, % em dia), das 5 colunas da
-- tabela de Alertas e da ação "Gerar ZIP"; e registra em system_screens as views/RPCs
-- que o painel consome (RD-98 p3, mesmo padrão de /dashboard/ehs/prestadores).
-- O "% em dia" passa a contar TODAS as obrigações do funcionário ativo (inclui os não
-- emitidos), corrigindo o indicador que escondia obrigação em aberto (RD-98 p1).
-- Só metadados (erp_ajuda_campo) e origem do dado (system_screens); não toca dado de
-- cliente, RLS nem cálculo. Aditiva/idempotente. Faixa de segundos :10 (dev7claudeps).
-- Code: dev7claudeps
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Painel PS EHS', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs', 'ehs', 'publicado'
FROM (VALUES
 ('ehs.painel.func_ativos', 'Funcionários ativos',
  'Não preenche: é um indicador. Conta os funcionários ativos da(s) empresa(s) selecionada(s), incluindo quem você é tomador (terceirização).',
  'Mostra o tamanho do quadro que o painel está acompanhando — a base sobre a qual as obrigações de SST são cobradas.',
  'Se a empresa tem 28 funcionários ativos, o KPI mostra 28.',
  'Achar que inclui demitidos: só conta quem está ativo; quem foi desligado sai da conta.', 1),
 ('ehs.painel.nao_emitidos', 'Não emitidos',
  'Não preenche: é um indicador. Conta as obrigações de documento (ASO, treinamento, exame) que são obrigatórias para funcionários ativos mas NUNCA foram emitidas.',
  'É o risco mais grave de SST: obrigação em aberto, sem nenhum documento. Diferente de vencido (existiu e expirou), aqui nunca houve documento.',
  'KPI "370" = 370 obrigações obrigatórias sem documento algum; cada uma é uma exposição a multa/autuação.',
  'Ignorar porque "% em dia" parecia alto: antes esses 370 ficavam fora da conta e o painel mentia. Trate-os como a prioridade.', 2),
 ('ehs.painel.vencidos', 'Vencidos',
  'Não preenche: é um indicador. Conta os documentos obrigatórios de funcionários ativos cuja validade já passou.',
  'Mede o passivo em atraso — documentos que existiam e perderam a validade; precisam ser renovados já.',
  'KPI "8" = oito documentos obrigatórios vencidos; clique na lista de Alertas para ver quais.',
  'Confundir com "Não emitidos": vencido já existiu e expirou; não emitido nunca foi feito.', 3),
 ('ehs.painel.vencendo', 'Vencendo (10 dias)',
  'Não preenche: é um indicador. Conta os documentos obrigatórios que vencem nos próximos 10 dias.',
  'É o alerta de curto prazo — o que renovar AGORA para não virar "Vencido".',
  'KPI "7" = sete documentos vencem nesta janela; priorize-os antes que passem do prazo.',
  'Deixar para depois: em poucos dias eles migram para "Vencidos" e viram passivo.', 4),
 ('ehs.painel.pct_em_dia', '% em dia',
  'Não preenche: é um indicador. É a parcela de obrigações COM documento vigente (válido ou vencendo) sobre o TOTAL de obrigações dos funcionários ativos.',
  'Mede a conformidade real. O total inclui vencidos, não emitidos e sem validade — por isso o número bate com o banco e não esconde obrigação em aberto.',
  'Com 40 válidos + 7 vencendo em 437 obrigações, o KPI mostra 11% (e não 73%, que era o número inflado ao ignorar os não emitidos).',
  'Ler como "quase tudo ok" quando está verde sem olhar "Não emitidos": só sobe quando as obrigações em aberto são cumpridas.', 5),
 ('ehs.painel.col_funcionario', 'Funcionário',
  'Não preenche: é uma coluna. Nome do funcionário dono da obrigação; clique para abrir a ficha dele.',
  'Liga o alerta à pessoa, para você ir direto resolver o documento na ficha do funcionário.',
  'Clique em "João da Silva" para abrir a ficha e subir o documento que falta.',
  'Procurar o documento em outra tela: o atalho já leva à ficha certa pelo nome.', 6),
 ('ehs.painel.col_documento', 'Documento',
  'Não preenche: é uma coluna. Tipo do documento obrigatório (ex.: ASO, NR-35, PCMSO).',
  'Diz QUAL obrigação está em alerta para aquele funcionário.',
  '"ASO periódico" indica que o atestado de saúde ocupacional é o pendente.',
  'Supor que é o arquivo em si: é o TIPO da obrigação, não o anexo.', 7),
 ('ehs.painel.col_validade', 'Validade',
  'Não preenche: é uma coluna. Data em que o documento perde a validade. Em obrigação não emitida aparece "—" (não há documento).',
  'Mostra até quando o documento vale; é a referência para renovar a tempo.',
  '"15/12/2026" = o documento vale até essa data.',
  'Ver "—" e achar que é erro: significa que o documento ainda não foi emitido.', 8),
 ('ehs.painel.col_dias', 'Dias',
  'Não preenche: é uma coluna. Dias até vencer (negativo = já venceu). Em obrigação não emitida mostra "Em aberto".',
  'Dá a urgência em um relance: quanto menor (ou mais negativo), mais urgente.',
  '"-3" = venceu há 3 dias; "Em aberto" = obrigação sem documento, trate como prioridade.',
  'Ignorar valores negativos: eles já são passivo vencido.', 9),
 ('ehs.painel.col_status', 'Status',
  'Não preenche: é uma coluna. Situação da obrigação: Válido, Vencendo, Vencido ou Não emitido.',
  'Resume em uma etiqueta o estado do documento para priorizar a fila.',
  '"🚫 Não emitido" é o mais grave (obrigação em aberto); "🔴 Vencido" vem logo depois.',
  'Tratar "Vencendo" como "Vencido": vencendo ainda está no prazo, mas precisa de ação.', 10),
 ('ehs.painel.gerar_zip', 'Gerar ZIP',
  'Clique para baixar um pacote .zip com os documentos da empresa + os dos funcionários e prestadores que você selecionar.',
  'Reúne tudo num arquivo para enviar a auditoria, cliente ou órgão sem baixar documento por documento.',
  'Selecione os funcionários desejados e clique "Gerar e Baixar" para receber o .zip.',
  'Esperar incluir quem está inativo: o pacote traz só os selecionados na janela.', 11)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado do painel (views/tabelas e RPCs que a tela consome de verdade).
UPDATE public.system_screens
SET views_consumidas = ARRAY['compliance_funcionarios','v_compliance_matriz_funcionarios','compliance_prestadores']::text[],
    rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
WHERE rota = '/dashboard/ehs';
