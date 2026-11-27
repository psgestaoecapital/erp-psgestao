-- Chamado #11433 (cliente, 25/11): na troca de óleo o controle precisa ser mais detalhado
-- (óleo do motor, do câmbio e do diferencial, e o tipo de cada um). A tela de Frota passa a
-- mostrar, quando o tipo da manutenção é "troca de óleo", campos guiados para esses detalhes,
-- que são compostos na descrição do registro (nenhuma coluna/RPC nova — aditivo, front-only).
-- RD-95: cada campo guiado tem o "?" (AjudaCampo); aqui semeamos as 3 chaves de ajuda.
-- Aditivo e idempotente (ON CONFLICT (chave) DO NOTHING). Sem RLS/financeiro: só texto de ajuda.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.frota.oleo_motor', '/dashboard/projetos/frota', 'Frota', 'hub', 929,
   'Óleo do motor',
   'O óleo usado no motor e a sua especificação (viscosidade e tipo).',
   'Registra qual óleo foi posto no motor, para repor o mesmo na próxima troca.',
   '15W40 mineral',
   'Anotar só "trocado": sem a especificação, não dá para saber o que repor.'),
  ('projetos.frota.oleo_cambio', '/dashboard/projetos/frota', 'Frota', 'hub', 930,
   'Óleo da caixa/câmbio',
   'O óleo da caixa de câmbio e a sua especificação, quando houver troca.',
   'Guarda o óleo certo do câmbio no histórico do veículo.',
   '75W90',
   'Confundir o óleo do câmbio com o do motor.'),
  ('projetos.frota.oleo_diferencial', '/dashboard/projetos/frota', 'Frota', 'hub', 931,
   'Óleo do diferencial',
   'O óleo do diferencial e a sua especificação, quando houver troca.',
   'Mantém o controle do diferencial separado do motor e do câmbio.',
   '90 (SAE 90)',
   'Deixar em branco quando o diferencial também foi trocado.')
ON CONFLICT (chave) DO NOTHING;
