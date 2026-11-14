-- RD-95 (CEO 08/10): "?" em TODA ação. Tela /dashboard/pm/meu-dia (aud8 94/95).
-- Gap do auditor: ações de anotação sem "?" (guardar nova · salvar edição · cancelar edição).
-- Aditiva e idempotente: só acrescenta chaves de ajuda em erp_ajuda_campo (catálogo global de referência,
-- sem dado de cliente). ON CONFLICT (chave) DO NOTHING — re-rodar não duplica nem sobrescreve.
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('pm.dia.anotacao.salvar', '/dashboard/pm/meu-dia', 'Meu dia', 'Guardar anotação',
   'Depois de escrever no campo "Nova anotação", clique em Guardar.',
   'Salva a anotação na sua lista pessoal do dia — fica só visível para você.',
   'Escrever "ligar para a Clínica Sorriso às 15h" e clicar em Guardar.',
   'O botão fica desativado enquanto o campo está vazio: escreva algo antes.',
   'pm', 43),
  ('pm.dia.anotacao.editar.salvar', '/dashboard/pm/meu-dia', 'Meu dia', 'Salvar edição',
   'Clique no "✓" para confirmar a alteração do texto da anotação.',
   'Grava o novo texto da anotação que está em edição, mantendo o histórico (atualizado em).',
   'Trocar "15h" por "16h" e clicar no "✓".',
   'Fica desativado com o texto vazio — a anotação não pode ficar em branco.',
   'pm', 44),
  ('pm.dia.anotacao.editar.cancelar', '/dashboard/pm/meu-dia', 'Meu dia', 'Cancelar edição',
   'Clique no "✕" para descartar a edição e voltar ao texto original.',
   'Sai do modo de edição sem gravar nenhuma mudança na anotação.',
   'Começou a editar por engano? Clique no "✕" e nada muda.',
   'Cancelar não apaga a anotação: só descarta a edição em andamento.',
   'pm', 45)
ON CONFLICT (chave) DO NOTHING;
