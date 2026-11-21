-- RD-95 (/dashboard/ehs/cockpit · Cockpit SST): os 3 contadores do topo
-- (Setores, Postos, Pessoas) não tinham "?" — auditoria aud8. Esta migration
-- cadastra os 3 textos de ajuda que faltavam para o componente padrão AjudaCampo
-- (o page.tsx passa a renderizar <AjudaCampo> em cada KPI).
-- Aditiva/idempotente: só texto de ajuda novo (erp_ajuda_campo), sem dado de cliente,
-- sem RLS, sem cálculo. Faixa de segundos :45 (desenvolvedor_4_g).
-- ON CONFLICT (chave) DO NOTHING garante reexecução segura.
-- Code: desenvolvedor_4_g
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cockpit SST', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/cockpit', 'compliance', 'publicado'
FROM (VALUES
 ('ehs.cockpit.kpi_setores', 'Setores',
  'Não preenche nada: é um indicador. Mostra quantos setores da empresa selecionada estão cadastrados na matriz de SST.',
  'É a base da cobertura: cada setor precisa ter riscos, EPIs e treinamentos mapeados. Quanto mais setores sem mapeamento, maior o risco legal (NR).',
  'A empresa tem 8 setores cadastrados → o KPI mostra 8. Os cards de "Cobertura da matriz" dizem quantos desses já têm risco/EPI/treino.',
  'Achar que "8 setores" significa "8 setores prontos": o número é só o total cadastrado — confira a cobertura logo abaixo.',
  22),
 ('ehs.cockpit.kpi_postos', 'Postos',
  'Não preenche nada: é um indicador. Mostra o total de postos de trabalho cadastrados nos setores da empresa selecionada.',
  'O posto é onde a pessoa trabalha; EPI e treinamento são exigidos por posto. Postos sem EPI/treino aparecem como lacuna na cobertura.',
  'Se os 8 setores somam 75 postos, o KPI mostra 75; "Postos com EPI" e "Postos com treinamento" dizem quantos já estão cobertos.',
  'Confundir posto com pessoa: um posto pode ter várias pessoas, e uma pessoa ocupa um posto — o KPI "Pessoas" é separado.',
  24),
 ('ehs.cockpit.kpi_pessoas', 'Pessoas',
  'Não preenche nada: é um indicador. Mostra quantas pessoas estão alocadas nos postos da empresa selecionada.',
  'É a base da herança: cada pessoa herda os riscos, EPIs e treinamentos do posto onde está. Pessoas sem posto não herdam e ficam com gap.',
  'Se há 252 pessoas alocadas, o KPI mostra 252; o card "Herança (pessoas)" diz quantas estão com cobertura completa e quantas com gap.',
  'Supor que toda pessoa tem cobertura: veja "com gap" no card de Herança para saber quantas ainda faltam EPI/treino.',
  26)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
