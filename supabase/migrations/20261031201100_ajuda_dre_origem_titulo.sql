-- DRE Consolidado · detalhe da linha: ajuda "?" (RD-95) da coluna Origem. Aditiva: só referência em erp_ajuda_campo.
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('financeiro.dre_consolidado.origem_titulo','/dashboard/financeiro/dre-consolidado','Detalhe da linha','Origem do título',
   'Nada a preencher: mostra se o lançamento veio de uma conta a pagar ou de uma conta a receber.',
   'Contas mistas (resultado financeiro, não operacional) têm os dois lados; a origem explica por que o valor é positivo (recebimento) ou negativo (pagamento) e fecha a soma com a linha do DRE.',
   'a receber: juros recebidos (+) · a pagar: multa (−)','Achar que um título está duplicado: o mesmo fornecedor pode aparecer nos dois lados, cada um com sua origem.','financeiro',9100,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
