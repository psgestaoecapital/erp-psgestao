-- ONDA 1 (HUB) · Item de composição unificado — ajuda ("?") da faixa de flutuação de custo.
-- Aprovado pelo CEO 03/11. Code: desenvolvedor_4_g.
--
-- RD-95: todo indicador de tela tem o "?" com a chave existente no banco. Esta migration semeia
-- a chave de ajuda da faixa de flutuação de custo (tela /dashboard/orcamentos, Editar orçamento),
-- que consome fn_orcamento_custos_revisar (slice 1, #3880, só leitura).
--
-- Aditiva e idempotente: INSERT com ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES (
  'orcamentos.flutuacao_custo',
  '/dashboard/orcamentos',
  'Orçamento',
  'gestao_empresarial',
  'Aviso de flutuação de custo',
  'Nada a preencher — é um aviso automático. Toque em "Revisar" para ver quais itens mudaram de custo.',
  'Mostra os itens vindos do catálogo cujo custo do estoque mudou (por uma nova compra) depois que entraram no orçamento. Serve para você decidir se atualiza o preço antes de enviar: o custo gravado no item continua o mesmo até você revisar. Só aparece em orçamento ainda aberto; orçamento aprovado congela o custo do momento da aprovação.',
  'O item "Cimento CP-II" entrou com custo R$ 32,00 e hoje o estoque está a R$ 35,50: o aviso mostra "custo subiu de R$ 32,00 para R$ 35,50 (+R$ 3,50 · +10,94%)".',
  'Ignorar o aviso e enviar o orçamento com margem defasada: se o custo subiu e você não revisou, a margem real fica menor que a exibida.',
  0
)
ON CONFLICT (chave) DO NOTHING;
