-- RD-95: "?" nos FILTROS e AÇÕES da tela de NF-e Emitidas (/dashboard/fiscal/nfe).
-- Gap do auditor (auditor_pdca_2 / aud8): só o botão "Emitir NF-e" do cabeçalho tinha "?";
-- a busca, os filtros (Status, Finalidade, De, Até) e as ações da linha (Consultar agora,
-- Carta de correção, Cancelar) ficavam sem ajuda. Aqui entram as chaves que a tela passou a
-- usar via <AjudaCampo>. Aditivo: só INSERT de texto (ON CONFLICT (chave) DO NOTHING),
-- nunca altera dado de cliente. Code: code-desenvolvedor-3 (faixa de segundos :35–:44).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('fiscal.nfe.busca', 'Filtros', 'Buscar NF-e',
   'Digite parte do nome do destinatário, o número da nota ou a natureza da operação e tecle Enter (ou clique em Filtrar). A busca vale sobre a lista de notas emitidas desta empresa.',
   'Acha rápido uma nota específica sem rolar a lista inteira — útil quando o cliente pergunta por uma venda ou você precisa reemitir/cancelar uma nota pontual.',
   'Digitar "000123" para abrir a NF-e nº 123, ou "Padaria" para ver todas as notas desse destinatário.',
   'Buscar e esquecer de teclar Enter / clicar em Filtrar: o texto digitado só é aplicado quando você confirma a busca.',
   1, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.status', 'Filtros', 'Status (principal)',
   'Escolha a situação da nota: Autorizada (válida na SEFAZ), Processando (enviada, aguardando retorno), Não emitida (só recusas), Cancelada ou Denegada. "Todos" mostra tudo.',
   'Separa o que já está resolvido do que precisa de atenção — por exemplo, achar as notas presas em "Processando" ou as que só tiveram recusa e precisam ser corrigidas.',
   'Filtrar por "Processando" para ver as notas que ainda não voltaram da SEFAZ e usar "Consultar agora".',
   'Confundir "Não emitida (só recusas)" com "Cancelada": a primeira nunca chegou a ser autorizada; a segunda foi autorizada e depois cancelada.',
   2, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.finalidade', 'Filtros', 'Finalidade',
   'Escolha o tipo de operação da nota: Venda/normal, Devolução, Complementar ou Ajuste. "Todas" não filtra por finalidade.',
   'Isola um tipo de documento fiscal — por exemplo, revisar só as devoluções do período ou só as notas complementares.',
   'Filtrar por "Devolução" para conferir todas as notas de devolução emitidas no mês.',
   'Procurar uma devolução com a finalidade em "Venda / normal": a nota não aparece porque o filtro está no tipo errado.',
   3, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.data_inicio', 'Filtros', 'Data inicial (De)',
   'Primeira data do período que você quer ver (data de emissão da nota). Deixe em branco para não limitar o início.',
   'Recorta a lista por período — essencial para fechar o mês, conferir um intervalo específico ou exportar as notas de uma data a outra.',
   'De 01/11/2026 até 30/11/2026 para ver todas as NF-e emitidas em novembro.',
   'Inverter as datas (De maior que Até): a lista vem vazia porque nenhum dia cabe no intervalo.',
   4, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.data_fim', 'Filtros', 'Data final (Até)',
   'Última data do período que você quer ver (data de emissão da nota). Deixe em branco para não limitar o fim.',
   'Fecha o intervalo iniciado em "De" — juntas, as duas datas delimitam o período da consulta.',
   'Até 30/11/2026 para incluir as notas até o último dia do mês.',
   'Esquecer de preencher o "Até" ao mudar o "De": o período fica aberto e a lista traz mais notas do que o esperado.',
   5, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.acao_consultar', 'Ações', 'Consultar agora',
   'Botão que aparece em notas no status "Processando". Clique para consultar a SEFAZ na hora, sem esperar a verificação automática.',
   'Descobre imediatamente se a nota foi autorizada ou rejeitada, em vez de aguardar a rotina periódica — útil quando o cliente precisa da nota no ato.',
   'Uma nota presa em "Processando" há alguns minutos: clicar em "Consultar agora" atualiza o status para Autorizada ou mostra o motivo da recusa.',
   'Insistir em consultar a cada segundo: a SEFAZ pode levar alguns minutos para responder; aguarde um pouco entre as consultas.',
   6, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.acao_carta_correcao', 'Ações', 'Carta de correção (CC-e)',
   'Disponível em notas Autorizadas. Abra para registrar uma correção de informações complementares da nota (texto de 15 a 1000 caracteres).',
   'Corrige pequenos erros sem cancelar e reemitir a nota. A CC-e NÃO pode alterar valores, impostos, dados do destinatário, data de emissão ou regra tributária — nesses casos, cancele e reemita.',
   'Corrigir o endereço de entrega digitado errado: "Onde se lê Rua A 123, leia-se Rua A 132".',
   'Tentar mudar o valor ou o destinatário pela CC-e: a SEFAZ rejeita; para isso é preciso cancelar a nota e emitir outra.',
   7, '/dashboard/fiscal/nfe', 'fiscal', 'publicado'),

  ('fiscal.nfe.acao_cancelar', 'Ações', 'Cancelar nota',
   'Disponível em notas Autorizadas. Abra para cancelar a NF-e na SEFAZ, informando uma justificativa de no mínimo 15 caracteres.',
   'Torna a nota sem efeito fiscal quando a venda não se concretizou ou houve erro que a CC-e não resolve. Prazo legal: 24 horas após a autorização (SEFAZ-SC); depois disso, use carta de correção ou nota de ajuste.',
   'Cancelar uma nota emitida por engano para o cliente errado, com a justificativa "Erro no destinatário — reemissão necessária".',
   'Deixar passar as 24 horas: fora do prazo a SEFAZ recusa o cancelamento e é preciso tratar por nota de ajuste/devolução.',
   8, '/dashboard/fiscal/nfe', 'fiscal', 'publicado')
ON CONFLICT (chave) DO NOTHING;
