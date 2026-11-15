-- BPO · Nova conversa (/dashboard/bpo/conversas/nova) — RD-95: "?" em todos os campos do formulário
-- ============================================================================
-- GAP (PDCA · auditor_pdca, 14/11, nota 85): a tela "Nova conversa" não tinha NENHUM "?" (AjudaCampo=0).
--   RD-95 pede ajuda em todo campo que o usuário preenche.
-- CORREÇÃO (aditiva, idempotente): nove chaves em erp_ajuda_campo; o front (nova/page.tsx) passa o atributo
--   `ajuda` ao helper <Campo>, que renderiza <AjudaCampo> ao lado do rótulo de cada campo.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- RD-100: linguagem do usuário, sem nome de sistema de terceiros.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('bpo.conversas.nova.empresa', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Empresa',
   'A empresa cliente com quem você vai conversar.',
   'Vincula a conversa ao cliente certo — tudo fica registrado na conta dele.',
   'Comércio Modelo Ltda', 'Sem empresa selecionada a conversa não pode ser iniciada.', 'geral', 10),

  ('bpo.conversas.nova.assunto', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Assunto',
   'Um título curto que resume o motivo do contato.',
   'Ajuda a localizar e organizar a conversa depois, na lista de conversas.',
   'Conciliação de fevereiro', 'Evite assuntos genéricos como "Dúvida" — dificulta achar depois.', 'geral', 20),

  ('bpo.conversas.nova.contexto', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Contexto',
   'A natureza do contato (dúvida geral, fechamento mensal, cobrança de documento, urgência, outro).',
   'Classifica a conversa para priorização e relatórios de atendimento.',
   'Cobrança de documento', '—', 'geral', 30),

  ('bpo.conversas.nova.prioridade', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Prioridade',
   'Quão urgente é este contato (baixa, normal, alta, urgente).',
   'Ordena a fila de atendimento — as urgentes aparecem primeiro em "Para tratar hoje".',
   'Normal', 'Não marque tudo como urgente — perde o efeito de priorização.', 'geral', 40),

  ('bpo.conversas.nova.contato_nome', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Nome do contato',
   'Nome da pessoa no cliente que vai receber a mensagem.',
   'Personaliza a comunicação e identifica com quem se falou.',
   'Maria Silva', '—', 'geral', 50),

  ('bpo.conversas.nova.contato_email', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'E-mail do contato',
   'E-mail da pessoa no cliente, se for enviar por e-mail.',
   'Habilita o canal E-mail para esta conversa.',
   'cliente@empresa.com', 'Preencha o e-mail antes de escolher enviar por E-mail.', 'geral', 60),

  ('bpo.conversas.nova.contato_whatsapp', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'WhatsApp do contato',
   'Número de WhatsApp com código do país e DDD, só dígitos.',
   'Habilita o canal WhatsApp para esta conversa.',
   '5549991234567', 'Inclua DDI (55) e DDD — sem eles o envio por WhatsApp falha.', 'geral', 70),

  ('bpo.conversas.nova.mensagem', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Mensagem inicial',
   'O texto que o cliente vai receber ao abrir a conversa.',
   'É a primeira mensagem registrada e enviada pelos canais escolhidos.',
   'Olá! Estou entrando em contato sobre o fechamento de fevereiro.', '—', 'geral', 80),

  ('bpo.conversas.nova.canais', '/dashboard/bpo/conversas/nova', 'Nova conversa', 'Enviar via',
   'Por quais canais a mensagem sai (Portal, WhatsApp, E-mail). Pode marcar mais de um.',
   'Define onde o cliente recebe o aviso — WhatsApp e E-mail exigem o contato preenchido acima.',
   'Portal + WhatsApp', 'WhatsApp/E-mail ficam desativados até preencher o contato correspondente.', 'geral', 90)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
