-- PDCA GE /dashboard/viabilidade (aud8 58): RD-95 ("?" nos campos) + RD-98 p3 (origem do dado em system_screens).
-- Aditiva e idempotente. Tema claro (RD-96) é só front, não entra em migration. Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('viabilidade.empresa',
   '/dashboard/viabilidade', 'Viabilidade', 'Empresa da análise',
   'Escolha a empresa cujos custos reais a IA deve usar na análise.',
   'A análise cruza o projeto com os custos reais da empresa selecionada; sem empresa, a IA só usa o que você descreveu.',
   'Selecionar "Construtora Horizonte" antes de enviar o orçamento.',
   'Analisar com a empresa errada selecionada: os custos de referência saem de outra operação.',
   'financeiro', 1, 1, 'publicado'),
  ('viabilidade.upload',
   '/dashboard/viabilidade', 'Viabilidade', 'Arquivo do projeto',
   'Arraste (ou clique para escolher) o arquivo do projeto: orçamento, proposta, planilha de custos ou plano de negócio.',
   'A IA extrai investimento, receita e prazos do arquivo para avaliar a viabilidade. Aceita CSV, TXT, XLS, XLSX, PDF, DOC.',
   'Subir a planilha de custos da obra em XLSX.',
   'Arquivo só com imagem escaneada sem texto: a IA não consegue extrair os números.',
   'financeiro', 2, 1, 'publicado'),
  ('viabilidade.setor',
   '/dashboard/viabilidade', 'Viabilidade', 'Setor / Ramo de Atividade',
   'Escolha o setor que melhor descreve o projeto.',
   'Calibra as referências de margem e risco que a IA aplica (cada setor tem padrões diferentes).',
   'Construção Civil para uma obra; Serviços para uma consultoria.',
   'Deixar "Selecione o setor...": a análise fica mais genérica.',
   'financeiro', 3, 1, 'publicado'),
  ('viabilidade.descricao',
   '/dashboard/viabilidade', 'Viabilidade', 'Descrição do projeto',
   'Descreva o projeto: o que é, investimento necessário, receita esperada, prazo e recursos.',
   'Quanto mais detalhe, melhor a análise. Serve quando você não tem arquivo ou quer complementar o que o arquivo não diz.',
   'Investimento R$ 200 mil, receita R$ 380 mil em 10 meses, equipe de 6.',
   'Descrição vaga ("um projeto novo"): a IA não tem base para projetar margem e payback.',
   'financeiro', 4, 1, 'publicado'),
  ('viabilidade.ia_pergunta',
   '/dashboard/viabilidade', 'Viabilidade', 'Pergunta à IA sobre a análise',
   'Pergunte qualquer coisa sobre o resultado: como chegou a um valor, se cabe no caixa, o que mudar.',
   'Permite aprofundar a análise sem refazer tudo — a IA responde no contexto deste projeto.',
   '"Esse projeto cabe no meu caixa atual?"',
   '—',
   'financeiro', 5, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: registra a origem do dado da tela (estava null) e tira o estado "desconhecida".
UPDATE public.system_screens
SET views_consumidas = ARRAY['users','company_groups','companies','user_companies']::text[],
    rpcs_chamadas = ARRAY['fn_ajuda_campo_listar']::text[],
    estado_real = CASE WHEN estado_real = 'desconhecida' THEN 'parcial' ELSE estado_real END
WHERE rota = '/dashboard/viabilidade';
