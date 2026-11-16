-- PDCA GE · /dashboard/financeiro/receber (componente compartilhado ListagemPagarReceberView) · RD-95
-- Code: code-desenvolvedor-3 · auditor_pdca_2 16/11 (aud8 88/95)
--
-- GAP ÚNICO para fechar os 95: 5 ações de linha tinham só tooltip (title=), sem o "?" do padrão AjudaCampo.
-- A tela (.tsx) passa a renderizar <AjudaCampo> nessas ações; aqui criamos as chaves no banco.
-- O componente é compartilhado com /financeiro/pagar (já 95): Conciliar, Duplicar e Excluir existem nos dois
-- lados, então criamos a chave equivalente também para 'pagar' (sem regressão nas que já existem).
-- Aditivo e idempotente (ON CONFLICT (chave) DO NOTHING). Sem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('financeiro.receber.acao_cartao', 'Ações na linha', 'Cartão',
  'Nada a preencher: botão (💳 Cartão) para quando o cliente pagou no cartão. Abre a tela que dá baixa no título do cliente, cria o recebível da adquirente (o valor que a maquininha vai repassar) e lança a taxa como despesa.',
  'Registra o recebimento em cartão do jeito certo: o cliente fica quitado, o dinheiro a receber da adquirente vira um novo título e a taxa fica separada — assim o fluxo de caixa mostra a data real do repasse.',
  'Cliente pagou R$500 no crédito em 1x: clique em Cartão, informe a adquirente e a taxa; o sistema baixa os R$500 e cria o recebível líquido da operadora.',
  'Usar "Marcar recebido" num pagamento em cartão: aí a taxa e a data do repasse da adquirente ficam de fora do controle.',
  24, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),

 ('financeiro.receber.acao_conciliar', 'Ações na linha', 'Conciliar',
  'Nada a preencher: botão (Conciliar) que procura no extrato bancário importado o movimento que corresponde a este título e dá baixa automaticamente ao vincular os dois.',
  'Fecha o título contra o extrato do banco sem digitar nada: o sistema acha o crédito com mesmo valor/data e baixa o recebível já conciliado, evitando baixa manual e divergência com o banco.',
  'O cliente pagou e o crédito já apareceu no extrato: clique em Conciliar, confirme o movimento sugerido e o título é baixado e conciliado de uma vez.',
  'Esperar achar o movimento antes de importar o extrato (OFX) do dia: sem o extrato carregado não há o que conciliar.',
  25, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),

 ('financeiro.receber.acao_duplicar', 'Ações na linha', 'Duplicar',
  'Nada a preencher: botão (📋) que cria um novo lançamento EM ABERTO com os mesmos dados deste título (valor, categoria, cliente, descrição), para você só ajustar o vencimento.',
  'Agiliza lançar uma receita que se repete: em vez de digitar tudo de novo, duplica e muda só o que mudou. A origem e o novo título ficam registrados no histórico.',
  'Mensalidade do mesmo cliente no mês seguinte: Duplicar, trocar o vencimento para o próximo mês e salvar.',
  'Duplicar achando que gera parcelas automáticas: cada clique cria UM título; para várias parcelas use o parcelamento ao criar a receita.',
  26, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),

 ('financeiro.receber.acao_cancelar', 'Ações na linha', 'Cancelar título',
  'Nada a preencher: botão (🚫) para quando o título não vai mais ser recebido (ex.: venda desfeita). O título sai da lista de inadimplentes e fica marcado como CANCELADO — não é exclusão, é recuperável.',
  'Tira da cobrança um título que não será pago, sem apagar o registro: o valor deixa de contar como a receber/vencido, mas o histórico permanece para auditoria e o título pode ser reativado.',
  'O cliente desistiu da compra ainda não paga: clique em Cancelar título; ele some de inadimplentes mas continua consultável como cancelado.',
  'Usar Cancelar no lugar de Excluir (ou vice-versa): cancelar mantém o título como cancelado; excluir remove o lançamento (soft-delete). Para um título já recebido, estorne a baixa antes.',
  27, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),

 ('financeiro.receber.acao_excluir', 'Ações na linha', 'Excluir',
  'Nada a preencher: botão (🗑️) que exclui o lançamento. Fica registrado no histórico (imutável) e é bloqueado se o título estiver conciliado com o extrato.',
  'Remove um título lançado por engano. A exclusão é rastreável (quem/quando) e reversível pelo histórico; títulos conciliados ou baixados exigem desfazer a conciliação/baixa antes.',
  'Lançou a mesma receita duas vezes: exclua a duplicada que ainda não foi recebida nem conciliada.',
  'Tentar excluir um título já conciliado: o sistema bloqueia e pede para desvincular no inbox de conciliação antes.',
  28, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),

 ('financeiro.pagar.acao_conciliar', 'Ações na linha', 'Conciliar',
  'Nada a preencher: botão (Conciliar) que procura no extrato bancário importado o débito que corresponde a esta conta e dá baixa automaticamente ao vincular os dois.',
  'Fecha a conta contra o extrato do banco sem digitar nada: o sistema acha o débito com mesmo valor/data e baixa o pagamento já conciliado, evitando baixa manual e divergência com o banco.',
  'A conta foi paga e o débito já apareceu no extrato: clique em Conciliar, confirme o movimento sugerido e a conta é baixada e conciliada de uma vez.',
  'Esperar achar o movimento antes de importar o extrato (OFX) do dia: sem o extrato carregado não há o que conciliar.',
  25, '/dashboard/financeiro/pagar', 'gestao_empresarial', 'publicado'),

 ('financeiro.pagar.acao_duplicar', 'Ações na linha', 'Duplicar',
  'Nada a preencher: botão (📋) que cria uma nova conta EM ABERTO com os mesmos dados desta (valor, categoria, fornecedor, descrição), para você só ajustar o vencimento.',
  'Agiliza lançar uma despesa que se repete: em vez de digitar tudo de novo, duplica e muda só o que mudou. A origem e a nova conta ficam registradas no histórico.',
  'Aluguel do mês seguinte: Duplicar, trocar o vencimento para o próximo mês e salvar.',
  'Duplicar achando que gera parcelas automáticas: cada clique cria UMA conta; para várias parcelas use o parcelamento ao criar a despesa.',
  26, '/dashboard/financeiro/pagar', 'gestao_empresarial', 'publicado'),

 ('financeiro.pagar.acao_excluir', 'Ações na linha', 'Excluir',
  'Nada a preencher: botão (🗑️) que exclui a conta. Fica registrado no histórico (imutável) e é bloqueado se a conta estiver conciliada com o extrato.',
  'Remove uma conta lançada por engano. A exclusão é rastreável (quem/quando) e reversível pelo histórico; contas conciliadas ou pagas exigem desfazer a conciliação/baixa antes.',
  'Lançou a mesma despesa duas vezes: exclua a duplicada que ainda não foi paga nem conciliada.',
  'Tentar excluir uma conta já conciliada: o sistema bloqueia e pede para desvincular no inbox de conciliação antes.',
  28, '/dashboard/financeiro/pagar', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
