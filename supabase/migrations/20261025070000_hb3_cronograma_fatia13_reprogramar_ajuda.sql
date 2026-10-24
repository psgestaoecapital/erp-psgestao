-- HB3 (fatia 13) · Cronograma da obra: quadro "Reprogramar pelas dependências" (sucessoras ainda não iniciadas que
-- começam antes da predecessora terminar andam para frente, mesma duração). "?" do quadro (RD-95).
-- Aditiva (só texto de ajuda); ON CONFLICT DO NOTHING, sem tocar dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.reprogramar', 'Reprogramar pelas dependências', 'Nada a preencher: confira a lista (datas de hoje → datas novas) e toque em "Reprogramar". O quadro só aparece quando alguma tarefa ficou marcada para antes de a tarefa da qual ela depende terminar.', 'Quando uma etapa atrasa, muda de prazo ou entra uma etapa nova no meio (mudança de escopo), as etapas seguintes que ainda não começaram andam para frente sozinhas, com a mesma duração, respeitando a folga (defasagem) combinada. Tarefa já iniciada não é mexida, e a linha de base continua a mesma para medir o atraso.', 'Alvenaria foi até 20/10, mas o reboco (depende dela, 2 dias de cura) estava marcado para 15/10 a 25/10: passa para 23/10 a 02/11 (+8 d).', 'Reprogramar e depois fixar a linha de base de novo: aí o atraso some da comparação. Fixe a base só quando o cliente aceitar o novo prazo.', 46)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
