import type { ModuloPreviewProps } from './ModuloPreview'

// Conteudo das 14 telas-preview da area P&M.
// 1 modulo ja entregue (Workspace, /dashboard/producao) nao entra aqui.

export type ConteudoModulo = Omit<ModuloPreviewProps, 'icone'> & { icone: string }

export const PM_MODULOS: Record<string, ConteudoModulo> = {
  // ─── BLOCO 1: COMERCIAL ──────────────────────────────────
  leads: {
    icone: '🎯', titulo: 'Leads / CRM', status: 'previsto',
    subtitulo: 'Funil de captação de novos clientes da agência, do primeiro contato ao fechamento.',
    oQueE: 'Antes de virar contrato, todo prospect entra aqui. Você acompanha cada oportunidade de novo cliente num funil visual — quem chegou, em que etapa está, e o que falta pra fechar. Quando ganha, vira cliente da agência automaticamente.',
    comoFunciona: [
      'Cadastra o lead (nome, contato, origem, interesse)',
      'Move pelo funil: novo → qualificado → proposta → negociação → ganho/perdido',
      'Registra cada interação (ligação, reunião, proposta enviada)',
      'Ao marcar "ganho", o lead vira cliente da agência (agency_clientes)',
    ],
    funcionalidades: [
      { titulo: 'Funil visual (Kanban)', descricao: 'Arraste o lead entre etapas com drag-and-drop.' },
      { titulo: 'Origem do lead', descricao: 'Indicação, Instagram, site, evento — pra saber o que traz cliente.' },
      { titulo: 'Timeline de interações', descricao: 'Tudo que aconteceu com o lead em um só lugar.' },
      { titulo: 'Conversão 1-clique', descricao: 'Lead ganho vira cliente + 1ª oportunidade.' },
      { titulo: 'Motivo de perda', descricao: 'Aprenda por que perde negócio.' },
    ],
    diferencialIA: 'A IA sugere o próximo passo de cada lead e prioriza quem tem mais chance de fechar, com base no histórico.',
  },
  briefings: {
    icone: '📋', titulo: 'Briefings', status: 'previsto',
    subtitulo: 'Captação estruturada da demanda do cliente — o ponto de partida de todo job.',
    oQueE: 'O briefing organiza o que o cliente quer ANTES de começar a produzir: objetivo, público-alvo, referências, prazo e orçamento. Briefing bem feito = menos retrabalho. É a base de cada job.',
    comoFunciona: [
      'Cria o briefing (manual ou a IA estrutura a partir de um áudio/conversa)',
      'Preenche objetivo, público, referências, tom de voz, prazo, orçamento',
      'Anexa referências visuais do cliente',
      'O briefing vira a base de um ou vários jobs',
    ],
    funcionalidades: [
      { titulo: 'Formulário estruturado', descricao: 'Objetivo, público, referências, prazo, verba.' },
      { titulo: 'Anexos de referência', descricao: 'Imagens, links e documentos.' },
      { titulo: 'Briefing → Job', descricao: 'Gera job(s) direto no Workspace.' },
      { titulo: 'Histórico por cliente', descricao: 'Todos os briefings de cada cliente em um só lugar.' },
    ],
    diferencialIA: 'Manda um áudio ou cola a conversa do WhatsApp — a IA transcreve e MONTA o briefing estruturado sozinha. Você só revisa.',
  },

  // ─── BLOCO 2: PRODUÇÃO & CONTROLE ────────────────────────
  'apontamento-horas': {
    icone: '⏱️', titulo: 'Apontamento de Horas', status: 'previsto',
    subtitulo: 'Cronômetro DENTRO do job — a base real da rentabilidade da agência.',
    oQueE: 'Mede quanto tempo cada pessoa gasta em cada job/cliente. Hoje o controle de horas é furado (cronômetro global, gente esquece de apontar). Aqui o cronômetro fica DENTRO do job: aperta play ao começar, stop ao terminar. Isso revela quais clientes realmente dão lucro.',
    comoFunciona: [
      'Abre o job e aperta PLAY no cronômetro (ou lança horas manual)',
      'O tempo fica registrado por colaborador + job + cliente + tarefa',
      'No fim do dia/semana, vê o relatório de horas',
      'As horas alimentam a Margem por Job automaticamente',
    ],
    funcionalidades: [
      { titulo: 'Cronômetro start/stop', descricao: 'Ao vivo dentro do job.' },
      { titulo: 'Apontamento manual', descricao: 'Pra quem esqueceu de ligar o timer.' },
      { titulo: 'Visões por dimensão', descricao: 'Horas por colaborador / cliente / tarefa / tipo de serviço.' },
      { titulo: 'Relatórios', descricao: 'Quem está sobrecarregado, qual cliente consome mais horas.' },
      { titulo: 'Base do custo real', descricao: 'Hora × custo-hora do colaborador.' },
    ],
    diferencialIA: 'Aponte horas pelo WhatsApp ("job Boticário, 2h") — o bot registra. E a IA avisa quando um job está estourando as horas previstas.',
  },
  'margem-job': {
    icone: '📊', titulo: 'Margem por Job', status: 'previsto',
    subtitulo: 'Quanto cada job e cada cliente REALMENTE dá de lucro.',
    oQueE: 'Cruza o valor que o cliente paga × as horas investidas × o custo da equipe. O resultado: você vê, preto no branco, qual cliente dá lucro e qual dá prejuízo. Muita agência trabalha no vermelho com cliente sem saber.',
    comoFunciona: [
      'Pega o valor do job/contrato do cliente',
      'Soma as horas apontadas × custo-hora de cada pessoa',
      'Calcula lucro e margem % por job e por cliente',
      'Mostra ranking: clientes mais e menos rentáveis',
    ],
    funcionalidades: [
      { titulo: 'Margem por job e por cliente', descricao: 'Em R$ e em %.' },
      { titulo: 'Ranking de clientes', descricao: 'Rentáveis vs prejuízo, ordenado.' },
      { titulo: 'Semáforo', descricao: 'Verde (lucro), amarelo (apertado), vermelho (prejuízo).' },
      { titulo: 'Liga na DRE Divisional', descricao: 'Resultado por cliente/unidade.' },
    ],
    diferencialIA: 'Antes de aceitar um job, a IA prevê a margem: "esse escopo historicamente estoura 30% das horas — cuidado".',
  },
  aprovacao: {
    icone: '✅', titulo: 'Aprovação Cliente', status: 'previsto',
    subtitulo: 'O cliente aprova a arte DENTRO do sistema — fim do "Drive + WhatsApp" bagunçado.',
    oQueE: 'Hoje a aprovação é um caos: manda no Drive, cobra no WhatsApp, perde o histórico. Aqui a peça passa por conferência interna, vai pro cliente num portal, ele comenta e aprova — tudo registrado, com histórico de versões.',
    comoFunciona: [
      'Produção interna finaliza a peça',
      'Conferência interna (revisão antes de ir pro cliente)',
      'Envia ao cliente (portal ou link/WhatsApp)',
      'Cliente comenta ou aprova; cada versão fica salva',
    ],
    funcionalidades: [
      { titulo: 'Fluxo de aprovação', descricao: 'Produção → conferência interna → cliente.' },
      { titulo: 'Portal do cliente', descricao: 'Vê, comenta e aprova num link.' },
      { titulo: 'Histórico de versões', descricao: 'Arte v1, v2, v3… tudo guardado.' },
      { titulo: 'Registro de quem aprovou', descricao: 'Quando e por quem (validade jurídica).' },
    ],
    diferencialIA: 'Aprovação pelo WhatsApp com validade jurídica (o cliente responde "aprovo" e fica registrado). E a IA confere se a arte está on-brand ANTES de ir pro cliente.',
  },
  portfolio: {
    icone: '🖼️', titulo: 'Portfólio de Entregas', status: 'previsto',
    subtitulo: 'Galeria das entregas aprovadas — vitrine e memória de marca de cada cliente.',
    oQueE: 'Todo trabalho aprovado vira portfólio: organizado por cliente e período. Serve de vitrine pra novos clientes, de evidência do que foi entregue, e de memória da marca (o acervo do relacionamento).',
    comoFunciona: [
      'Peça aprovada entra no portfólio automaticamente',
      'Organiza por cliente, período, tipo de peça',
      'Usa como vitrine comercial ou prova de entrega',
    ],
    funcionalidades: [
      { titulo: 'Galeria filtrável', descricao: 'Por cliente / período / unidade.' },
      { titulo: 'Entrada automática', descricao: 'O que foi aprovado entra sem trabalho extra.' },
      { titulo: 'Vitrine comercial', descricao: 'Mostrar pra prospects.' },
      { titulo: 'Memória de marca', descricao: 'Acervo histórico do cliente.' },
    ],
  },

  // ─── BLOCO 3: FINANCEIRO ─────────────────────────────────
  cobranca: {
    icone: '💰', titulo: 'Cobrança por Etapa', status: 'previsto',
    subtitulo: 'Cobrança amarrada aos marcos do job — produção e financeiro deixam de ser silos.',
    oQueE: 'Em vez de cobrar tudo no fim, a cobrança segue o job: ex. 50% na aprovação, 50% na entrega. Quando o job atinge o marco, o sistema dispara a cobrança automática (boleto/Pix) — sem ninguém lembrar de faturar.',
    comoFunciona: [
      'Define os marcos de cobrança do job (ex. 50/50)',
      'Job atinge o marco (ex. "aprovado")',
      'Sistema gera a cobrança automática via Asaas (boleto/Pix)',
      'Lançamento entra no financeiro (receitas a receber)',
    ],
    funcionalidades: [
      { titulo: 'Marcos de cobrança', descricao: 'Entrada, aprovação, entrega — configurável.' },
      { titulo: 'Disparo automático', descricao: 'Boleto/Pix via Asaas (já integrado).' },
      { titulo: 'Integração com o financeiro', descricao: 'Lançamento direto em erp_receber.' },
      { titulo: 'Pago vs pendente por job', descricao: 'Visão clara do que está em aberto.' },
    ],
    diferencialIA: 'Reaproveita o motor de cobrança Asaas que a PS já tem em produção — boleto, Pix, recorrência.',
  },
  'ia-preco': {
    icone: '🧮', titulo: 'IA Preço Ótimo', status: 'previsto',
    subtitulo: 'A IA sugere o preço ideal do job a partir do custo real e da margem-alvo.',
    oQueE: 'Precificar no feeling deixa dinheiro na mesa ou perde o cliente. A IA olha o custo real (horas × equipe), a margem que você quer e o histórico, e sugere o preço ótimo da proposta — com base em dado, não em achismo.',
    comoFunciona: [
      'Informa o escopo do job',
      'A IA estima horas e custo com base em jobs parecidos',
      'Aplica sua margem-alvo',
      'Sugere o preço — você ajusta e fecha',
    ],
    funcionalidades: [
      { titulo: 'Sugestão por escopo', descricao: 'Baseada em histórico real.' },
      { titulo: 'Margem-alvo configurável', descricao: 'Por cliente ou tipo de serviço.' },
      { titulo: 'Comparativo de jobs', descricao: 'Jobs similares já feitos.' },
      { titulo: 'Apoia a proposta', descricao: 'Vai direto pro orçamento.' },
    ],
    diferencialIA: 'Quanto mais a agência usa, mais a IA aprende o custo real dela — e melhor fica a sugestão.',
  },
  eventos: {
    icone: '🎬', titulo: 'Eventos & Produções', status: 'previsto',
    subtitulo: 'Gestão das produções audiovisuais e eventos (a unidade Audiovisual).',
    oQueE: 'A unidade de Audiovisual/eventos tem necessidades próprias: agenda de gravação, equipe alocada, custos de produção, cronograma. Este módulo organiza essas produções do briefing à entrega.',
    comoFunciona: [
      'Cria a produção/evento (data, local, equipe)',
      'Aloca equipe e equipamentos',
      'Controla custos de produção',
      'Acompanha o cronograma até a entrega',
    ],
    funcionalidades: [
      { titulo: 'Agenda de gravação/evento', descricao: 'Calendário próprio da unidade.' },
      { titulo: 'Alocação de equipe', descricao: 'Quem faz o quê em cada produção.' },
      { titulo: 'Custos de produção', descricao: 'Por projeto, com previsto vs realizado.' },
      { titulo: 'Cronograma', descricao: 'Do briefing à entrega final.' },
    ],
  },

  // ─── BLOCO 4: INTELIGÊNCIA & IA ──────────────────────────
  integracoes: {
    icone: '🔌', titulo: 'Integrações Produtividade', status: 'previsto',
    subtitulo: 'O sistema vira o maestro das ferramentas que vocês JÁ usam.',
    oQueE: 'Você não troca suas ferramentas — conecta. Drive (arquivos), Meta/Instagram (publicar e medir), Trello/ClickUp (migrar), Slack (avisos), Google Calendar (prazos). O sistema orquestra tudo num lugar só.',
    comoFunciona: [
      'Conecta as contas (Drive, Meta, Slack, Calendar…)',
      'Os arquivos/prazos/métricas fluem pro sistema',
      'O sistema vira o hub central — não mais silos',
    ],
    funcionalidades: [
      { titulo: 'Google Drive', descricao: 'Arquivos do job acessíveis dentro do sistema.' },
      { titulo: 'Meta / Instagram / TikTok', descricao: 'Publicar arte aprovada + puxar métricas.' },
      { titulo: 'Slack / WhatsApp', descricao: 'Notificações onde a equipe já está.' },
      { titulo: 'Google Calendar', descricao: 'Prazos e gravações sincronizados.' },
      { titulo: 'Trello / ClickUp', descricao: 'Migração de quem já usa.' },
    ],
    diferencialIA: 'Publicação direta nas redes: arte aprovada → agenda e posta no Instagram/TikTok pelo sistema → as métricas reais voltam pro Health Score. Fecha o loop produção → publicação → resultado.',
  },
  bot: {
    icone: '🤖', titulo: 'Bot WhatsApp/Slack', status: 'previsto',
    subtitulo: 'A operação acontece no canal onde a equipe e o cliente JÁ estão.',
    oQueE: 'Um bot que leva o sistema pro WhatsApp/Slack: o cliente aprova a arte por mensagem, a equipe aponta horas por mensagem, e todos recebem alertas de prazo. Zero fricção — ninguém precisa abrir o sistema pra tarefas rápidas.',
    comoFunciona: [
      'Conecta o bot ao WhatsApp/Slack',
      'Cliente aprova respondendo "aprovo" (com validade)',
      'Equipe aponta horas: "job X, 2h"',
      'Bot avisa prazos e pendências',
    ],
    funcionalidades: [
      { titulo: 'Aprovação por WhatsApp', descricao: 'Validade jurídica (Lei 14.063).' },
      { titulo: 'Apontamento por mensagem', descricao: 'Horas registradas direto no job.' },
      { titulo: 'Alertas de prazo', descricao: 'Lembrete pro responsável.' },
      { titulo: 'Tecnologia provada', descricao: 'Reaproveita o Bot WhatsApp que a PS já tem em produção no SST.' },
    ],
    diferencialIA: 'Mesma tecnologia de assinatura por WhatsApp com validade jurídica que já roda em produção na PS.',
  },
  'ia-preditiva': {
    icone: '🔮', titulo: 'IA Preditiva', status: 'previsto',
    subtitulo: 'Alertas ANTES do problema acontecer — atraso, estouro de horas, risco de margem.',
    oQueE: 'Em vez de descobrir o problema quando já aconteceu, a IA antecipa: "esse job vai atrasar", "esse cliente vai estourar as horas", "essa margem está em risco". Você age antes, não depois.',
    comoFunciona: [
      'A IA observa o andamento de jobs, horas e prazos',
      'Cruza com o histórico de jobs parecidos',
      'Dispara alertas pro responsável antes do estouro',
      'Sugere ação (redistribuir, renegociar prazo)',
    ],
    funcionalidades: [
      { titulo: 'Previsão de atraso', descricao: 'Job em risco de atrasar.' },
      { titulo: 'Previsão de estouro', descricao: 'Horas previstas vs realizadas.' },
      { titulo: 'Risco de margem', descricao: 'Job que vai dar prejuízo.' },
      { titulo: 'Alertas pró-ativos', descricao: 'Direto pro responsável.' },
    ],
    diferencialIA: 'Conecta com os Alertas Pró-ativos que a PS já usa nas outras áreas — de reativo pra preditivo.',
  },
  benchmark: {
    icone: '📡', titulo: 'Benchmark de Mercado / Radar Competitivo', status: 'em_breve',
    badge: '⭐ Diferencial exclusivo PS',
    subtitulo: 'Saiba o que o concorrente do seu cliente está fazendo — e como superar.',
    oQueE: 'O diferencial que NENHUM sistema brasileiro de agência tem. Por cliente, o sistema mapeia os concorrentes dele, identifica as estratégias e campanhas que eles rodam nas redes, e a agência cria estratégias melhores. Você chega na reunião com "o concorrente está rodando isso, vamos superar assim".',
    comoFunciona: [
      'Define os concorrentes de cada cliente',
      'O sistema mapeia as campanhas/estratégias deles (orgânico + patrocinado)',
      'A IA cruza com a performance do próprio cliente',
      'Gera estratégia superior → produz → mede → refina (ciclo contínuo)',
    ],
    funcionalidades: [
      { titulo: 'Mapa de concorrentes', descricao: 'Por cliente, com tags e prioridade.' },
      { titulo: 'Campanhas patrocinadas', descricao: 'Via Meta Ad Library.' },
      { titulo: 'Estratégias orgânicas', descricao: 'O que postam, o que engaja.' },
      { titulo: 'Ciclo de melhoria contínua', descricao: 'Concorrente + performance → IA gera → produz → mede → refina.' },
    ],
    diferencialIA: 'Torna a ESTRATÉGIA tangível (o que o cliente realmente paga, não o post). Eleva a percepção de valor da assessoria. Obs.: fonte de dados externa com custo — será ativada conforme a escala (decisão comercial).',
  },
  'health-score': {
    icone: '❤️', titulo: 'Health Score Cliente', status: 'previsto',
    subtitulo: 'Semáforo de saúde de cada cliente — rentabilidade, prazos, engajamento, risco de churn.',
    oQueE: 'Um placar de saúde por cliente: ele está dando lucro? os prazos estão em dia? está engajado? qual o risco de ele sair? Reúne tudo num semáforo — pra agência agir antes de perder o cliente.',
    comoFunciona: [
      'O sistema reúne rentabilidade + prazos + interações + aprovações',
      'Calcula um score de saúde por cliente',
      'Mostra semáforo: verde (saudável), amarelo (atenção), vermelho (risco)',
      'Avisa quando um bom cliente começa a esfriar',
    ],
    funcionalidades: [
      { titulo: 'Score por cliente', descricao: 'Verde / amarelo / vermelho.' },
      { titulo: 'Fatores combinados', descricao: 'Rentabilidade, prazos cumpridos, engajamento, churn.' },
      { titulo: 'Alerta de churn', descricao: 'Risco de perda de cliente antecipado.' },
      { titulo: 'Liga no Semáforo de Saúde', descricao: 'Mesmo motor que a PS já usa.' },
    ],
  },
}
