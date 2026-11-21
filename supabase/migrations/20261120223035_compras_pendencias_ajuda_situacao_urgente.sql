-- RD-95 · /dashboard/compras/pendencias (Pendências de compra): faltava o "?" (AjudaCampo) em dois
-- INDICADORES da tela — o badge de SITUAÇÃO (pendente/em cotação/comprada) e o badge "urgente".
-- Esta migration cadastra as duas chaves que a tela passa a referenciar. O botão "Ordem de
-- Fornecimento" já tem ajuda própria (chave compras.of.baixar, no componente BotaoOrdemFornecimento).
--
-- Aditivo (RD-55): só INSERT em catálogo de ajuda (erp_ajuda_campo), sem DDL, RLS, função ou dado de
-- cliente. IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING — rodar 2x não duplica nem sobrescreve texto
-- já publicado.
-- Reverter: DELETE FROM public.erp_ajuda_campo WHERE chave IN
--   ('compras.pend.situacao','compras.pend.urgente');

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('compras.pend.situacao', '/dashboard/compras/pendencias', 'Pendências de compra', 'Situação da pendência',
   'Não se digita: é o estágio em que a compra aprovada está. "Pendente" = aprovada, ainda sem cotação; '
   || '"Em cotação" = já existe cotação aberta com fornecedores; "Comprada" = o pedido foi fechado.',
   'Mostra, de relance, o que falta fazer em cada compra e permite filtrar a lista pela etapa do trabalho '
   || 'do comprador.',
   'Pendente → clique em "Gerar cotação" · Em cotação → "Abrir cotação" para comparar fornecedores · Comprada → pedido pronto.',
   'Confundir "Pendente" (sem cotação) com "Em cotação" (já tem fornecedores respondendo): a ação do botão muda conforme a situação.',
   'gestao_empresarial', 6),
  ('compras.pend.urgente', '/dashboard/compras/pendencias', 'Pendências de compra', 'Urgente',
   'Não se digita aqui: a marca "urgente" vem da solicitação de compra, quando o solicitante indicou que o '
   || 'item não pode esperar o rito normal de orçamentos.',
   'Sinaliza ao comprador que a compra deve ser priorizada; compras urgentes podem seguir com menos '
   || 'orçamentos, conforme a alçada configurada da empresa.',
   'Uma peça parada que trava a produção entra como urgente e aparece com o selo vermelho no topo do card.',
   'Tratar como urgente o que não é (ou ignorar o selo): a priorização e a exigência de orçamentos dependem dessa marca.',
   'gestao_empresarial', 7)
ON CONFLICT (chave) DO NOTHING;
