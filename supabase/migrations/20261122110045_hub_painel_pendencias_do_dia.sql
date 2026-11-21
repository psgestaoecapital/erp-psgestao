-- Blueprint Hub §310 (relatório 01, reunião 20/11) · "Bloco do dia": aprovações pendentes e
-- orçamentos enviados sem retorno no Dashboard geral do Hub. RD-95: "?" dos dois indicadores.
-- Aditiva: só linhas de ajuda (ON CONFLICT DO NOTHING). Não altera dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('projetos.painel.pendencias.aprovacoes','/dashboard/projetos','Para hoje','hub_projetos',11,'Aprovações pendentes','Indicador calculado, não se preenche. Conta as revisões de escopo de obra que foram solicitadas e ainda aguardam aprovação ou recusa.','Mostra o que depende de uma decisão sua agora para a obra seguir — a revisão só move o contrato depois de aprovada.','2 revisões aguardando','Deixar a revisão parada em "solicitada": o escopo e o valor da obra ficam travados até alguém decidir.'),
('projetos.painel.pendencias.orcamentos_parados','/dashboard/projetos','Para hoje','hub_projetos',12,'Orçamentos sem retorno','Indicador calculado. Conta os orçamentos enviados ao cliente há mais de 7 dias que ainda não foram aprovados nem recusados.','Mostra as propostas esquecidas no cliente — é o momento de ligar e cobrar uma resposta antes de a negociação esfriar.','1 proposta há mais de 7 dias','Esperar o cliente responder sozinho: proposta enviada sem follow-up costuma virar negócio perdido.')
ON CONFLICT (chave) DO NOTHING;
