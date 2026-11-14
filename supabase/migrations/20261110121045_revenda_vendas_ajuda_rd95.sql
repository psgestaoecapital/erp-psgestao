-- PDCA Revenda /dashboard/revenda/vendas (aud8 82): RD-95 ("?" nos controles e indicadores principais da venda).
-- 1ª passada: filtro de situação, passo a passo (etapas) e os indicadores de "em aberto". A nota sobe PR a PR.
-- Aditiva e idempotente (só adiciona chaves de ajuda). Code: desenvolvedor_4_g
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('revenda.vendas.filtro_situacao','/dashboard/revenda/vendas','Vendas e entrega','Filtro por situação',
   'Escolha a situação para ver só as vendas naquele estágio (todas, aberta, faturada, entregue, devolvida, cancelada).',
   'Foca a lista no que você quer tratar agora — por exemplo, só as "faturada" que ainda faltam entregar.',
   'Selecionar "faturada" → só as vendas com nota emitida esperando a entrega.',
   'Esquecer o filtro em "entregue" e achar que não há vendas em aberto.','revenda',1,1,'publicado'),
  ('revenda.vendas.passos','/dashboard/revenda/vendas','Vendas e entrega','Passo a passo da venda',
   'Nada a preencher — mostra em que etapa a venda está: Faturada → Checklist → Termo → Entregue.',
   'Diz, numa olhada, o que já foi feito e qual é o próximo passo até a entrega. A entrega exige o checklist dos itens obrigatórios.',
   '✓ Faturada · • Checklist (etapa atual) · ○ Termo · ○ Entregue.',
   'Tentar entregar antes de concluir o checklist obrigatório.','revenda',2,1,'publicado'),
  ('revenda.vendas.em_aberto','/dashboard/revenda/vendas','Vendas e entrega','Cliente deve / Banco deve / Recebido',
   'Nada a preencher — "cliente deve" e "banco deve" são o que ainda está EM ABERTO no financeiro (o que já foi pago não entra); "recebido" é o que já entrou.',
   'Mostra quanto ainda falta receber de cada parte da venda, lendo os títulos reais do Contas a Receber (fonte única).',
   'Cliente deve R$ 5.000,00 · banco deve R$ 0,00 · recebido R$ 30.000,00.',
   'Confundir o valor da venda com o que falta receber: aqui é só o saldo em aberto.','revenda',3,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
