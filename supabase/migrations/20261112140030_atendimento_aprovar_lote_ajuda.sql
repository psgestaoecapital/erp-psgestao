-- #7050 · Fila de Atendimento · aprovação em lote — RD-95 "?" da seleção de chamados.
-- Code: rodrigo-code. Aditiva e idempotente (catálogo global de ajuda, sem company_id, sem dado de cliente).
-- Prova RD-38: antes SELECT count(*) FROM public.erp_ajuda_campo WHERE chave='atendimento.aprovar_lote'; => 0 ; depois => 1.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('atendimento.aprovar_lote', '/dashboard/atendimento', 'Fila de Atendimento', NULL,
   'Selecionar para aprovar em lote',
   'Marque a caixinha dos chamados cuja resposta você já conferiu. Depois use "Conferir e aprovar selecionados".',
   'Aprova e envia ao autor várias respostas de uma vez, sem abrir chamado por chamado. Cada aprovação fica registrada com o seu nome e o horário.',
   'Marcar #5622, #5659 e #5662 → "Conferir e aprovar selecionados (3)" → conferir o resumo → "Aprovar e enviar ao autor".',
   'Aprovar sem ler: o resumo mostra o início de cada resposta e se há PR vinculada — confira antes de confirmar.', 80)
ON CONFLICT (chave) DO NOTHING;
