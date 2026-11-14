-- Hub · Gestão de Obras · aba Subempreiteiros (Blueprint §16 H7). Code: desenvolvedor_4_g.
--
-- RD-95: todo campo / filtro / indicador / ação da tela tem o "?" com a chave existente no banco.
-- Esta migration semeia as chaves de ajuda da nova aba Subempreiteiros
-- (/dashboard/projetos/obras/[id]/subempreiteiros) e o link "Subempreiteiros →" do cockpit da obra.
-- A tela consome RPCs JÁ publicadas e guardadas (#3913: fn_obra_subempreiteiro_contrato_listar/
-- _salvar/_excluir) — esta migration NÃO cria/altera tabela nem função: só insere linhas de ajuda.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.subempreiteiro.total_contratado', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Total contratado em subempreiteiros',
   'Nada a preencher — é a soma dos valores de todos os contratos de subempreiteiros desta obra (exceto os excluídos).',
   'Mostra, de relance, quanto da obra foi terceirizado em contratos de mão de obra — base para acompanhar o custo contratado com terceiros.',
   'Três contratos de R$ 40.000, R$ 25.000 e R$ 15.000 somam "Total contratado R$ 80.000,00".',
   'Confundir o total contratado (o que foi combinado) com o já pago — o pagamento por medição é tratado no financeiro.', 0),

  ('projetos.subempreiteiro.novo', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Novo contrato',
   'Clique para abrir o cadastro de um contrato de subempreiteiro: escolha o fornecedor, descreva o objeto e lance os itens do escopo.',
   'Registra quem executa parte do escopo da obra e sob quais condições (valor, retenção, prazo). É a base do controle de terceirizados.',
   'Contratou uma empresa para a estrutura de concreto? Abra "Novo contrato", escolha o fornecedor e lance os itens.',
   'Cadastrar o mesmo subempreiteiro duas vezes para a mesma frente — edite o contrato existente em vez de duplicar.', 1),

  ('projetos.subempreiteiro.filtro_status', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Filtrar por situação',
   'Escolha mostrar Todos ou só os contratos em Rascunho, Ativo, Concluído ou Cancelado.',
   'Ajuda a focar nos contratos relevantes (ex.: só os ativos em execução), separando-os dos encerrados ou cancelados.',
   'Selecione "Ativo" para ver apenas os subempreiteiros trabalhando na obra agora.',
   'Achar que um contrato "sumiu" ao deixar o filtro numa situação específica — volte para "Todos".', 2),

  ('projetos.subempreiteiro.fornecedor', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Subempreiteiro (fornecedor)',
   'Escolha, na lista, o fornecedor que executa este contrato. A lista traz os fornecedores cadastrados na empresa desta obra.',
   'Vincula o contrato a um cadastro de fornecedor existente, para reaproveitar dados e manter o histórico por empresa contratada.',
   'Selecione "Construtora Alfa Ltda" para o contrato da estrutura.',
   'Não encontrar o fornecedor: cadastre-o antes em Fornecedores — a tela só lista fornecedores da mesma empresa da obra.', 3),

  ('projetos.subempreiteiro.numero', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Nº do contrato',
   'Número ou código do contrato, se houver. Campo opcional.',
   'Facilita localizar e conferir o contrato contra o documento físico ou do jurídico.',
   'CT-2026-017.',
   'Deixar em branco quando a empresa controla contratos por número — preencha para rastrear.', 4),

  ('projetos.subempreiteiro.objeto', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Objeto do contrato',
   'Descreva, em uma frase, o que o subempreiteiro vai executar nesta obra.',
   'Deixa claro o escopo contratado — o que está e o que não está incluído no valor.',
   '"Execução da estrutura de concreto armado, incluindo formas, armação e concretagem."',
   'Objeto genérico demais ("serviços diversos") que não permite conferir o escopo depois.', 5),

  ('projetos.subempreiteiro.retencao', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Retenção (%)',
   'Percentual do valor que fica retido por medição (garantia de execução), de 0 a 100. Deixe 0 se não houver retenção.',
   'Registra a retenção prevista no contrato. O cálculo do valor retido por medição é feito no financeiro, na etapa de pagamento.',
   'Contrato com 5% de retenção de garantia: informe 5.',
   'Confundir retenção de garantia com retenção de impostos — aqui é a retenção contratual; os tributos ficam no financeiro.', 6),

  ('projetos.subempreiteiro.data_inicio', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Início',
   'A data prevista (ou real) de início dos serviços deste subempreiteiro. Campo opcional.',
   'Ajuda a acompanhar o cronograma dos terceirizados na obra.',
   '10/11/2026, quando a frente de estrutura começa.',
   'Informar a data de assinatura do contrato quando o campo pede o início dos serviços.', 7),

  ('projetos.subempreiteiro.data_fim', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Fim previsto',
   'A data prevista de conclusão dos serviços deste subempreiteiro. Campo opcional.',
   'Permite monitorar prazos e antecipar atrasos dos terceirizados.',
   '20/12/2026, prazo combinado para a entrega da estrutura.',
   'Deixar em branco quando há prazo contratual — preencha para o cronograma alertar.', 8),

  ('projetos.subempreiteiro.status', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Situação',
   'Escolha a situação do contrato: Rascunho (em elaboração), Ativo (em execução), Concluído ou Cancelado.',
   'Reflete o estágio do contrato e alimenta o filtro e os indicadores da obra.',
   'Mude de Rascunho para Ativo quando o subempreiteiro iniciar os serviços.',
   'Deixar em Rascunho um contrato já em execução — a situação precisa refletir a realidade.', 9),

  ('projetos.subempreiteiro.itens', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Itens do contrato',
   'Lance cada serviço contratado com descrição, unidade, quantidade e preço unitário. O valor de cada linha e o total são calculados automaticamente.',
   'Detalha o escopo e forma o valor do contrato (soma das linhas). É a base para medir e pagar o subempreiteiro por item executado.',
   'Linha "Alvenaria de vedação", unidade m², quantidade 500, preço 45,00 → valor R$ 22.500,00.',
   'Digitar o valor total no lugar dos itens — o valor do contrato vem da soma das linhas; detalhe o escopo.', 10),

  ('projetos.subempreiteiro.item_descricao', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Descrição do item',
   'O que é este item do escopo do subempreiteiro. Só linhas com descrição preenchida são salvas.',
   'Identifica cada serviço contratado para medição e conferência posteriores.',
   '"Armação de pilares e vigas do pavimento tipo."',
   'Deixar a descrição em branco: a linha é ignorada ao salvar.', 11),

  ('projetos.subempreiteiro.observacoes', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Observações',
   'Texto livre e opcional para condições, garantias ou referências do contrato.',
   'Guarda o contexto do contrato para conferência futura, sem precisar abrir o documento original.',
   '"Garantia de 5 anos sobre a estrutura; medição mensal conforme cláusula 4ª."',
   'Usar observação para registrar valores ou itens — esses vão nos campos próprios.', 12),

  ('projetos.subempreiteiro.valor_total', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Valor do contrato',
   'Nada a preencher — é o total calculado a partir dos itens (soma de quantidade × preço de cada linha).',
   'Mostra, antes de salvar, quanto vale o contrato. É o valor que entra no total contratado da obra.',
   'Dois itens de R$ 22.500 e R$ 13.000 resultam em "Valor do contrato R$ 35.500,00".',
   'Esperar que linhas sem descrição entrem no total — só as linhas preenchidas somam.', 13),

  ('projetos.subempreiteiro.editar', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Editar contrato',
   'Clique para abrir o contrato e alterar fornecedor, objeto, retenção, prazos, situação ou itens.',
   'Mantém o contrato atualizado conforme ele evolui (mudança de escopo, prazo ou situação).',
   'Abra "Editar" para marcar o contrato como Concluído ao fim dos serviços.',
   'Excluir e recriar quando bastava editar — editar preserva o contrato e seu histórico.', 14),

  ('projetos.subempreiteiro.excluir', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Excluir contrato',
   'Clique para excluir o contrato e informe o motivo. A exclusão é rastreável: fica registrado quem excluiu e por quê (o contrato não some do histórico).',
   'Remove da lista um contrato lançado por engano ou cancelado, sem apagar o rastro.',
   'Contrato cadastrado na obra errada: exclua informando "lançado na obra errada" e recadastre na obra correta.',
   'Excluir para "editar": use Editar — a exclusão é para contratos que não devem mais valer.', 15)
ON CONFLICT (chave) DO NOTHING;

-- Link "Subempreiteiros →" no cockpit da obra (mesma rota/grupo dos demais atalhos do cockpit).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.cockpit.subempreiteiros', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'hub_projetos',
   'Subempreiteiros',
   'Atalho para a aba Subempreiteiros da obra, onde você cadastra os contratos de mão de obra terceirizada.',
   'Leva à tela de subempreiteiros — o controle de quem executa parte do escopo e sob quais condições.',
   'Abra "Subempreiteiros →" para registrar o contrato da empresa que executa a estrutura.',
   'Procurar os terceirizados no financeiro: o contrato da obra fica aqui, na própria obra.', 11)
ON CONFLICT (chave) DO NOTHING;
