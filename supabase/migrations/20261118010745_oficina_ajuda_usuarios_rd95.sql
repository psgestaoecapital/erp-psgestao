-- RD-95: "?" na tela Oficina › Usuários (/dashboard/oficina/usuarios).
-- O auditor (PDCA) cobra "?" em todo campo/indicador/ação. Esta tela tinha 0 AjudaCampo:
-- o campo de convite (e-mail do mecânico) e a lista "Quem tem acesso" ficavam sem ajuda.
-- Aditiva/idempotente: só insere/atualiza chaves de ajuda; nenhuma mudança em RLS, cálculo
-- ou dado de cliente. Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.usuarios.convidar_email', '/dashboard/oficina/usuarios', 'Usuários da Oficina', 'Convidar mecânico (e-mail)',
   'Digite o e-mail do mecânico que vai usar o sistema. Ele recebe um convite por e-mail e cria a própria senha.',
   'Dá acesso ao mecânico sem expor valores, margem nem comissão dos outros — ele só enxerga a fila de serviço dele. O papel é sempre Mecânico; esta tela não cria Dono.',
   'Ex.: joao.silva@suaoficina.com',
   'Digitar o e-mail errado: o convite vai para a caixa errada e o mecânico não consegue entrar. Confira antes de enviar.',
   'oficina', 10, 'publicado'),
  ('oficina.usuarios.acesso', '/dashboard/oficina/usuarios', 'Usuários da Oficina', 'Quem tem acesso',
   'Lista de quem já pode entrar nesta oficina, com o papel (Dono/Mecânico) e a situação (Ativo, Inativo, Nunca entrou).',
   'Mostra sua equipe e o estado de cada acesso. Use "Desativar" para tirar o acesso de um mecânico que saiu — o histórico do que ele fez permanece.',
   'Ex.: um mecânico que não entra há 30 dias aparece como "Inativo 30d".',
   'Desativar o próprio Dono: a tela não oferece isso de propósito — só é possível desativar mecânico.',
   'oficina', 11, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
