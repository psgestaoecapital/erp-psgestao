-- §315 (Hub · Orçamento por EAP) — "?" (RD-95) do novo indicador "Situação do orçamento".
-- Aditiva e idempotente: insere a chave de ajuda consumida por <AjudaCampo chave="projetos.orcamento_eap.situacao" />.
-- Não toca dado de cliente, RLS, grants nem funções. erp_ajuda_campo é catálogo interno de ajuda.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.orcamento_eap.situacao',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Situação',
  'Indicador de leitura: não é digitado aqui. A situação muda no fluxo do orçamento (rascunho → enviado → aprovado/convertido, ou cancelado).',
  'Mostra em que pé está o orçamento desta obra, para saber se já pode virar base de compras e medições (aprovado/convertido) ou se ainda está em elaboração (rascunho) ou aguardando o cliente (enviado).',
  'Enviado = foi apresentado ao cliente e aguarda resposta. Aprovado = cliente aceitou. Convertido = virou contrato/obra.',
  'Tratar um orçamento ainda em "Rascunho" ou "Enviado" como fechado: enquanto não está aprovado, os valores podem mudar.',
  'projetos',
  16,
  1,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
