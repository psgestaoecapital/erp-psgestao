-- RD-95 (CEO 08/10): ajuda "?" nos campos do painel "Importar extrato bancário (.ofx)" da Conciliação
-- (/dashboard/financeiro/conciliacao/inbox). O auditor PDCA apontou campos sem "?" no fluxo de importação:
-- a seleção da conta bancária do extrato e o seletor do arquivo .OFX não tinham ajuda, apesar de o botão
-- "Importar extrato (OFX)" já ter "?". Esta PR traz "?" a esses dois campos.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/financeiro/conciliacao/inbox', 'financeiro', 'publicado'
FROM (VALUES
 ('financeiro.conciliacao.import_conta', 'Importar OFX', 'Conta bancária do extrato',
  'Escolha a conta bancária a que este extrato pertence, entre as contas que você já cadastrou.',
  'Garante que os lançamentos do arquivo entrem na conta certa. A conciliação ainda confere o número da conta que vem dentro do próprio OFX e avisa se não bater com a conta escolhida.',
  'Baixou o OFX da conta corrente do Banco do Brasil → selecione aqui "BB · Conta Corrente" antes de subir o arquivo.',
  'Selecionar a conta errada: os movimentos iriam para outra conta. Se o número do OFX não bater com a conta escolhida, o sistema bloqueia a importação.',
  21),
 ('financeiro.conciliacao.import_arquivo', 'Importar OFX', 'Arquivo .OFX do banco',
  'Suba o arquivo .OFX do extrato que você baixou no internet banking do seu banco.',
  'É a origem dos movimentos a conciliar: cada lançamento do extrato vira uma linha para casar com um título a pagar/receber. O arquivo é lido no seu navegador — nada é enviado a terceiros.',
  'No internet banking, exporte o extrato do período no formato OFX e selecione esse arquivo aqui. Funciona com qualquer banco.',
  'Subir PDF ou planilha no lugar do OFX: só o formato .OFX (ou .QFX) é aceito. Baixe a opção "OFX / money" no seu banco.',
  22)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
