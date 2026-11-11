-- #6930 — RD-95: o compositor de mensagem da Conversa do chamado (ConversaChamado, usado em
-- /dashboard/melhorias e /dashboard/atendimento) ganhou o "?" do componente padrão AjudaCampo.
-- Esta é a chave de ajuda correspondente. ADITIVA e IDEMPOTENTE: só INSERT de catálogo global de
-- ajuda (sem dado de cliente, sem company_id). A chave é UNIQUE; ON CONFLICT não sobrescreve texto
-- já publicado. O componente lê sempre pela rota canônica "/dashboard/melhorias" (prop rota), então
-- uma única linha atende as duas telas que compartilham o compositor.
INSERT INTO public.erp_ajuda_campo
  (id, chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status, atualizado_em, criado_em)
VALUES (
  gen_random_uuid(),
  'chamados.conversa.mensagem',
  '/dashboard/melhorias',
  'Conversa do chamado',
  'Sua mensagem',
  'Escreva a mensagem para o time que está cuidando do seu chamado. Dá para anexar uma foto ou um print de um novo erro.',
  'O chamado é uma conversa: cada mensagem fica no histórico e devolve o chamado para a equipe, sem encerrar.',
  'O erro continua ao salvar a nota — segue o print da tela em que travou.',
  'Enviar sem descrever o que aconteceu. Diga em que passo travou para a equipe reproduzir o problema.',
  NULL,
  0,
  1,
  'publicado',
  now(),
  now()
)
ON CONFLICT (chave) DO NOTHING;
