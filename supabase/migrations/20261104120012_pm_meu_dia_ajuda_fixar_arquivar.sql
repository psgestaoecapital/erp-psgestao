-- PDCA P&M · /dashboard/pm/meu-dia · 94 → ≥95 (aud8 02/11)
-- Gap único (RD-95): nas "Minhas anotações", as ações "fixar/desafixar" (Pin) e "arquivar" (Archive)
-- não tinham AjudaCampo "?"; só "editar" tinha. Adiciona as 2 chaves novas (idempotente).
-- Aditivo: nenhum dado de cliente tocado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('pm.dia.anotacao.fixar', 'Meu dia · Anotações', 'Fixar / desafixar anotação',
  'Ação (não é campo): fixa a anotação no topo da sua lista (ou a solta, se já estiver fixada).',
  'Mantém à vista o lembrete mais importante do dia sem ter de rolar a lista.',
  'Fixar "Ligar para o cliente às 15h" para ela ficar sempre no topo.',
  'Achar que compartilha: a anotação é só sua (privada) — fixar muda apenas a ordem na sua tela.',
  51, '/dashboard/pm/meu-dia', 'pm', 'publicado'),
 ('pm.dia.anotacao.arquivar', 'Meu dia · Anotações', 'Arquivar anotação',
  'Ação (não é campo): tira a anotação da lista ativa, guardando-a no arquivo (não apaga de vez).',
  'Limpa o que já foi resolvido sem perder o registro — a anotação sai da vista, mas continua guardada.',
  'Arquivar "Enviar proposta" depois que a proposta foi enviada.',
  'Confundir com excluir: arquivar não apaga; é reversível e preserva o histórico.',
  52, '/dashboard/pm/meu-dia', 'pm', 'publicado')
ON CONFLICT (chave) DO NOTHING;
