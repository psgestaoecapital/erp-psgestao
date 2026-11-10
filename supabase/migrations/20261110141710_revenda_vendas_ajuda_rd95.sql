-- RD-95 ("?" em todo indicador/seção/ação) · Revenda · Vendas e entrega (/dashboard/revenda/vendas).
-- Gap do auditor aud8 (score 82): "fluxo de venda com muitos indicadores e botões com apenas 2
-- AjudaCampo '?' — cobertura insuficiente". A tela já tinha '?' em filtro de situação, passo a passo,
-- em aberto (cliente/banco) e emitir NF-e; esta migration cadastra as chaves que faltavam na LISTAGEM:
-- a seção de títulos no financeiro (GE), o resumo de acerto (lucro previsto × realizado) e o grupo de
-- ações da venda (ver veículo, entregar, termo, acerto, devolução e cancelamento) — deixando explícito
-- que devolução e cancelamento ficam registrados/rastreáveis.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente).
-- ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('revenda.vendas.titulos_ge','Vendas e entrega','Títulos no financeiro (GE)',
 'Mostra os títulos gerados no Contas a Receber a partir desta venda (parte do cliente e, quando há financiamento, a do banco), com o número e o status de cada um.',
 'Liga a venda ao financeiro ponta a ponta: por aqui você vê se o título já foi pago, está vencido ou em aberto, e abre o título no Contas a Receber pelo "ver".',
 'Entrada do cliente como um título e o valor financiado como outro, cada um com seu número e status.',
 'Achar que a venda está quitada olhando só o card: confira o status de cada título aqui — "em aberto"/"vencido" ainda não entrou no caixa.',
 4,'/dashboard/revenda/vendas','revenda','publicado'),
('revenda.vendas.acerto_resumo','Vendas e entrega','Lucro previsto × realizado',
 'Resumo rápido da venda entregue: o lucro projetado (preço − custo real) ao lado do lucro já realizado (conta só o que entrou).',
 'Dá, sem abrir o detalhe, a leitura de quanto a venda deveria dar e quanto já deu — o detalhe completo fica no botão "Acerto de contas".',
 'Lucro previsto R$ 6.000 e realizado R$ 2.500 porque metade ainda está em aberto com o banco.',
 'Ler o realizado como resultado final: ele sobe conforme cliente e banco pagam o que está em aberto.',
 5,'/dashboard/revenda/vendas','revenda','publicado'),
('revenda.vendas.acoes','Vendas e entrega','Ações da venda',
 'Botões de cada venda conforme a etapa: ver veículo, Emitir NF-e e Entregar (passa pelo checklist), gerar/assinar o termo, Acerto de contas e, para encerrar, Registrar devolução (venda entregue) ou Cancelar (ainda não entregue).',
 'Conduz a venda até a entrega e o encerramento. Devolução e cancelamento pedem motivo e ficam registrados (a devolução aparece com motivo e data no próprio card), para o encerramento ser rastreável.',
 'Depois de entregue, usar "Registrar devolução" com o motivo; antes de entregar, "Cancelar" trata também o título em aberto no financeiro.',
 'Cancelar/devolver sem conferir os títulos em aberto: o sistema avisa, mas acompanhe o "ver" para tratar o que ficou no Contas a Receber.',
 6,'/dashboard/revenda/vendas','revenda','publicado')
ON CONFLICT (chave) DO NOTHING;
