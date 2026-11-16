-- RD-95: "?" na AÇÃO "Desativar" da tela Oficina › Usuários (/dashboard/oficina/usuarios).
-- O auditor (aud8, tela em 90) cobra "?" em toda ação; a ação "Desativar mecânico" ainda não tinha.
-- Aditiva/idempotente: insere/atualiza só a chave de ajuda; nenhuma mudança em RLS, cálculo
-- ou dado de cliente. Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.usuarios.desativar', '/dashboard/oficina/usuarios', 'Usuários da Oficina', 'Desativar mecânico',
   'Tira o acesso de um mecânico que saiu ou não deve mais entrar. Só aparece para mecânico ativo — o Dono não pode ser desativado por aqui.',
   'Encerra o acesso na hora, sem apagar nada: o histórico de serviços e lançamentos que o mecânico fez continua registrado. Se precisar, convide o mecânico de novo com o mesmo e-mail.',
   'Ex.: um mecânico foi desligado — Desativar impede que ele entre, mas as ordens de serviço que ele atendeu seguem no sistema.',
   'Achar que "Desativar" apaga o histórico: não apaga. É só o acesso que é encerrado; o que já foi feito permanece.',
   'oficina', 12, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
