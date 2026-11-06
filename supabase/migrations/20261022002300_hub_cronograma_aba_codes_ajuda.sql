-- Cronograma de conclusão do Hub na aba Codes (CEO 21/10) — ajuda "?" dos indicadores (RD-95).
-- Code: gilberto-desenv. ADITIVA: só INSERT em erp_ajuda_campo (catálogo), idempotente por chave.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma do Hub', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'hub', 'publicado'
FROM (VALUES
  ('dev.codes.hub_progresso', 'Progresso até 100%',
   'Não preenche — é um indicador. Mostra a fração das telas do Hub que já estão "pronto".',
   'Acompanhar a marcha do Hub até 100% antes de chamar o auditor e escrever o manual.',
   '62% das 21 telas prontas', 'Achar que 100% aqui já significa auditado — ainda falta o auditor e a validação.', 10),
  ('dev.codes.hub_status', 'Status das telas',
   'Não preenche — classificação automática pelo estado_real de cada tela em system_screens.',
   'Separar o que está Feito (pronto), Em produção (parcial) e Falta (desconhecida/placeholder).',
   'Feito: 13 · Em produção: 6 · Falta: 2', 'Confundir "Em produção" com concluído: ainda precisa virar "pronto".', 20),
  ('dev.codes.hub_passos_finais', 'Passos até o manual',
   'Não preenche — é a sequência fixa de encerramento do Hub.',
   'Lembrar a ordem: telas 100% → auditor roda na demo → validação → manual do Hub.',
   'Telas 100% → Auditor → Validação → Manual', 'Escrever o manual antes do auditor validar a vertical.', 30)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
