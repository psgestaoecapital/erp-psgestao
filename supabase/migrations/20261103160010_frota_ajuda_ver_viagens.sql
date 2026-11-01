-- Hub · Controle de frota (/dashboard/projetos/frota) — PDCA aud8 01/11 (78/50/55).
-- RD-95: texto de ajuda do atalho "Ver viagens", que dá rastreabilidade da ORIGEM do km/consumo
-- (a frota não digita km nem litros; eles vêm das viagens lançadas — gap do auditor: "sem link/drill-down
-- para as viagens que originam o dado"). Aditiva e idempotente (ON CONFLICT DO NOTHING): só insere a chave
-- nova, não altera texto existente. Code: dev7claudeps.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
  ('projetos.frota.ver_viagens', 'Frota', 'Ver viagens',
   'Atalho para a tela de Viagens, onde o quilômetro rodado e os litros abastecidos de cada veículo são lançados.',
   'Dá rastreabilidade: o Km atual, o Consumo (km/l) e parte do Custo por km desta tela são CALCULADOS a partir das viagens lançadas — a frota não digita km nem litros. Abra as viagens para conferir de onde veio cada número.',
   'O consumo de 12 km/l de um veículo sai das viagens que registraram a distância e os litros do período.',
   'Procurar na frota o campo para digitar o km rodado: ele não existe aqui; o km entra pela tela de Viagens e esta tela só consolida.',
   5, '/dashboard/projetos/frota')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
