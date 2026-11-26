-- P&M · tela 135 "Tempo medido SEM clique" (CEO 25/11, go-live da agência piloto) — slice 3a (leitura).
-- RD-95: "?" do cartão "Seu dia — tempo medido sem clique" do Meu dia, que mostra as horas que o
-- sistema estimou em cada job pelo que a pessoa fez hoje (sem cronometrar).
-- ADITIVA e idempotente: só insere 1 chave de ajuda em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Não altera tabela, função, RLS, grant nem dado existente.
-- RD-38 (prova no PR): a chave 'pm.dia.esforco_inferido' não existia (0 linhas); a migration só insere.
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.dia.esforco_inferido', 'Meu dia · Seu dia', 'Seu dia — tempo medido sem clique',
  'Nada para preencher: o sistema estima sozinho. O cartão mostra, por job, quanto tempo você provavelmente dedicou hoje.',
  'Reúne o que você fez no sistema hoje (comentários, mudanças de etapa do job e cronômetro) e estima as horas por job — sem você precisar cronometrar. "Medida" = houve cronômetro; "estimada" = várias ações; "indício" = pouca atividade. O total é limitado à sua jornada. Você confere e confirma no fechamento do dia.',
  'Mexeu em 3 jobs hoje sem ligar o cronômetro: o cartão mostra ~0,8 h no job A (medida), 20 min no B (estimada) e 15 min no C (indício).',
  'Confiar nos minutos ao pé da letra: é uma estimativa pela sua atividade. Ajuste no fechamento do dia quando algo não bater.',
  70, '/dashboard/pm/meu-dia')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
