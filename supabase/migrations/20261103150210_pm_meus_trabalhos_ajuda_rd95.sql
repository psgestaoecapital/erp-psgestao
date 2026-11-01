-- PDCA P&M · /dashboard/pm/meus-trabalhos (aud8 89) · RD-95 "?"
-- Único gap do auditor: faltam 2 "?" nas ações de navegação da tela.
--   1) "Meu dia" (atalho no cabeçalho) -> pm.meus_trabalhos.meu_dia
--   2) "ver na Pauta" (CTA do estado vazio) -> pm.meus_trabalhos.ver_pauta
-- Aditiva/idempotente: só acrescenta as 2 chaves de ajuda (ON CONFLICT DO NOTHING).
-- Nenhuma estrutura alterada; a tela passa a ter "?" com texto em toda ação.

INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.meus_trabalhos.meu_dia', '/dashboard/pm/meus-trabalhos', 'Meus trabalhos', 'Meu dia',
   'Toque para abrir a visão "Meu dia": a sua agenda do dia com os jobs e tarefas priorizados por horário e prazo.',
   'Leva você direto ao foco do dia sem precisar filtrar — o que começar, o que entregar e o que está atrasado hoje.',
   'Clique em "Meu dia" de manhã para ver, em uma tela, tudo o que é seu para hoje.',
   'Confundir com "Meus trabalhos" (lista completa do que é seu); "Meu dia" é só o recorte de hoje.',
   'pm', 12, 'publicado'),
  ('pm.meus_trabalhos.ver_pauta', '/dashboard/pm/meus-trabalhos', 'Meus trabalhos', 'Ver na Pauta',
   'Aparece quando nenhum job está com você: toque para abrir a Pauta da empresa e ver os jobs que estão com outras pessoas.',
   'Mostra que a tela não está quebrada — há jobs na empresa, só não atribuídos a você — e leva à Pauta para acompanhar ou assumir.',
   'Sua fila está vazia mas a empresa tem 8 jobs: clique em "ver na Pauta" para vê-los.',
   'Achar que "nada para você" significa que a empresa não tem jobs; o número ao lado mostra quantos estão com outras pessoas.',
   'pm', 13, 'publicado')
ON CONFLICT (chave) DO NOTHING;
