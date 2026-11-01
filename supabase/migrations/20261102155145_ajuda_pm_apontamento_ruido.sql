-- PDCA P&M · /dashboard/pm/apontamento-horas · aud8 94/95 · GAP único (RD-95)
-- Code: desenvolvedor_4_g
--
-- O botão "Mostrar/Ocultar ruído de cronômetro" (único elemento interativo da tela
-- sem "?") passa a ter o AjudaCampo chave='pm.apontamento.ruido'. Esta migration cria
-- o texto da ajuda no banco (fonte do componente padrão AjudaCampo / fn_ajuda_campo_listar).
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING; não altera dado de
-- cliente, não toca RLS/grants. Sem mudança funcional além do texto de ajuda.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'pm.apontamento.ruido',
  '/dashboard/pm/apontamento-horas',
  'Lançamentos',
  'Mostrar/ocultar ruído de cronômetro',
  'Botão de ação — não se preenche nada. Clique para alternar entre mostrar e ocultar os lançamentos muito curtos.',
  'Lançamentos de cronômetro com menos de 3 minutos quase sempre são partidas/paradas sem trabalho real (ruído). Ocultá-los deixa a lista só com as horas que de fato contam para a margem do job. Nada é apagado: os lançamentos continuam salvos, apenas ficam escondidos da visão.',
  'Você iniciou e parou o cronômetro por engano e virou um lançamento de 1 min. Com "Ocultar ruído", ele some da lista; clique de novo em "Mostrar ruído" para revê-lo.',
  'Achar que o botão apaga os lançamentos curtos. Ele só mostra/esconde — o dado continua gravado e pode ser reexibido a qualquer momento.',
  'pm',
  21
)
ON CONFLICT (chave) DO NOTHING;
