-- Oficina · Pós-venda (/dashboard/oficina/pos-venda) — RD-95: tela tinha ZERO "?" (AjudaCampo)
-- ============================================================================
-- GAP (PDCA aud8 13/11, 84/95): tela rica e bem construída, mas sem o "?". RD-95: tela sem ajuda
--   não é entregue. Cobre: filtro de janela (60/90/120 dias), indicador "A contatar agora", a leitura
--   dos cartões de acompanhamento (faltam N dias) e a ação de contato (WhatsApp).
-- CORREÇÃO (aditiva, idempotente): 4 chaves em erp_ajuda_campo; o front renderiza <AjudaCampo chave="...">.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica. RD-100: linguagem do cliente, sem terceiro.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.posvenda.janela', '/dashboard/oficina/pos-venda', 'Oficina', 'Contato após (janela)',
   'Escolha depois de quantos dias da última passagem o veículo entra na fila de pós-venda: 60, 90 ou 120 dias.',
   'Define quando lembrar de chamar o cliente de volta; a janela recalcula toda a fila na hora.',
   'Em revisão periódica, 90 dias costuma ser um bom ponto de reconvite.',
   'Diminuir muito a janela e encher a fila de "a contatar" antes da hora.',
   'oficina', 1),

  ('oficina.posvenda.a_contatar', '/dashboard/oficina/pos-venda', 'Oficina', 'A contatar agora',
   'Não é um campo: é a lista de veículos que já passaram da janela e podem ser chamados. Toque em "Chamar no WhatsApp" para enviar um convite e registrar o contato.',
   'Mostra quem está pronto para o reconvite; o botão abre o WhatsApp com uma mensagem-convite e guarda o histórico do contato.',
   '"A contatar agora (3)" = 3 veículos prontos; chamar o primeiro abre o WhatsApp do cliente.',
   'Chamar quem marcou "não quer contato" — esses ficam de fora, respeite a escolha do cliente.',
   'oficina', 2),

  ('oficina.posvenda.acompanhamento', '/dashboard/oficina/pos-venda', 'Oficina', 'Entram em breve / Acompanhando',
   'Não é um campo: são os veículos que ainda não chegaram na janela. Cada cartão mostra a barra de tempo, "faltam N dias" e se há WhatsApp no cadastro.',
   'Deixa ver a fila se formando para se organizar; quando "faltam 0 dias", o veículo sobe para "A contatar agora".',
   'Cartão "faltam 15 dias · tem WhatsApp" = entra na fila em 15 dias e dá para chamar quando chegar a hora.',
   'Esperar o cliente aparecer sozinho — o pós-venda é você quem puxa o retorno.',
   'oficina', 3),

  ('oficina.posvenda.chamar', '/dashboard/oficina/pos-venda', 'Oficina', 'Chamar no WhatsApp',
   'Botão que abre o WhatsApp do cliente com uma mensagem-convite pronta e registra que o contato foi feito.',
   'Faz o reconvite sem digitar do zero e guarda o histórico (enviado, respondeu, agendou, não quis).',
   'Tocar em "Chamar no WhatsApp" e, depois, marcar como foi o contato.',
   'Esquecer de marcar o desfecho do contato — sem isso o acompanhamento fica incompleto.',
   'oficina', 4)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
