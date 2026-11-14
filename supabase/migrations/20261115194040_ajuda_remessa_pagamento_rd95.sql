-- RD-95 · "?" (AjudaCampo) da tela de Remessa de Pagamento CNAB (Sicoob/Sicredi) · Code: code-desenvolvedor-3
--
-- Origem: auditor_pdca_2 (jornada GE · financeiro/pagamento em lote CNAB). A tela
-- /dashboard/financeiro/remessa-pagamento (996 linhas) tinha 0 "?" — bloqueia a entrega (RD-95)
-- e o gate check-ajuda-campo-telas-alteradas. Esta migration cadastra as chaves de ajuda usadas
-- pela tela (filtros, nº da remessa, DV da agência, seleção de títulos, gerar remessa e importar
-- retorno). Texto em linguagem do usuário: o que preencher · para que serve · exemplo · erro comum.
--
-- ADITIVA e IDEMPOTENTE: só INSERT em erp_ajuda_campo com ON CONFLICT (chave) DO UPDATE.
-- Não altera dado de cliente, não toca função/RLS. RD-38: as 7 chaves não existiam na rota
-- (SELECT count(*) FROM erp_ajuda_campo WHERE rota='/dashboard/financeiro/remessa-pagamento' = 0).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('remessa.numero_proxima','/dashboard/financeiro/remessa-pagamento','Remessa','Nº da próxima remessa',
   'O número sequencial que vai no arquivo CNAB desta remessa. Já vem preenchido com o próximo da sequência; só edite se o banco pulou um número ou na virada do sistema anterior.',
   'O banco controla cada remessa por esse número (NSA). Se repetir um número já enviado, o banco pode recusar o arquivo por sequência duplicada.',
   'Última enviada 47 → a próxima vem como 48.',
   'Informar um número menor ou igual ao último enviado: o banco costuma recusar. O sistema avisa em vermelho quando isso acontece.',
   'ge', 10, 1, 'publicado'),

  ('remessa.filtro_vencimento','/dashboard/financeiro/remessa-pagamento','Remessa','Vencimento',
   'Escolha o período de vencimento dos títulos que quer pagar. Use um atalho (vencidos, hoje, 7 dias…) ou "personalizado" para informar as datas De e Até.',
   'Filtra a lista de títulos a pagar por data de vencimento, para você montar a remessa só com o que vence no período escolhido.',
   'Pagar o que vence até sexta: escolha "personalizado" e ponha De hoje, Até a data da sexta.',
   'Deixar um período muito estreito e achar que "sumiram" títulos — eles só estão fora da janela de vencimento escolhida.',
   'ge', 20, 1, 'publicado'),

  ('remessa.filtro_titulos','/dashboard/financeiro/remessa-pagamento','Remessa','Filtrar títulos',
   'Digite parte do nome do fornecedor, da descrição ou da forma de pagamento para encontrar títulos na lista abaixo.',
   'Só filtra o que aparece na tela para facilitar achar um título; não muda quais estão selecionados nem o período de vencimento.',
   'Digite "energia" para ver só as contas de energia.',
   'Esperar que o filtro selecione os títulos — ele só esconde/mostra. A seleção é feita na caixinha de cada linha.',
   'ge', 30, 1, 'publicado'),

  ('remessa.selecionar_titulos','/dashboard/financeiro/remessa-pagamento','Remessa','Selecionar títulos',
   'Marque a caixinha de cada título que deve entrar nesta remessa. Use "Selecionar todos" / "Limpar" para marcar ou desmarcar a lista inteira. Títulos com aviso (⚠) não entram enquanto o motivo não for resolvido.',
   'Define exatamente quais pagamentos vão para o arquivo CNAB. O rodapé mostra o total e a quantidade do que será gerado.',
   'Marque os 5 boletos do fornecedor que vence hoje e confira o total no rodapé.',
   'Marcar um título inelegível (sem chave PIX, sem conta, bloqueado): ele fica de fora e o motivo aparece na própria linha.',
   'ge', 40, 1, 'publicado'),

  ('remessa.dv_agencia','/dashboard/financeiro/remessa-pagamento','Banco','DV da agência',
   'O dígito verificador da agência da cooperativa. Confirme o número com o seu gerente do banco e informe aqui.',
   'Alguns bancos (cooperativas) exigem o DV da agência no arquivo CNAB. Sem ele o arquivo sai inválido e o banco rejeita.',
   'Agência 1234 com DV 7 → informe 7.',
   'Chutar o dígito: se estiver errado o banco recusa o arquivo inteiro. Confirme com o banco antes de salvar.',
   'ge', 50, 1, 'publicado'),

  ('remessa.gerar','/dashboard/financeiro/remessa-pagamento','Remessa','Gerar remessa',
   'Gera o arquivo CNAB com os títulos selecionados. O sistema pede uma confirmação mostrando a quantidade de pagamentos, o total e se é HOMOLOGAÇÃO (teste) ou PRODUÇÃO (paga de verdade).',
   'Produz o arquivo .rem que você sobe no Internet Banking para o banco efetuar os pagamentos. Em PRODUÇÃO, os valores saem da conta quando o banco processa.',
   'Selecionou 8 pagamentos de R$ 12.400 → clique em Gerar, confira e confirme.',
   'Gerar em PRODUÇÃO sem conferir valores e beneficiários. A tarja vermelha avisa quando é produção — revise antes de confirmar.',
   'ge', 60, 1, 'publicado'),

  ('remessa.importar_retorno','/dashboard/financeiro/remessa-pagamento','Retorno','Importar retorno',
   'Suba o arquivo de retorno (.ret/.rem) que você baixou no Internet Banking. O sistema acha sozinho os títulos e dá baixa nos que o banco confirmou — não precisa escolher a remessa.',
   'Dá baixa automática nos títulos pagos a partir da resposta do banco, e mostra os rejeitados e os não reconhecidos (que não baixam e voltam ao status anterior).',
   'Baixou o retorno do dia no banco → importe aqui e confira a prévia antes de confirmar a baixa.',
   'Dar por pago um título "não reconhecido": esses retornos têm código fora do mapa, não baixam e precisam ser conferidos com o banco. Reimportar o mesmo arquivo não baixa de novo.',
   'ge', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
