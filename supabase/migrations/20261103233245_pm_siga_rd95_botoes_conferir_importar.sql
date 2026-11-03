-- PDCA P&M /dashboard/pm/importar-siga (aud8 90/95) — RD-95 gap menor:
-- os dois botões de ação "Conferir no sistema" e "Importar" não tinham "?" (AjudaCampo).
-- Chaves novas; idempotente via ON CONFLICT (erp_ajuda_campo.chave é UNIQUE).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.siga.conferir', '/dashboard/pm/importar-siga', 'Importar · Ações', 'Conferir no sistema',
   'Ação que simula a importação: confere a planilha contra o que já existe, sem gravar nada ainda.',
   'Mostra, antes de importar, quantos jobs são novos, quais já existem, responsáveis sem usuário e peças fora do catálogo — para você revisar sem risco.',
   'Após escolher a planilha e conferir o mapa das colunas, clicar em "Conferir no sistema" lista o que entraria.',
   'Pular a conferência: sem ela o botão "Importar" fica desabilitado, porque ainda não se sabe o que é novo.',
   'pm', 5, 'publicado'),
  ('pm.siga.importar', '/dashboard/pm/importar-siga', 'Importar · Ações', 'Importar',
   'Ação que grava de fato os jobs NOVOS detectados na conferência (os que já existem não são duplicados).',
   'Conclui a importação do sistema anterior e registra a operação no histórico (data, quem, quantos entraram).',
   'Depois de "Conferir no sistema" indicar, por exemplo, 12 novos, clicar em "Importar 12 job(s)" grava os 12.',
   'Clicar sem conferir antes, ou quando não há jobs novos: o botão fica desabilitado nesses casos.',
   'pm', 6, 'publicado')
ON CONFLICT (chave) DO NOTHING;
