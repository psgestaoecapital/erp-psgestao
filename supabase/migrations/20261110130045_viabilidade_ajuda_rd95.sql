-- RD-95 ("?" em todo campo/filtro/ação) · Viabilidade de Projetos (Gestão Empresarial).
-- Gap #2 do auditor (/dashboard/viabilidade, score 58): "0 AjudaCampo — nenhum '?' no dropzone,
-- formatos aceitos ou no botão/campos". Esta migration cadastra as chaves de ajuda dos campos da
-- tela (seletor de empresa, upload do arquivo, setor, descrição do projeto e a pergunta ao
-- consultor IA). O page.tsx passa a referenciar cada uma com <AjudaCampo chave="..." rota={ROTA} />.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente).
-- ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('viabilidade.empresa','Cabeçalho','Empresa / grupo',
 'Escolha a empresa (ou o grupo) para a qual você está analisando a viabilidade do projeto.',
 'Define em qual empresa o projeto é avaliado e a quem a análise fica associada.',
 'Selecionar "FC Pisos" antes de subir o orçamento da obra nova.',
 'Analisar com a empresa errada selecionada: a análise fica no contexto de outra operação.',
 1,'/dashboard/viabilidade','gestao_empresarial','publicado'),
('viabilidade.upload_arquivo','Upload','Arquivo do projeto',
 'Suba um arquivo com os números do projeto: orçamento, proposta comercial, planilha de custos ou plano de negócio. Aceita CSV, TXT, XLS, XLSX, PDF ou DOC.',
 'A IA lê o conteúdo do arquivo para estimar investimento, receita e prazo e julgar se o projeto é viável.',
 'Subir a planilha de custos da obra em XLSX, ou a proposta comercial em PDF.',
 'Subir um arquivo só com imagens/escaneado sem texto: a IA não consegue extrair os números — prefira planilha ou PDF com texto.',
 2,'/dashboard/viabilidade','gestao_empresarial','publicado'),
('viabilidade.setor','Contexto','Setor / ramo de atividade',
 'Escolha o setor que melhor descreve o projeto (comércio, indústria, serviços, construção civil, agronegócio…).',
 'O setor calibra as referências da IA (margens, prazos e riscos típicos daquele ramo) na hora de julgar a viabilidade.',
 'Uma obra → "Construção Civil"; uma loja nova → "Comércio".',
 'Deixar em branco ou escolher um setor que não combina: a análise usa referências menos aderentes ao seu caso.',
 3,'/dashboard/viabilidade','gestao_empresarial','publicado'),
('viabilidade.descricao_projeto','Contexto','Descrição do projeto',
 'Descreva o projeto em detalhes: o que é, o investimento necessário, a receita esperada, o prazo e os recursos. Quanto mais detalhes, melhor a análise.',
 'É a base da análise quando não há arquivo (ou complementa o arquivo): a IA usa esse texto para estimar retorno e apontar riscos.',
 '"Abrir uma segunda loja; investimento de R$ 180 mil; receita esperada de R$ 40 mil/mês; prazo de 4 meses para abrir."',
 'Descrever em uma frase vaga ("quero expandir"): sem números a IA não consegue julgar a viabilidade com segurança.',
 4,'/dashboard/viabilidade','gestao_empresarial','publicado'),
('viabilidade.pergunta_ia','Consultor IA','Pergunta ao consultor',
 'Depois da análise, pergunte em linguagem natural para entender o resultado (como chegou num valor, se cabe no caixa, o que mudaria o veredito).',
 'Deixa você explorar a análise e testar cenários sem refazer tudo — o consultor responde com base nos números do projeto.',
 '"Como chegou nesse investimento?" · "Esse projeto cabe no meu caixa atual?"',
 'Perguntar antes de rodar a análise: o consultor precisa do projeto analisado para responder com dados.',
 5,'/dashboard/viabilidade','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
