-- P&M · Benchmark interno da agência (CONSTRUIR, CEO 31/10) — tela /dashboard/pm/benchmark (hoje placeholder, nota 28).
-- V1 100% INTERNO (sem dado externo, sem API paga): compara entre si CLIENTES, SERVIÇOS e MEMBROS da equipe
-- pela mesma régua — margem real, receita/hora, horas por entrega, entregas no prazo e retrabalho (rodadas de
-- aprovação em agency_job_rodadas). Benchmark de MERCADO externo fica para fase futura (tem custo de dado).
-- ADITIVA: função NOVA (fn_pm_benchmark), só-leitura, guarda por empresa (RD-45); + textos de ajuda (RD-95);
-- + registro de RPC em system_screens (RD-98 p3). NÃO altera nem apaga dado de cliente.

-- 1) RPC de leitura: ranking por dimensão (cliente | servico | membro) + média da agência como referência.
CREATE OR REPLACE FUNCTION public.fn_pm_benchmark(p_company_ids uuid[], p_dias integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_cut date;
  v_result jsonb;
BEGIN
  -- Guarda de empresa (RD-45): não-admin só enxerga as próprias empresas.
  v_ids := p_company_ids;
  IF NOT is_admin() THEN
    v_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true);
  END IF;

  p_dias := GREATEST(COALESCE(p_dias, 90), 1);
  v_cut := current_date - p_dias;

  WITH jx AS (
    -- Base: jobs vivos do período, com custo/horas (timesheet) e retrabalho (rodadas) por job.
    SELECT j.id, j.cliente_id, j.servico_id, j.responsavel_id, j.responsavel_nome,
           COALESCE(j.valor_job, 0)::numeric AS valor_job,
           (j.data_entrega IS NOT NULL) AS entregue,
           (j.data_entrega IS NOT NULL AND j.data_prazo IS NOT NULL AND j.data_entrega <= j.data_prazo) AS no_prazo,
           COALESCE(cst.custo, 0) AS custo, COALESCE(cst.horas, 0) AS horas, COALESCE(rw.rodadas, 0) AS rodadas
      FROM agency_jobs j
      LEFT JOIN (
        SELECT t.job_id, SUM(COALESCE(t.custo_total, 0))::numeric AS custo, SUM(COALESCE(t.horas, 0))::numeric AS horas
          FROM agency_timesheet t
         WHERE t.company_id = ANY(v_ids) AND t.excluido_em IS NULL
         GROUP BY t.job_id
      ) cst ON cst.job_id = j.id
      LEFT JOIN (
        SELECT r.job_id, COUNT(*)::int AS rodadas
          FROM agency_job_rodadas r
         WHERE r.company_id = ANY(v_ids)
         GROUP BY r.job_id
      ) rw ON rw.job_id = j.id
     WHERE j.company_id = ANY(v_ids) AND j.excluido_em IS NULL AND j.created_at >= v_cut
  ),
  cli AS (
    SELECT cl.id, cl.nome,
           COUNT(x.id)::int AS jobs, ROUND(SUM(x.valor_job))::numeric AS receita, ROUND(SUM(x.custo))::numeric AS custo,
           CASE WHEN SUM(x.valor_job) > 0 THEN ROUND((SUM(x.valor_job) - SUM(x.custo)) / SUM(x.valor_job) * 100) END AS margem_pct,
           CASE WHEN SUM(x.horas) > 0 THEN ROUND(SUM(x.valor_job) / SUM(x.horas)) END AS receita_hora,
           SUM(x.horas)::numeric AS horas, SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END)::int AS entregues,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(x.horas) / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END), 1) END AS horas_entrega,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(CASE WHEN x.no_prazo THEN 1 ELSE 0 END)::numeric / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) * 100) END AS prazo_pct,
           SUM(x.rodadas)::int AS retrabalho
      FROM jx x JOIN agency_clientes cl ON cl.id = x.cliente_id
     GROUP BY cl.id, cl.nome
  ),
  srv AS (
    SELECT s.id, s.nome,
           COUNT(x.id)::int AS jobs, ROUND(SUM(x.valor_job))::numeric AS receita, ROUND(SUM(x.custo))::numeric AS custo,
           CASE WHEN SUM(x.valor_job) > 0 THEN ROUND((SUM(x.valor_job) - SUM(x.custo)) / SUM(x.valor_job) * 100) END AS margem_pct,
           CASE WHEN SUM(x.horas) > 0 THEN ROUND(SUM(x.valor_job) / SUM(x.horas)) END AS receita_hora,
           SUM(x.horas)::numeric AS horas, SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END)::int AS entregues,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(x.horas) / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END), 1) END AS horas_entrega,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(CASE WHEN x.no_prazo THEN 1 ELSE 0 END)::numeric / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) * 100) END AS prazo_pct,
           SUM(x.rodadas)::int AS retrabalho
      FROM jx x JOIN agency_servico s ON s.id = x.servico_id
     GROUP BY s.id, s.nome
  ),
  mem AS (
    SELECT x.responsavel_id AS id, COALESCE(MAX(e.nome), MAX(x.responsavel_nome), 'Sem responsável') AS nome,
           COUNT(x.id)::int AS jobs, ROUND(SUM(x.valor_job))::numeric AS receita, ROUND(SUM(x.custo))::numeric AS custo,
           CASE WHEN SUM(x.valor_job) > 0 THEN ROUND((SUM(x.valor_job) - SUM(x.custo)) / SUM(x.valor_job) * 100) END AS margem_pct,
           CASE WHEN SUM(x.horas) > 0 THEN ROUND(SUM(x.valor_job) / SUM(x.horas)) END AS receita_hora,
           SUM(x.horas)::numeric AS horas, SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END)::int AS entregues,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(x.horas) / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END), 1) END AS horas_entrega,
           CASE WHEN SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) > 0
                THEN ROUND(SUM(CASE WHEN x.no_prazo THEN 1 ELSE 0 END)::numeric / SUM(CASE WHEN x.entregue THEN 1 ELSE 0 END) * 100) END AS prazo_pct,
           SUM(x.rodadas)::int AS retrabalho
      FROM jx x
      LEFT JOIN agency_equipe e ON e.user_id = x.responsavel_id AND e.company_id = ANY(v_ids) AND e.excluido_em IS NULL
     WHERE x.responsavel_id IS NOT NULL
     GROUP BY x.responsavel_id
  ),
  med AS (
    SELECT jsonb_build_object(
      'jobs', COUNT(*)::int, 'receita', ROUND(SUM(valor_job))::numeric, 'custo', ROUND(SUM(custo))::numeric,
      'margem_pct', CASE WHEN SUM(valor_job) > 0 THEN ROUND((SUM(valor_job) - SUM(custo)) / SUM(valor_job) * 100) END,
      'receita_hora', CASE WHEN SUM(horas) > 0 THEN ROUND(SUM(valor_job) / SUM(horas)) END,
      'horas_entrega', CASE WHEN SUM(CASE WHEN entregue THEN 1 ELSE 0 END) > 0
                            THEN ROUND(SUM(horas) / SUM(CASE WHEN entregue THEN 1 ELSE 0 END), 1) END,
      'prazo_pct', CASE WHEN SUM(CASE WHEN entregue THEN 1 ELSE 0 END) > 0
                        THEN ROUND(SUM(CASE WHEN no_prazo THEN 1 ELSE 0 END)::numeric / SUM(CASE WHEN entregue THEN 1 ELSE 0 END) * 100) END,
      'retrabalho', SUM(rodadas)::int
    ) AS m, COUNT(*) AS n FROM jx
  )
  SELECT CASE WHEN med.n = 0
    THEN jsonb_build_object('empty_state', false, 'periodo_dias', p_dias, 'vazio_periodo', true,
                            'media', NULL, 'clientes', '[]'::jsonb, 'servicos', '[]'::jsonb, 'membros', '[]'::jsonb)
    ELSE jsonb_build_object(
      'empty_state', false, 'periodo_dias', p_dias, 'vazio_periodo', false, 'media', med.m,
      'clientes', (SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.margem_pct DESC NULLS LAST, c.receita DESC), '[]'::jsonb) FROM cli c),
      'servicos', (SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.margem_pct DESC NULLS LAST, s.receita DESC), '[]'::jsonb) FROM srv s),
      'membros',  (SELECT COALESCE(jsonb_agg(row_to_json(m2)::jsonb ORDER BY m2.margem_pct DESC NULLS LAST, m2.receita DESC), '[]'::jsonb) FROM mem m2)
    )
  END INTO v_result FROM med;

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_benchmark(uuid[], integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_pm_benchmark(uuid[], integer) TO authenticated;

-- 2) Ajuda "?" dos indicadores (RD-95). Aditiva (só texto de ajuda novo).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.benchmark.tela', 'Benchmark', 'Benchmark interno', 'Nada a preencher: a tela compara entre si os seus clientes, serviços e membros da equipe com os dados que a agência já tem.', 'Mostra quem rende mais e quem precisa de atenção, sempre contra a média da própria agência — sem comparar com o mercado externo.', 'No período de 90 dias, o cliente com maior margem aparece no topo e o de menor margem no fim.', 'Esperar comparação com outras agências do mercado: isso é fase futura; aqui a referência é a sua própria média.', 10, '/dashboard/pm/benchmark'),
 ('pm.benchmark.periodo', 'Benchmark', 'Período', 'Escolha a janela de tempo (jobs criados nos últimos 30, 90, 180 ou 365 dias).', 'Define a base da comparação: períodos curtos mostram o momento, períodos longos mostram a tendência.', '90 dias: entra todo job criado do trimestre para cá.', 'Comparar um período curto com poucos jobs e achar que é a realidade do ano todo.', 11, '/dashboard/pm/benchmark'),
 ('pm.benchmark.dimensao', 'Benchmark', 'Comparar por', 'Toque em Clientes, Serviços ou Equipe para ver o mesmo ranking agrupado desse jeito.', 'Cada agrupamento responde uma pergunta: qual cliente dá mais lucro, qual serviço rende melhor, qual membro entrega melhor.', 'Serviços: todos os jobs de "Social media" somados numa linha, com a margem do serviço.', 'Trocar de agrupamento e achar que os números mudaram: é a mesma base vista por outro ângulo.', 12, '/dashboard/pm/benchmark'),
 ('pm.benchmark.margem', 'Benchmark', 'Margem real', 'Nada a preencher: é o lucro (receita menos o custo das horas) dividido pela receita, em %.', 'Compara quem dá lucro de verdade: verde a partir de 50%, amarelo a partir de 25%, vermelho abaixo.', 'Receita R$ 10.000, custo das horas R$ 6.000 → lucro R$ 4.000 → margem 40% (amarelo).', 'Ler margem alta em quem ainda não teve horas apontadas: sem custo, a margem fica inflada até alguém lançar as horas.', 13, '/dashboard/pm/benchmark'),
 ('pm.benchmark.receita_hora', 'Benchmark', 'Receita por hora', 'Nada a preencher: é a receita dividida pelas horas apontadas no período.', 'Mostra o quanto cada hora de trabalho rende — útil para precificar e dimensionar a equipe.', 'Receita R$ 5.000 com 50 horas → R$ 100 por hora.', 'Comparar receita/hora de quem quase não apontou horas: poucas horas distorcem o valor para cima.', 14, '/dashboard/pm/benchmark'),
 ('pm.benchmark.horas_entrega', 'Benchmark', 'Horas por entrega', 'Nada a preencher: total de horas dividido pelo número de jobs já entregues.', 'Mostra o esforço médio de cada entrega — ajuda a achar o que consome tempo demais.', '80 horas em 4 entregas → 20 horas por entrega.', 'Esperar valor onde ainda não houve entrega: sem job entregue no período, o indicador fica em branco.', 15, '/dashboard/pm/benchmark'),
 ('pm.benchmark.prazo', 'Benchmark', 'Entregas no prazo', 'Nada a preencher: dos jobs entregues, quantos saíram até a data de prazo combinada (%).', 'Mede confiabilidade de entrega — quem entrega no combinado e quem atrasa.', '3 de 4 entregas dentro do prazo → 75%.', 'Confundir com volume: um 100% com só 1 entrega diz menos que 90% com 20 entregas.', 16, '/dashboard/pm/benchmark'),
 ('pm.benchmark.retrabalho', 'Benchmark', 'Retrabalho', 'Nada a preencher: soma das rodadas de ajuste pedidas na aprovação dos jobs.', 'Quanto maior, mais vezes o trabalho voltou para refação — sinal de briefing ou execução a melhorar.', '2 jobs com 3 rodadas de ajuste cada → 6 de retrabalho.', 'Ler retrabalho sem olhar o volume de jobs: muitos jobs tendem a somar mais rodadas no total.', 17, '/dashboard/pm/benchmark'),
 ('pm.benchmark.media', 'Benchmark', 'Média da agência', 'Nada a preencher: é a mesma régua somando TODOS os jobs do período.', 'Serve de linha de referência: cada linha do ranking é lida contra essa média para ver quem está acima ou abaixo.', 'Média de margem 38% → um cliente com 60% está bem acima; com 20%, abaixo.', 'Tratar a média como meta: ela é o retrato atual da agência, não um alvo definido.', 18, '/dashboard/pm/benchmark')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 3) Origem do dado da tela (RD-98 p3): registra a RPC consumida.
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_pm_benchmark']
 WHERE rota = '/dashboard/pm/benchmark';
