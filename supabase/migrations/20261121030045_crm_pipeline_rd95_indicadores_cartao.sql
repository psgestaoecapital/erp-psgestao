-- RD-95: ajuda de campo ("?") no Funil de vendas do CRM (/dashboard/crm/pipeline).
-- Auditoria aud8 19/11 (nota 87/95): os 3 indicadores do topo e o cartão de negócio estavam sem "?".
-- "Previsão (ponderado)" já tinha crm.pipeline.ponderado; aqui entram os outros dois indicadores
-- ("Em aberto", "Ganhos em 30 dias") e uma ajuda do cartão (o que cada cartão do quadro mostra).
-- Aditiva e idempotente: tabela global de referência (sem company_id), chave única; re-rodar só atualiza o texto.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'crm.pipeline.em_aberto',
    '/dashboard/crm/pipeline',
    'Em aberto',
    'Você não preenche: o sistema conta os negócios que ainda estão em andamento neste funil (nenhuma etapa de ganho ou perda) e soma o valor deles.',
    'Mostra, de um olhar, quantos negócios estão vivos e quanto dinheiro está em jogo no funil agora — antes de qualquer peso por probabilidade.',
    'Se aparece "8 · R$ 120.000", são 8 negócios em andamento somando R$ 120 mil em valor cheio.',
    'Comparar este número com o "Previsão (ponderado)" e achar que está errado: aqui é o valor cheio; lá o valor já descontado pela chance de fechar.',
    'crm',
    10
  ),
  (
    'crm.pipeline.ganhos_30d',
    '/dashboard/crm/pipeline',
    'Ganhos em 30 dias',
    'Você não preenche: o sistema conta os negócios movidos para uma etapa de ganho nos últimos 30 dias e soma o valor fechado.',
    'Mede o resultado recente da equipe neste funil — quanto já foi efetivamente ganho no último mês, para acompanhar o ritmo de vendas.',
    'Se aparece "3 · R$ 45.000", foram 3 negócios ganhos no último mês, somando R$ 45 mil.',
    'Achar que conta propostas em aberto: só entra aqui o que foi marcado como ganho, não o que ainda está em negociação.',
    'crm',
    11
  ),
  (
    'crm.pipeline.cartao',
    '/dashboard/crm/pipeline',
    'Cartão do negócio',
    'Cada cartão é um negócio do funil. Ele mostra o título, o cliente, o valor, há quantos dias está parado na etapa, o responsável e as ações (WhatsApp e "Mover para").',
    'Resume o negócio para você decidir a próxima ação sem abrir a ficha. A borda e os dias mudam de cor (semáforo) quando o negócio está parado tempo demais: verde em dia, amarelo atenção, vermelho atrasado.',
    'Um cartão com borda vermelha e "12 dias na etapa" é um negócio travado — vale um WhatsApp ou mover para a próxima etapa.',
    'Ignorar a cor do cartão: o vermelho avisa que o negócio está parado além do esperado para a etapa e pode esfriar.',
    'crm',
    12
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = 'publicado',
  atualizado_em = now();
