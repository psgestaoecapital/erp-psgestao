-- Viagem · consumo do veículo (auditor 24/10, gap "Abastecimento na viagem" · desenvolvedor_4_g, faixa 52).
-- Só leitura e só aditivo: uma função nova sobre os abastecimentos que a tela já grava (erp_viagem_lancamento:
-- posto, litros, valor, hodômetro, tanque cheio). Nada existente muda.
--
--   Consumo pelo método do TANQUE CHEIO, por placa, juntando todas as viagens do veículo (não só a da tela):
--     um trecho começa num abastecimento de tanque cheio e fecha no próximo tanque cheio do mesmo veículo;
--     km do trecho = hodômetro do cheio que fecha − hodômetro do cheio que abre;
--     litros do trecho = tudo o que entrou DEPOIS do cheio que abre, até o cheio que fecha (parciais no meio contam);
--     km/l = km ÷ litros; combustível por km = R$ do trecho ÷ km.
--   Por placa: abastecimentos, litros, R$, R$/litro médio, km/l médio (Σ km ÷ Σ litros dos trechos fechados),
--     combustível por km, km das viagens e custo total da viagem por km — o custo vem da v_viagem_custo_obra, a mesma
--     fonte do Resultado da obra (RD-35).
--   Trecho com km/l abaixo de 80% da média do veículo entra em alerta (consumo alto: vazamento, motor, abastecimento
--   errado). Abastecimento sem hodômetro não entra no km/l (aparece em sem_hodometro).
CREATE OR REPLACE FUNCTION public.fn_viagem_consumo(p_company_id uuid, p_placa text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH vg AS (
    SELECT v.id, v.numero, upper(regexp_replace(COALESCE(v.placa, ''), '[^A-Za-z0-9]', '', 'g')) AS placa,
           CASE WHEN v.km_inicial IS NOT NULL AND v.km_final IS NOT NULL AND v.km_final >= v.km_inicial
                THEN v.km_final - v.km_inicial END AS km
      FROM public.erp_viagem v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND v.status <> 'cancelada'
  ),
  ab AS (
    SELECT l.id, l.data, l.hodometro, l.litros, l.valor, COALESCE(l.tanque_cheio, false) AS cheio,
           l.fornecedor_nome AS posto, vg.numero AS viagem,
           upper(regexp_replace(COALESCE(NULLIF(btrim(l.placa), ''), vg.placa), '[^A-Za-z0-9]', '', 'g')) AS placa
      FROM public.erp_viagem_lancamento l JOIN vg ON vg.id = l.viagem_id
     WHERE l.company_id = p_company_id AND l.tipo = 'abastecimento' AND l.excluido_em IS NULL AND l.litros > 0
  ),
  f AS (
    SELECT * FROM ab
     WHERE placa <> '' AND (p_placa IS NULL OR placa = upper(regexp_replace(p_placa, '[^A-Za-z0-9]', '', 'g')))
  ),
  -- só quem tem hodômetro entra na conta do trecho; k = nº de tanques cheios antes deste abastecimento
  o AS (
    SELECT f.*,
           COALESCE(sum(CASE WHEN f.cheio THEN 1 ELSE 0 END) OVER (PARTITION BY f.placa ORDER BY f.hodometro, f.data, f.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS k,
           sum(CASE WHEN f.cheio THEN 1 ELSE 0 END) OVER (PARTITION BY f.placa ORDER BY f.hodometro, f.data, f.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS n_cheio
      FROM f WHERE f.hodometro IS NOT NULL
  ),
  abre AS (SELECT placa, n_cheio AS k, hodometro AS hod_ini, data AS data_ini FROM o WHERE cheio),
  seg AS (
    SELECT placa, k, sum(litros) AS litros, sum(valor) AS valor, count(*) AS abastecimentos,
           max(hodometro) FILTER (WHERE cheio) AS hod_fim, max(data) FILTER (WHERE cheio) AS data_fim, bool_or(cheio) AS fechado
      FROM o WHERE k >= 1 GROUP BY placa, k
  ),
  trecho AS (
    SELECT s.placa, a.data_ini, s.data_fim, a.hod_ini, s.hod_fim, s.hod_fim - a.hod_ini AS km,
           s.litros, s.valor, s.abastecimentos
      FROM seg s JOIN abre a ON a.placa = s.placa AND a.k = s.k
     WHERE s.fechado AND s.hod_fim > a.hod_ini
  ),
  med AS (
    SELECT placa, sum(km) AS km, sum(litros) AS litros, sum(valor) AS valor, count(*) AS trechos
      FROM trecho GROUP BY placa
  ),
  tot AS (
    SELECT placa, count(*) AS abastecimentos, sum(litros) AS litros, sum(valor) AS valor,
           count(*) FILTER (WHERE hodometro IS NULL) AS sem_hodometro, max(hodometro) AS ultimo_hodometro, max(data) AS ultimo
      FROM f GROUP BY placa
  ),
  via AS (
    SELECT vg.placa, count(*) AS viagens, sum(vg.km) AS km, sum(c.custo) FILTER (WHERE vg.km IS NOT NULL) AS custo_com_km,
           sum(c.custo) AS custo
      FROM vg JOIN (SELECT viagem_id, sum(custo_total) AS custo FROM public.v_viagem_custo_obra GROUP BY viagem_id) c ON c.viagem_id = vg.id
     WHERE vg.placa IN (SELECT placa FROM tot)
     GROUP BY vg.placa
  ),
  pl AS (
    SELECT t.placa, t.abastecimentos, round(t.litros, 3) AS litros, round(t.valor, 2) AS valor, t.sem_hodometro,
           t.ultimo_hodometro, t.ultimo,
           round(t.valor / t.litros, 3) AS preco_litro,
           COALESCE(m.trechos, 0) AS trechos, m.km AS km_medido,
           CASE WHEN m.litros > 0 THEN round(m.km / m.litros, 2) END AS km_l,
           CASE WHEN m.km > 0 THEN round(m.valor / m.km, 2) END AS combustivel_km,
           COALESCE(v.viagens, 0) AS viagens, v.km AS km_viagens, round(v.custo, 2) AS custo_viagens,
           CASE WHEN v.km > 0 THEN round(v.custo_com_km / v.km, 2) END AS custo_km
      FROM tot t LEFT JOIN med m ON m.placa = t.placa LEFT JOIN via v ON v.placa = t.placa
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'placa', p_placa,
    'veiculos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'placa', p.placa, 'abastecimentos', p.abastecimentos, 'litros', p.litros, 'valor', p.valor,
        'preco_litro', p.preco_litro, 'trechos', p.trechos, 'km_medido', p.km_medido, 'km_l', p.km_l,
        'combustivel_km', p.combustivel_km, 'viagens', p.viagens, 'km_viagens', p.km_viagens,
        'custo_viagens', p.custo_viagens, 'custo_km', p.custo_km, 'sem_hodometro', p.sem_hodometro,
        'ultimo_hodometro', p.ultimo_hodometro, 'ultimo', p.ultimo) ORDER BY p.placa) FROM pl p), '[]'::jsonb),
    'trechos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'placa', t.placa, 'de', t.data_ini, 'ate', t.data_fim, 'hod_ini', t.hod_ini, 'hod_fim', t.hod_fim,
        'km', t.km, 'litros', round(t.litros, 3), 'valor', round(t.valor, 2), 'abastecimentos', t.abastecimentos,
        'km_l', round(t.km / t.litros, 2), 'combustivel_km', round(t.valor / t.km, 2),
        'alerta', COALESCE(t.km / t.litros < 0.8 * p.km_l, false))
      ORDER BY t.placa, t.hod_ini DESC) FROM trecho t JOIN pl p ON p.placa = t.placa), '[]'::jsonb),
    'abastecimentos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'placa', f.placa, 'data', f.data, 'posto', f.posto, 'viagem', f.viagem, 'litros', f.litros, 'valor', f.valor,
        'preco_litro', round(f.valor / f.litros, 3), 'hodometro', f.hodometro, 'tanque_cheio', f.cheio)
      ORDER BY f.placa, f.hodometro DESC NULLS LAST, f.data DESC) FROM f), '[]'::jsonb)
  )
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_consumo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_consumo(uuid, text) TO authenticated, service_role;

-- "?" do consumo (RD-95), em linguagem de quem está na estrada
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.cons_km_l', 'Consumo', 'Consumo médio (km/l)', 'Calculado pelo tanque cheio: km rodado entre dois abastecimentos de tanque cheio ÷ litros que entraram nesse intervalo. Junta todas as viagens do veículo.', 'Mostra se o veículo está gastando o normal; queda forte indica problema no motor, pneu murcho ou abastecimento errado.', '290 km ÷ 38,5 L = 7,53 km/l', 'Sem marcar "tanque cheio" em pelo menos dois abastecimentos o consumo não aparece.', 50),
  ('projetos.viagem.cons_combustivel_km', 'Consumo', 'Combustível por km', 'Calculado: R$ abastecido entre dois tanques cheios ÷ km rodado nesse intervalo.', 'É o custo de combustível de cada km; serve para orçar a próxima mobilização.', 'R$ 0,84 por km', 'Hodômetro digitado errado (um zero a mais) estraga a conta do trecho.', 51),
  ('projetos.viagem.cons_custo_km', 'Consumo', 'Viagem por km (veículo)', 'Calculado: custo total das viagens do veículo (combustível, hotel, comida, pedágio) ÷ km das viagens (km final − km inicial).', 'Compara quanto custa cada km com este veículo, somando tudo, igual ao Resultado da obra.', 'R$ 5,67 por km', 'Viagem sem km inicial ou final fica fora desta conta.', 52),
  ('projetos.viagem.cons_preco_litro', 'Consumo', 'Preço médio do litro', 'Calculado: R$ abastecido ÷ litros, em todos os abastecimentos do veículo.', 'Mostra se o posto escolhido está caro em relação ao resto.', 'R$ 6,30 por litro', 'Litros digitados errados distorcem o preço.', 53),
  ('projetos.viagem.cons_trecho', 'Consumo', 'Trechos de tanque cheio', 'Cada linha vai de um tanque cheio até o próximo tanque cheio do mesmo veículo, com km, litros e km/l do trecho.', 'Trecho em alerta gastou mais de 20% acima do normal do veículo: confira o cupom e o hodômetro, depois o veículo.', '61.200 → 61.490 km · 7,53 km/l', 'Abastecimento sem hodômetro não entra no trecho.', 54),
  ('projetos.viagem.cons_tanque_cheio', 'Consumo', 'Tanque cheio', 'Marque quando o frentista completou o tanque até travar a bomba.', 'É o ponto de partida e de chegada da conta de consumo (km/l).', 'Completou até travar: marcar', 'Marcar tanque cheio num abastecimento parcial faz o consumo parecer melhor do que é.', 55)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
