-- #7050 fatia2 (jordana-code) · RD-95: texto do "?" do novo controle "Nota interna" da conversa do chamado
-- (componente ConversaChamado, lado da equipe PS / Atendimento). ADITIVA e idempotente: só INSERE a chave
-- de ajuda quando ela ainda não existe — nenhuma linha existente muda. Sem DDL de estrutura.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'chamados.conversa.nota_interna',
  '/dashboard/atendimento',
  'Conversa do chamado',
  'Nota interna',
  'Marque quando a mensagem for um recado só para a equipe (diagnóstico, combinado interno, rascunho). Deixe desmarcado para falar com quem abriu o chamado.',
  'A nota interna fica visível apenas para a equipe de atendimento: ela não avisa o autor por e-mail e não leva o chamado para a coluna "Aguardando usuário". A mensagem visível, sim, é entregue ao autor e aguarda a resposta dele.',
  'Nota interna: "Cliente já tem boleto emitido — conferir antes de responder." · Mensagem visível: "Olá! Já corrigimos o cálculo; pode testar de novo?"',
  'Esquecer a nota interna marcada e responder o cliente por engano, ou deixá-la desmarcada e expor um rascunho ainda não revisado ao autor.',
  NULL,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'chamados.conversa.nota_interna'
);
