-- Hub · Obras (lista) — RD-95: "?" do novo indicador "Receita reconhecida" no cartão Resultado da obra.
-- Por que: o cartão mostrava Faturado/Recebido/A receber (só NFS-e) e, logo abaixo, "Resultado realizado"
-- (por competência, inclui pedido/medição). Em obra com receita por pedido mas SEM NFS-e emitida (ex.: empresas
-- DEMO, que não emitem nota), os três primeiros ficavam R$ 0 e a nota dizia "Nada faturado ainda" ao lado de um
-- Resultado positivo — contradição visível. Agora o cartão expõe a "Receita reconhecida" (serviço medido + material
-- faturado por pedido), que é a base do Resultado. Esta linha dá o "?" (RD-95) desse indicador.
-- Aditiva: apenas 1 linha nova em erp_ajuda_campo (idempotente por chave). Não toca dado de cliente, RLS, função,
-- fiscal nem financeiro. Faixa de migration do agente: segundos :10.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'projetos.obras.res_receita_reconhecida',
  '/dashboard/projetos/obras',
  'Resultado',
  'Receita reconhecida',
  'Nada a preencher: receita já reconhecida da obra — serviços medidos mais o material/pedido já faturado ligado a esta obra.',
  'Mostra a receita da obra por competência, mesmo antes de a NFS-e sair. É a base do Resultado realizado abaixo (Receita reconhecida − Custo).',
  'Material/pedido R$ 253.940 + serviço medido R$ 0 = Receita reconhecida R$ 253.940.',
  'Confundir com o Faturado: o Faturado conta só as NFS-e autorizadas; a Receita reconhecida conta o que já foi medido/pedido mesmo sem a nota ter saído.',
  'hub_projetos',
  41
)
ON CONFLICT (chave) DO NOTHING;
