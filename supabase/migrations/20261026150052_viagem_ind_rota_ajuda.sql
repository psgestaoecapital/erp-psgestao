-- Viagem · "?" (RD-95) dos indicadores do "Histórico por rota" na tela /dashboard/projetos/viagens —
-- desenvolvedor_4_g (faixa 52). Gap do auditor PDCA (25/10 03:01, consistência 60): a tabela de indicadores por obra
-- já tinha o "?" em cada coluna numérica, mas os indicadores dos cartões por rota (custo médio, km médio, dias médios,
-- por km, por dia) não tinham — inconsistência com o resto da seção. Esta migration só acrescenta os textos de ajuda;
-- o componente IndicadoresViagem passa a exibir o "?" ao lado de cada um (front-only, mesma fonte fn_viagem_indicadores).
-- ADITIVA: só insere linhas novas em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.rota_custo_medio', 'Indicadores', 'Custo médio da rota', 'Calculado: média do custo total das viagens já fechadas nesta rota (mesma origem → destino).', 'Serve de referência para orçar a mobilização da próxima obra na mesma região.', '3 viagens São Paulo → Campinas somando R$ 1.800 → custo médio R$ 600.', 'Não é o custo de uma viagem só: é a média de todas as viagens fechadas da rota.', 46),
  ('projetos.viagem.rota_km_medio', 'Indicadores', 'Km médio da rota', 'Calculado: média dos km rodados nas viagens fechadas desta rota (km final − km inicial).', 'Estima a distância típica do deslocamento para prever combustível e tempo.', 'Viagens de 95 km e 105 km → km médio 100.', 'Viagem sem km inicial e final não entra na média — registre os dois para o número ficar completo.', 47),
  ('projetos.viagem.rota_dias_medio', 'Indicadores', 'Dias médios da rota', 'Calculado: média de dias de cada viagem fechada da rota (da saída até a volta, contando os dois dias).', 'Dimensiona quantos dias a equipe costuma ficar fora nessa rota.', 'Saída dia 10 e volta dia 12 = 3 dias; com outra de 3 dias, média 3.', 'Não é a soma dos dias de todas as viagens, é a média por viagem.', 48),
  ('projetos.viagem.rota_custo_km', 'Indicadores', 'Custo por km da rota', 'Calculado: soma do custo das viagens com km informado ÷ soma dos km dessas viagens.', 'Compara o custo de deslocamento entre rotas, independente da distância.', 'R$ 1.200 em viagens que somaram 2.000 km → R$ 0,60/km.', 'Só entram viagens com km inicial e final preenchidos.', 49),
  ('projetos.viagem.rota_custo_dia', 'Indicadores', 'Custo por dia da rota', 'Calculado: soma do custo das viagens da rota ÷ soma dos dias dessas viagens.', 'Mostra quanto custa por dia manter a equipe na estrada nessa rota.', 'R$ 3.000 em viagens que somaram 10 dias → R$ 300/dia.', 'É por dia de viagem, não por pessoa: a equipe inteira está no mesmo dia.', 50)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
