-- Hub · Gestão de Obras · aba Revisões de escopo (Blueprint §16 H2 · HBF-5.3). Code: desenvolvedor_4_g.
--
-- RD-95: todo filtro / indicador / coluna / ação da tela tem o "?" com a chave existente no banco.
-- Esta migration semeia as chaves de ajuda da nova aba Revisões de escopo
-- (/dashboard/projetos/obras/[id]/revisoes) e o link "Revisões de escopo →" do cockpit da obra.
-- A tela consome a RPC JÁ publicada e guardada fn_obra_revisao_listar (#3935, só leitura) — esta
-- migration NÃO cria/altera tabela nem função: só insere linhas de ajuda.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.revisao.resumo', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Revisões registradas',
   'Nada a preencher — é a contagem de revisões de escopo da obra e a soma das variações das revisões APROVADAS.',
   'Mostra, de relance, quantas vezes o escopo mudou e quanto, no total, as mudanças aprovadas acresceram ou reduziram o valor contratado.',
   'Duas revisões aprovadas de +R$ 12.000 e −R$ 3.000 resultam em "Variação aprovada +R$ 9.000,00".',
   'Esperar que revisões ainda em aberto entrem na variação — só as aprovadas mudam o contrato.', 0),

  ('projetos.revisao.filtro_status', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Filtrar por situação',
   'Escolha mostrar Todas ou só as Em aberto (rascunho/solicitada), Aprovadas ou Encerradas (recusada/cancelada/encerrada por supressão).',
   'Ajuda a focar nas revisões relevantes — por exemplo, só as que aguardam decisão.',
   'Selecione "Em aberto" para ver as revisões que ainda precisam ser aprovadas ou recusadas.',
   'Achar que uma revisão "sumiu" ao deixar o filtro numa situação específica — volte para "Todas".', 1),

  ('projetos.revisao.sequencial', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Número da revisão',
   'Nada a preencher — é o número sequencial da revisão dentro da obra (1, 2, 3…), na ordem em que foram criadas.',
   'Identifica cada revisão de forma única e mostra a ordem das mudanças de escopo ao longo da obra.',
   '"Revisão nº 3" é a terceira mudança de escopo registrada nesta obra.',
   'Confundir o número da revisão com o número do contrato — são coisas diferentes.', 2),

  ('projetos.revisao.origem', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Origem da revisão',
   'Nada a preencher — indica de onde partiu a mudança: Interna (da própria empresa), Do cliente ou Da contratante.',
   'Deixa claro quem pediu a mudança de escopo, o que importa para negociar e para registrar a responsabilidade.',
   '"Do cliente" quando o contratante solicita um acréscimo de serviço.',
   'Registrar como interna uma mudança pedida pelo cliente — a origem afeta a negociação do aditivo.', 3),

  ('projetos.revisao.status', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Situação da revisão',
   'Nada a preencher — mostra o estágio da revisão: Rascunho, Solicitada, Aprovada, Recusada, Cancelada ou Encerrada por supressão.',
   'Só a revisão Aprovada muda o valor contratado da obra; as demais ficam registradas, mas não movem o contrato.',
   'Uma revisão passa de "Solicitada" para "Aprovada" quando a mudança de escopo é aceita.',
   'Supor que uma revisão "Solicitada" já alterou o contrato — ela só vale depois de aprovada.', 4),

  ('projetos.revisao.solicitada_em', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Solicitada em',
   'Nada a preencher — é a data em que a revisão foi aberta.',
   'Ajuda a acompanhar quando cada mudança de escopo foi pedida e há quanto tempo aguarda decisão.',
   '"Solicitada em 05/11/2026" indica quando a revisão entrou.',
   'Confundir a data da solicitação com a da aprovação — a aprovação pode vir depois.', 5),

  ('projetos.revisao.motivo', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Motivo da revisão',
   'Nada a preencher — é a justificativa registrada para a mudança de escopo.',
   'Explica por que o escopo mudou, para conferência futura e para fundamentar o aditivo com o cliente.',
   '"Acréscimo de 200 m² de alvenaria por mudança de projeto arquitetônico."',
   'Motivo genérico ("ajuste") que não permite entender a mudança depois.', 6),

  ('projetos.revisao.valor_anterior', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Valor anterior',
   'Nada a preencher — é o valor do escopo antes desta revisão.',
   'Serve de referência para medir, junto com o valor novo, quanto a revisão mudou no contrato.',
   'Se o contrato valia R$ 300.000 antes da revisão, este é o valor anterior.',
   'Comparar o valor anterior de revisões diferentes sem ver a ordem — cada revisão parte do valor vigente na época.', 7),

  ('projetos.revisao.valor_novo', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Valor novo',
   'Nada a preencher — é o valor do escopo depois desta revisão.',
   'Mostra para quanto o escopo passa com a revisão. Quando aprovada, torna-se o valor vigente do contrato.',
   'Com um acréscimo de R$ 12.000 sobre R$ 300.000, o valor novo é R$ 312.000.',
   'Tratar o valor novo como já vigente mesmo quando a revisão não foi aprovada.', 8),

  ('projetos.revisao.delta', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Variação',
   'Nada a preencher — é a diferença entre o valor novo e o anterior (positiva para acréscimo, negativa para supressão).',
   'Resume, em um número, o impacto financeiro da revisão no contrato.',
   'Valor novo R$ 312.000 menos anterior R$ 300.000 resulta em variação +R$ 12.000,00.',
   'Ler a variação sem olhar a situação — só a revisão aprovada efetiva essa variação no contrato.', 9),

  ('projetos.revisao.itens', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Itens da revisão',
   'Nada a preencher — clique em "Ver itens" para abrir o detalhe: por item, a quantidade e o preço anterior × novo.',
   'Mostra exatamente o que mudou em cada item do escopo (quantidade e preço), base para conferir o aditivo.',
   'Ver que o item "Alvenaria" passou de 300 m² para 500 m² mantendo o preço unitário.',
   'Olhar só o valor total da revisão sem conferir item a item quando há várias mudanças.', 10)
ON CONFLICT (chave) DO NOTHING;

-- Link "Revisões de escopo →" no cockpit da obra (mesma rota/grupo dos demais atalhos do cockpit).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.cockpit.revisoes', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'hub_projetos',
   'Revisões de escopo',
   'Atalho para a aba Revisões de escopo da obra, onde ficam registradas as mudanças de escopo (acréscimos, supressões e reajustes).',
   'Leva à tela de revisões — o histórico de como o escopo e o valor contratado mudaram ao longo da obra.',
   'Abra "Revisões de escopo →" para conferir o valor antes e depois de cada aditivo.',
   'Procurar o histórico de mudanças de escopo no financeiro: ele fica aqui, na própria obra.', 12)
ON CONFLICT (chave) DO NOTHING;
