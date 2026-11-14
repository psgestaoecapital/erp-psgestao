-- RD-95: "?" (AjudaCampo) nas AÇÕES da tela /dashboard/compras/documentos-recebidos (NF-e recebidas).
-- PDCA GE (aud8 95/95) apontou ações de maior risco sem ajuda — inclusive o elo crítico
-- "Lançar em Contas a Pagar" (gera financeiro + estoque) e as manifestações na SEFAZ.
-- Aditiva/idempotente: só insere chaves novas em erp_ajuda_campo (catálogo de ajuda, sem dado de cliente).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
 ('compras.docs_recebidos.acao_habilitar', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Habilitar recebimento',
  'Clique para ligar o recebimento automático de notas (Distribuição DF-e) desta empresa. Exige certificado digital A1 válido e o token do provedor de NF-e no cofre.',
  'Liga a busca automática das NF-e emitidas contra o seu CNPJ na SEFAZ, sem precisar pedir o XML a cada fornecedor.',
  'Empresa nova: habilite uma vez; depois as notas chegam sozinhas a cada ciclo.',
  'Se aparecer "Certificado A1 ausente ou expirado", atualize o certificado no cofre antes de habilitar.', 16),

 ('compras.docs_recebidos.acao_sincronizar', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Sincronizar manifestação',
  'Clique para atualizar a situação de manifestação lendo o resumo DF-e. É só leitura: NADA é enviado à SEFAZ.',
  'Alinha o status das notas que já foram manifestadas em outro sistema, para não ficarem fingindo "pendente" aqui.',
  'Depois de manifestar fora do PS, sincronize para as notas saírem de "pendente".',
  'Não confunda com manifestar: este botão não dá ciência nem confirma — apenas lê e atualiza o status.', 17),

 ('compras.docs_recebidos.acao_buscar_agora', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Buscar agora',
  'Clique para forçar uma busca imediata de novas notas na SEFAZ, sem esperar o ciclo automático.',
  'Traz na hora os resumos de NF-e recém-emitidos contra o seu CNPJ (útil quando você sabe que chegou nota nova).',
  'Fornecedor avisou que emitiu? Clique em Buscar agora para já ver o resumo.',
  'Precisa do recebimento DF-e habilitado. Se o botão estiver desligado, habilite primeiro.', 18),

 ('compras.docs_recebidos.acao_processar_pendentes', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Processar pendentes',
  'Clique para manifestar e lançar em Contas a Pagar, de uma vez, todas as notas que estão em "resumo" e ainda não lançadas.',
  'Resolve o lote de notas pendentes num clique, em vez de tratar uma a uma.',
  'Fim do dia com várias notas novas: use Processar pendentes para lançar todas juntas.',
  'Ele gera títulos a pagar reais — confira os fornecedores e valores antes de rodar o lote.', 19),

 ('compras.docs_recebidos.acao_manifestar', '/dashboard/compras/documentos-recebidos', 'Ações da nota', 'gestao_empresarial',
  'Manifestar (Ciência / Confirmar / Recusar)',
  'Registre sua posição sobre a nota: Ciência (sei que existe, sem validar), Confirmar (a operação ocorreu) ou Recusar/Desconhecer (a nota não é da sua empresa).',
  'É a resposta fiscal à SEFAZ. Dar ciência também libera o download do XML completo (itens e duplicatas).',
  'Nota de fornecedor conhecido: dê Ciência para destravar o XML; Recuse só se a nota realmente não for sua.',
  'Recusar (Desconhecimento) tira a nota do fluxo — use apenas quando a nota não pertence à empresa.', 20),

 ('compras.docs_recebidos.acao_puxar_xml', '/dashboard/compras/documentos-recebidos', 'Ações da nota', 'gestao_empresarial',
  'Puxar XML',
  'Clique para pedir o XML completo (itens + duplicatas) de uma nota que veio só como resumo, pela Distribuição DF-e.',
  'Sem o XML completo a nota não tem itens para conferir nem gerar estoque. Este botão traz o arquivo pela SEFAZ.',
  'Nota aparece como "resumo": clique em Puxar XML; ele chega no próximo ciclo (até 30 min).',
  'Não é instantâneo: a SEFAZ libera o XML no próximo ciclo. Não precisa clicar várias vezes.', 21),

 ('compras.docs_recebidos.acao_lancar_pagar', '/dashboard/compras/documentos-recebidos', 'Ações da nota', 'gestao_empresarial',
  'Lançar em Contas a Pagar',
  'Clique para gerar a conta a pagar desta nota e dar entrada no estoque dos itens elegíveis (CFOP + produto vinculado).',
  'É o elo que transforma a NF-e recebida em financeiro e estoque de verdade, sem redigitar.',
  'Nota completa e conferida: clique em Lançar em Contas a Pagar para criar o título e a entrada.',
  'Lançar duas vezes não duplica: a nota já lançada mostra "✓ Lançada". Confira o fornecedor antes de lançar.', 22),

 ('compras.docs_recebidos.acao_devolver', '/dashboard/compras/documentos-recebidos', 'Ações da nota', 'gestao_empresarial',
  'Devolver',
  'Clique para abrir a NF-e de devolução ao fornecedor já pré-preenchida com a chave, o fornecedor e os itens desta nota.',
  'Agiliza a devolução: você não redigita os dados da nota original.',
  'Recebeu mercadoria errada? Use Devolver para emitir a NF-e de devolução a partir desta nota.',
  'A devolução abre a emissão de NF-e; confira itens e quantidades antes de emitir.', 23),

 ('compras.docs_recebidos.acao_desabilitar', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Desabilitar',
  'Clique para pausar o recebimento automático de notas desta empresa. O controle não é apagado — dá para reativar depois.',
  'Para quando a empresa deixa de precisar da busca automática, sem perder a configuração.',
  'Vai migrar o recebimento de empresa: desabilite aqui para parar a busca automática.',
  'Desabilitar não apaga as notas já recebidas; só interrompe a busca de novas.', 24),

 ('compras.docs_recebidos.acao_mutirao', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Mutirão de notas',
  'Abre a tela de mutirão para tratar muitas notas de uma vez (fila + casamento exato em lote).',
  'Acelera o fechamento quando há um volume grande de notas acumuladas para conferir e lançar.',
  'Começo de mês com dezenas de notas: use o Mutirão para resolver em lote.',
  'O mutirão é uma tela separada; você volta para cá ao terminar.', 25),

 ('compras.docs_recebidos.acao_upload_xml', '/dashboard/compras/documentos-recebidos', 'Recebimento DF-e', 'gestao_empresarial',
  'Subir XML (um ou em lote)',
  'Clique para enviar o arquivo XML da nota (ou vários XMLs/.zip de uma vez) direto do seu computador, sem esperar a SEFAZ.',
  'Útil quando o fornecedor já lhe mandou o XML: a nota completa na hora, com itens e duplicatas.',
  'Recebeu o XML por e-mail? Suba aqui e a nota aparece pronta para lançar.',
  'O arquivo tem de ser o XML da NF-e (não o PDF/DANFE). Para muitos, use o envio em lote.', 26)
ON CONFLICT (chave) DO NOTHING;
