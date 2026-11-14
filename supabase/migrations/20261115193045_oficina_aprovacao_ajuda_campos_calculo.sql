-- RD-95 · PDCA oficina/aprovacao (aud8 13/11): na etapa de CÁLCULO (abrir um laudo para orçar) os campos
-- editáveis Preço unitário, Custo (gera a margem), Canal de aprovação, Nome de quem autorizou e Observação
-- não tinham o "?" (AjudaCampo). Só a lista (busca + "Laudos para orçar") e o grupo "Itens" estavam cobertos.
-- Esta migration cadastra as 5 chaves novas que a tela passa a referenciar (src/app/dashboard/oficina/aprovacao).
--
-- Aditivo (RD-55): só INSERT em catálogo de ajuda (erp_ajuda_campo), sem DDL, RLS, função ou dado de cliente.
-- IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING — rodar 2× não duplica nem sobrescreve texto já publicado.
-- Reverter: DELETE FROM public.erp_ajuda_campo WHERE chave IN
--   ('oficina.aprovacao.preco','oficina.aprovacao.custo','oficina.aprovacao.aprovador_nome',
--    'oficina.aprovacao.canal','oficina.aprovacao.observacao');

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.aprovacao.preco', '/dashboard/oficina/aprovacao', 'Oficina', 'Preço unitário (R$)',
   'O valor a cobrar do cliente por este item. Quando a quantidade é maior que 1, é o preço de cada unidade (R$ unit.); o total da linha é calculado sozinho.',
   'É o preço que entra no orçamento e no total que o cliente autoriza. Só itens marcados "Fazer" e com preço informado entram no total.',
   'Pastilha de freio: R$ 180,00 (com qtd 2, o total da linha vira R$ 360,00).',
   'Aprovar o item e deixar o preço em branco: ele fica fora do total e a OS não fatura certo. Alguns itens têm o preço definido no Diagnóstico e aparecem travados aqui.',
   'oficina', 4),
  ('oficina.aprovacao.custo', '/dashboard/oficina/aprovacao', 'Oficina', 'Custo da peça (R$)',
   'Quanto a peça custou para a oficina (valor de compra). Só aparece em itens do tipo peça — a mão de obra vem do apontamento.',
   'Com o custo preenchido, a tela calcula a margem real do item (margem = 1 − custo/preço) e a OS deixa de ficar com "custo não informado". É um dado interno: nunca vai para o cliente.',
   'Peça vendida a R$ 180,00 com custo de R$ 90,00 → margem 50%.',
   'Deixar o custo em branco: a margem fica "não informada". Confundir custo (o que a oficina pagou) com preço (o que o cliente paga).',
   'oficina', 5),
  ('oficina.aprovacao.aprovador_nome', '/dashboard/oficina/aprovacao', 'Oficina', 'Nome de quem autorizou',
   'O nome da pessoa (em geral o cliente) que autorizou o orçamento.',
   'Fica registrado na OS como prova de quem aprovou o serviço, junto com o canal e a data da aprovação.',
   '"João da Silva" ou "Maria — esposa do proprietário".',
   'Deixar em branco quando a aprovação foi presencial/assinada: sem o nome a autorização fica sem responsável identificado.',
   'oficina', 6),
  ('oficina.aprovacao.canal', '/dashboard/oficina/aprovacao', 'Oficina', 'Canal de aprovação',
   'Por onde o cliente autorizou o serviço: presencial (com assinatura na tela), WhatsApp, telefone etc. Toque no canal usado.',
   'Registra a forma da autorização. No canal presencial, abre o quadro de assinatura do cliente; nos demais, a aprovação vale pelo registro do canal e de quem autorizou.',
   'Cliente aprovou pelo WhatsApp → toque em "WhatsApp"; cliente no balcão → "Presencial" e peça a assinatura.',
   'Escolher "Presencial" e não coletar a assinatura; ou trocar de canal depois de assinar (a assinatura é limpa quando o canal muda).',
   'oficina', 7),
  ('oficina.aprovacao.observacao', '/dashboard/oficina/aprovacao', 'Oficina', 'Observação (opcional)',
   'Uma nota livre sobre a aprovação — combinados, ressalvas ou o que o cliente pediu. Campo opcional.',
   'Guarda o contexto da autorização junto da OS, útil para quem for executar ou faturar depois.',
   '"Cliente pediu para adiar a retífica do cabeçote para o próximo mês."',
   'Escrever aqui informação que deveria estar num item do orçamento (ex.: um serviço a cobrar) — o que está na observação não entra no total.',
   'oficina', 8)
ON CONFLICT (chave) DO NOTHING;
