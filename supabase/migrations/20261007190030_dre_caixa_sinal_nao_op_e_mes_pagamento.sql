-- DRE regime CAIXA · 2 defeitos provados (Umuarama 636af107, mensagem 5b12de3b).
-- (A) SINAL: receita em conta NAO_OPER/RESULT_FIN (ex.: 1.04 "Outras receitas" -> 9.2) entrava somada no grupo e
--     o grupo é subtraído (signo -1): receita virava despesa (erro de 2x o valor). Receita nesses grupos agora entra
--     com sinal invertido no cálculo (grupo = despesas - receitas). psgc_dre NÃO muda (sem backfill de valor):
--     a receita é identificada por source 'etl_receber*' em fn_psgc_dre_horizontal e pela tabela erp_receber
--     em fn_psgc_dre_horizontal_dia. Fonte etl_lancamento (mistura receita e despesa) fica como está.
-- (B) MÊS SUJO: trg_psgc_enfileirar_lancamento só enfileirava o recálculo pelo mês da EMISSÃO; título pago em mês
--     diferente do criado (regime caixa) não refazia o mês do PAGAMENTO. Passa a enfileirar também o mês do
--     pagamento (novo e, se mudou, o antigo). Reenfileira os últimos meses das empresas ativas (sem varrer tabela).
-- Patch sobre a definição VIVA (pg_get_functiondef) com asserção: falha alto se o texto esperado não existir.

DO $mig$
DECLARE
  v_def text; v_new text;
BEGIN
  -- (A1) fn_psgc_dre_horizontal (mensal)
  v_def := pg_get_functiondef('public.fn_psgc_dre_horizontal(uuid[],date,date,text)'::regprocedure);
  v_new := replace(v_def,
    E'SUM(d.valor) AS valor\n    FROM psgc_dre d\n',
    E'SUM(CASE WHEN d.source ILIKE ''%receber%'' AND pcx.dre_grupo IN (''NAO_OPER'',''RESULT_FIN'') THEN -d.valor ELSE d.valor END) AS valor\n    FROM psgc_dre d\n    LEFT JOIN psgc_contas pcx ON pcx.codigo = d.psgc_codigo\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch A1 não aplicou'; END IF;
  EXECUTE v_new;

  -- (A2) fn_psgc_dre_horizontal_dia (diário)
  v_def := pg_get_functiondef('public.fn_psgc_dre_horizontal_dia(uuid[],integer,integer,text)'::regprocedure);
  v_new := replace(v_def,
    E'COALESCE(r.valor,0) AS valor, r.company_id\n    FROM erp_receber r\n',
    E'CASE WHEN COALESCE(best.psgc_codigo, ''1.4'') IN (SELECT codigo FROM psgc_contas WHERE dre_grupo IN (''NAO_OPER'',''RESULT_FIN'')) THEN -COALESCE(r.valor,0) ELSE COALESCE(r.valor,0) END AS valor, r.company_id\n    FROM erp_receber r\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch A2 não aplicou'; END IF;
  EXECUTE v_new;

  -- (B) gatilho: mês do pagamento
  v_def := pg_get_functiondef('public.trg_psgc_enfileirar_lancamento()'::regprocedure);
  v_new := replace(v_def, 'v_old jsonb; v_new jsonb;', 'v_pg date; v_pg_old date; v_old jsonb; v_new jsonb;');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch B1 não aplicou'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  RETURN CASE WHEN TG_OP = ''DELETE'' THEN OLD ELSE NEW END;\nEXCEPTION',
    E'  -- [DRE caixa] o mês do PAGAMENTO também precisa ser refeito (novo e, se mudou, o antigo)\n'
    E'  IF TG_TABLE_NAME IN (''erp_pagar'', ''erp_receber'') THEN\n'
    E'    v_pg := fn_parse_data_text(CASE WHEN TG_OP = ''DELETE'' THEN OLD.data_pagamento::text ELSE NEW.data_pagamento::text END);\n'
    E'    IF TG_OP = ''UPDATE'' THEN v_pg_old := fn_parse_data_text(OLD.data_pagamento::text); END IF;\n'
    E'    IF v_pg IS NOT NULL THEN\n'
    E'      PERFORM fn_psgc_enfileirar(v_company, ''recalcular_dre_mes'', EXTRACT(YEAR FROM v_pg)::int, EXTRACT(MONTH FROM v_pg)::int, 5, ''trigger:'' || TG_TABLE_NAME, v_ref);\n'
    E'      PERFORM fn_psgc_enfileirar(v_company, ''recalcular_fluxo'', EXTRACT(YEAR FROM v_pg)::int, EXTRACT(MONTH FROM v_pg)::int, 6, ''trigger:'' || TG_TABLE_NAME);\n'
    E'    END IF;\n'
    E'    IF TG_OP = ''UPDATE'' AND v_pg_old IS NOT NULL\n'
    E'       AND (v_pg IS NULL OR date_trunc(''month'', v_pg_old) <> date_trunc(''month'', v_pg) OR OLD.company_id IS DISTINCT FROM NEW.company_id) THEN\n'
    E'      PERFORM fn_psgc_enfileirar(OLD.company_id, ''recalcular_dre_mes'', EXTRACT(YEAR FROM v_pg_old)::int, EXTRACT(MONTH FROM v_pg_old)::int, 5, ''trigger:'' || TG_TABLE_NAME, v_ref);\n'
    E'      PERFORM fn_psgc_enfileirar(OLD.company_id, ''recalcular_fluxo'', EXTRACT(YEAR FROM v_pg_old)::int, EXTRACT(MONTH FROM v_pg_old)::int, 6, ''trigger:'' || TG_TABLE_NAME);\n'
    E'    END IF;\n'
    E'  END IF;\n\n'
    E'  RETURN CASE WHEN TG_OP = ''DELETE'' THEN OLD ELSE NEW END;\nEXCEPTION');
  IF v_new = v_def THEN RAISE EXCEPTION 'patch B2 não aplicou'; END IF;
  EXECUTE v_new;
END
$mig$;

-- Reenfileira (prioridade baixa) os meses de 2025-01 até o mês atual das empresas que o recálculo atende;
-- a fila deduplica pendentes. Nenhuma função por linha de título, nenhuma varredura de tabela grande.
INSERT INTO psgc_job_queue (company_id, tipo, ano, mes, prioridade, source, source_ref)
SELECT c.id, 'recalcular_dre_mes', EXTRACT(YEAR FROM m)::int, EXTRACT(MONTH FROM m)::int, 8, 'migration:dre_caixa_mes_pagamento', NULL
FROM companies c
CROSS JOIN generate_series(date '2025-01-01', date_trunc('month', now())::date, interval '1 month') m
WHERE (c.ambiente_tenant = 'producao' OR c.is_demo IS TRUE)
ON CONFLICT (company_id, tipo, COALESCE(ano, 0), COALESCE(mes, 0)) WHERE status IN ('pendente', 'processando')
DO NOTHING;
