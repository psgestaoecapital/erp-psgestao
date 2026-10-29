-- Hub · Cockpit da obra: "?" (RD-95) dos indicadores novos — IDP, IDC, gasto por dia e composição de custo/receita.
-- Aditiva: só texto de ajuda (erp_ajuda_campo), sem dado de cliente. Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.cockpit.idp', 'Cards do cockpit', 'Ritmo (IDP)',
  'Nada a preencher: usa data de início, prazo e % físico de "Dados da obra".',
  'Divide o avanço físico pelo tempo já consumido do prazo. Acima de 1,00 a obra está no ritmo ou à frente; abaixo, atrasada.',
  'Físico 40% com 50% do prazo gasto = 0,80 (atrás do ritmo).',
  'Deixar a data de início em branco: sem ela o índice não aparece.',
  22, '/dashboard/projetos/obras/[id]/cockpit'),
 ('projetos.cockpit.idc', 'Cards do cockpit', 'Eficiência de custo (IDC)',
  'Nada a preencher: usa custo previsto, % físico e custo realizado.',
  'Compara o custo que deveria ter sido gasto pelo que já foi executado com o custo realizado. Acima de 1,00 está gastando menos que o esperado.',
  'Previsto R$ 100 mil, físico 50%, custo real R$ 60 mil = 0,83 (gastando demais).',
  'Esquecer de atualizar o % físico: o índice fica distorcido.',
  23, '/dashboard/projetos/obras/[id]/cockpit'),
 ('projetos.cockpit.burn', 'Cards do cockpit', 'Gasto por dia',
  'Nada a preencher: custo realizado dividido pelos dias desde o início da obra.',
  'Mostra o ritmo médio de gasto para projetar quando o orçamento acaba.',
  'Custo R$ 60 mil em 30 dias = R$ 2 mil por dia.',
  'Ler como gasto de hoje: é a média desde o início.',
  24, '/dashboard/projetos/obras/[id]/cockpit'),
 ('projetos.cockpit.comp_custo', 'Cards do cockpit', 'Composição do custo',
  'Nada a preencher: soma dos custos lançados por origem.',
  'Mostra onde o dinheiro está indo: material, viagens, mão de obra e rateio, em valor e percentual.',
  'Mão de obra 55% do custo = principal alavanca de economia.',
  'Esperar rateio sem lançar as horas de mão de obra.',
  25, '/dashboard/projetos/obras/[id]/cockpit'),
 ('projetos.cockpit.comp_receita', 'Cards do cockpit', 'Composição da receita',
  'Nada a preencher: receita realizada por origem.',
  'Separa o que veio de serviço medido do que veio de venda de material à obra.',
  'Serviço 70% e material 30% da receita realizada.',
  'Achar que a receita de material é medição de serviço.',
  26, '/dashboard/projetos/obras/[id]/cockpit')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
