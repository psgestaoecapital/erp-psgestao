-- Hub · Gestão de Obras · aba Subempreiteiros → seção MEDIÇÕES (Blueprint §16 H7 · slice 2a/UI). Code: desenvolvedor_4_g.
--
-- RD-95: todo campo / filtro / indicador / ação da nova seção "Medições" (dentro de cada contrato de
-- subempreiteiro, em /dashboard/projetos/obras/[id]/subempreiteiros) tem o "?" com a chave no banco.
-- A seção consome RPCs JÁ publicadas e guardadas (#5229: fn_obra_subempreiteiro_medicao_listar/_salvar/
-- _excluir) — esta migration NÃO cria/altera tabela nem função: só insere linhas de ajuda.
-- A ponte da medição aprovada → [→GE] erp_pagar (retenção/INSS/ISS) é o slice 2b (sensível), fora daqui.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo global de
-- ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.subempreiteiro.medicoes', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Medições do subempreiteiro',
   'Nada a preencher — abre a lista das medições deste contrato (o quanto foi executado/medido por período).',
   'Reúne, por contrato, cada medição do subempreiteiro: competência, valor bruto, retenção e líquido. É a base para acompanhar o executado e, depois, gerar o pagamento no financeiro.',
   'Abra "Medições" no contrato da estrutura para ver a medição de novembro de R$ 40.000 com 5% de retenção.',
   'Procurar as medições no financeiro: elas ficam aqui, dentro do próprio contrato do subempreiteiro.', 16),

  ('projetos.subempreiteiro.medicao_nova', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Nova medição',
   'Clique para lançar uma medição do subempreiteiro: competência, data, valor bruto medido e situação.',
   'Registra o quanto foi executado/medido no período. O líquido é calculado com a retenção do contrato; o pagamento em si é gerado no financeiro, em etapa própria.',
   'Fechou a medição do mês? Abra "Nova medição", informe a competência e o valor bruto executado.',
   'Lançar o valor do contrato inteiro como uma medição — meça só o que foi executado no período.', 17),

  ('projetos.subempreiteiro.medicao_competencia', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Competência',
   'O mês de referência da medição (mês/ano). Campo opcional, mas recomendado para organizar por período.',
   'Agrupa as medições por mês, para acompanhar o avanço do subempreiteiro ao longo da obra.',
   'Novembro/2026 para a medição referente ao executado em novembro.',
   'Usar a data de pagamento no lugar do mês do serviço — a competência é o período medido.', 18),

  ('projetos.subempreiteiro.medicao_data', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Data da medição',
   'A data em que a medição foi feita/fechada. Se deixar em branco, assume a data de hoje.',
   'Registra quando a medição foi apurada, para o histórico e a ordem das medições do contrato.',
   '30/11/2026, dia do fechamento do boletim de medição.',
   'Confundir a data da medição com a competência — a data é quando mediu; a competência é o mês medido.', 19),

  ('projetos.subempreiteiro.medicao_valor_bruto', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Valor bruto medido',
   'O valor total executado/medido no período, antes de qualquer retenção. Deve ser maior que zero.',
   'É a base do cálculo: sobre ele aplica-se a retenção do contrato para chegar ao líquido. Entra no acompanhamento do executado do subempreiteiro.',
   'Mediu R$ 40.000 de serviços no mês: informe 40.000,00.',
   'Informar o valor já com a retenção descontada — aqui é o bruto; o líquido é calculado automaticamente.', 20),

  ('projetos.subempreiteiro.medicao_status', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Situação da medição',
   'Escolha Rascunho (em conferência), Aprovada (medição fechada e aceita) ou Cancelada.',
   'Reflete o estágio da medição. A geração do pagamento a partir da medição aprovada é tratada no financeiro, em etapa própria.',
   'Marque "Aprovada" quando a medição for conferida e aceita pela obra.',
   'Deixar como Rascunho uma medição já aceita — a situação precisa refletir a conferência real.', 21),

  ('projetos.subempreiteiro.medicao_observacoes', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Observações da medição',
   'Texto livre e opcional: referência do boletim de medição, nota, condições ou ressalvas.',
   'Guarda o contexto da medição para conferência futura, sem abrir o documento original.',
   '"Boletim de medição 03; glosa de R$ 2.000 por item não concluído."',
   'Usar a observação para registrar o valor — o valor vai no campo "Valor bruto medido".', 22),

  ('projetos.subempreiteiro.medicao_liquido', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Líquido da medição',
   'Nada a preencher — é o valor bruto menos a retenção do contrato (bruto − bruto × retenção%).',
   'Mostra, antes de salvar, quanto ficaria líquido após a retenção de garantia. É o valor de referência para o pagamento, gerado no financeiro em etapa própria.',
   'Bruto R$ 40.000 com 5% de retenção → líquido R$ 38.000,00 (retenção R$ 2.000,00).',
   'Confundir a retenção de garantia (mostrada aqui) com os tributos (INSS/ISS), que são apurados no financeiro.', 23),

  ('projetos.subempreiteiro.medicao_editar', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Editar medição',
   'Clique para abrir a medição e alterar competência, data, valor bruto, situação ou observações.',
   'Mantém a medição correta após conferência (ajuste de valor, mudança de situação para Aprovada).',
   'Abra "Editar" para marcar a medição como Aprovada depois de conferida.',
   'Excluir e recriar quando bastava editar — editar preserva a medição e seu histórico.', 24),

  ('projetos.subempreiteiro.medicao_excluir', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Excluir medição',
   'Clique para excluir a medição e informe o motivo. A exclusão é rastreável: fica registrado quem excluiu e por quê (a medição não some do histórico).',
   'Remove da lista uma medição lançada por engano ou duplicada, sem apagar o rastro.',
   'Medição lançada no contrato errado: exclua informando "lançada no contrato errado" e refaça no contrato certo.',
   'Excluir para "editar": use Editar — a exclusão é para medições que não devem mais valer.', 25)
ON CONFLICT (chave) DO NOTHING;
