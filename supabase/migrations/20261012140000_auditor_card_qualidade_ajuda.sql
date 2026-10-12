-- Card "Qualidade por vertical" (/admin/auditores): textos do "?" (RD-95). Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Qualidade por vertical', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/admin/auditores', 'admin', 'publicado'
FROM (VALUES
 ('auditor.qualidade.card', 'Qualidade por vertical', 'Nada a preencher: toque numa área para ver as telas dela.', 'Mostra quanto de cada área já passou na auditoria completa e está liberado para uso.', 'Hub: 40% — 8 de 20 telas liberadas.', 'Ler 0% como tela quebrada; pode ser só auditoria ainda não feita.', 1),
 ('auditor.qualidade.veredito', 'Veredito da tela', 'Nada a preencher.', 'Liberada = notas de visual, funcional e consistência a partir de 90, números batendo com o banco e nenhuma função faltando.', 'Bloqueada: funcional 50 de 90.', 'Achar que bloqueada significa fora do ar; a tela funciona, só não atingiu o padrão.', 2),
 ('auditor.qualidade.notas', 'Notas da tela', 'Nada a preencher.', 'Três notas de 0 a 100 dadas pela auditoria; a meta de cada uma é 90.', 'Visual 75 · Funcional 50 · Consistência 55.', 'Comparar notas de auditorias de dias diferentes sem olhar a data.', 3),
 ('auditor.qualidade.gaps', 'O que falta', 'Nada a preencher.', 'Lista exata do que impede a liberação da tela, para virar tarefa.', '9 funções faltando.', 'Corrigir só a nota sem tratar a causa listada.', 4)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
