-- Indústria › RH › Gestão de Mão de Obra — PR6: visão POSTO A POSTO Projetado × Real (qtd e custo).
-- Agnóstico de ramo (frigorífico/desmonte E fábrica de monte). REUSA as tabelas que já existem:
--   PROJETADO: prod_posto_turno.pessoas (vigente) = pessoas planejadas por posto;
--              prod_posto_custo.mao_obra_mes (vigente) = custo de mão de obra planejado/mês do posto.
--   REAL:      prod_posto_pessoa (vigente) = pessoas efetivamente alocadas ao posto;
--              prod_salario_base (vigente) × (1 + encargos_pct/100) = custo real/mês.
--   O salário de cada pessoa vem do salário por FUNCIONÁRIO; na falta dele, do salário do CARGO do posto.
-- Gate de custo: fn__rh_pode_custo (admin / rh_industrial / socio) — sem ele, os campos de R$ voltam NULL.
-- Guarda de empresa: get_user_company_ids()/is_admin() (RLS por company_id). REVOKE anon.
-- Aditiva: só CREATE de função nova + chaves de ajuda (RD-95). Nenhum dado de cliente tocado.
-- Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_prod_mao_obra_projetado_real(
  p_company_id uuid, p_plant_id uuid DEFAULT NULL::uuid, p_ref date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref date;
  v_pode boolean;
  v_postos jsonb;
  v_plan_pessoas numeric;
  v_real_pessoas numeric;
  v_plan_custo numeric;
  v_real_custo numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_ref := COALESCE(p_ref, CURRENT_DATE);
  v_pode := fn__rh_pode_custo(p_company_id);

  WITH postos AS (
    SELECT p.id, p.numero, p.atividade, p.cargo_id,
           s.nome AS setor, c.nome AS cargo
      FROM prod_posto p
      JOIN prod_setor s ON s.id = p.setor_id
      LEFT JOIN prod_cargo c ON c.id = p.cargo_id
     WHERE p.company_id = p_company_id
       AND (p_plant_id IS NULL OR p.plant_id = p_plant_id)
       AND p.ativo
  ),
  plan_pes AS (
    SELECT t.posto_id, COALESCE(sum(t.pessoas), 0) AS pessoas
      FROM prod_posto_turno t
      JOIN postos pp ON pp.id = t.posto_id
     WHERE t.vigencia_inicio <= v_ref AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= v_ref)
     GROUP BY t.posto_id
  ),
  plan_custo AS (
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id, pc.mao_obra_mes,
           COALESCE(pc.encargos_pct, 0) AS encargos_pct
      FROM prod_posto_custo pc
      JOIN postos pp ON pp.id = pc.posto_id
     WHERE pc.deleted_at IS NULL AND pc.vigencia_inicio <= v_ref
       AND (pc.vigencia_fim IS NULL OR pc.vigencia_fim >= v_ref)
     ORDER BY pc.posto_id, pc.vigencia_inicio DESC
  ),
  real_pes AS (
    SELECT pp2.posto_id, count(*) AS pessoas,
           sum(COALESCE(sf.valor, sc.valor)) AS salario_base,
           count(*) FILTER (WHERE COALESCE(sf.valor, sc.valor) IS NULL) AS sem_salario
      FROM prod_posto_pessoa pp2
      JOIN postos px ON px.id = pp2.posto_id
      LEFT JOIN LATERAL (
        SELECT sb.valor FROM prod_salario_base sb
         WHERE sb.excluido_em IS NULL AND sb.funcionario_id = pp2.funcionario_id
           AND sb.vigencia_inicio <= v_ref AND (sb.vigencia_fim IS NULL OR sb.vigencia_fim >= v_ref)
         ORDER BY sb.vigencia_inicio DESC LIMIT 1
      ) sf ON true
      LEFT JOIN LATERAL (
        SELECT sb.valor FROM prod_salario_base sb
         WHERE sb.excluido_em IS NULL AND sb.funcionario_id IS NULL AND sb.cargo_id = px.cargo_id
           AND sb.vigencia_inicio <= v_ref AND (sb.vigencia_fim IS NULL OR sb.vigencia_fim >= v_ref)
         ORDER BY sb.vigencia_inicio DESC LIMIT 1
      ) sc ON true
     WHERE pp2.vigencia_inicio <= v_ref AND (pp2.vigencia_fim IS NULL OR pp2.vigencia_fim >= v_ref)
     GROUP BY pp2.posto_id
  ),
  linhas AS (
    SELECT po.id, po.numero, po.atividade, po.setor, po.cargo,
           COALESCE(pp.pessoas, 0) AS plan_pessoas,
           COALESCE(rp.pessoas, 0) AS real_pessoas,
           COALESCE(rp.sem_salario, 0) AS sem_salario,
           COALESCE(pc.encargos_pct, 0) AS encargos_pct,
           pc.mao_obra_mes AS plan_custo,
           CASE WHEN rp.salario_base IS NULL THEN NULL
                ELSE round(rp.salario_base * (1 + COALESCE(pc.encargos_pct, 0) / 100.0), 2) END AS real_custo
      FROM postos po
      LEFT JOIN plan_pes pp ON pp.posto_id = po.id
      LEFT JOIN plan_custo pc ON pc.posto_id = po.id
      LEFT JOIN real_pes rp ON rp.posto_id = po.id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
       'posto_id', id, 'numero', numero, 'atividade', atividade, 'setor', setor, 'cargo', cargo,
       'plan_pessoas', plan_pessoas, 'real_pessoas', real_pessoas, 'sem_salario', sem_salario,
       'encargos_pct', encargos_pct,
       'plan_custo', CASE WHEN v_pode THEN plan_custo ELSE NULL END,
       'real_custo', CASE WHEN v_pode THEN real_custo ELSE NULL END
    ) ORDER BY setor, numero), '[]'::jsonb),
    COALESCE(sum(plan_pessoas), 0), COALESCE(sum(real_pessoas), 0),
    sum(plan_custo), sum(real_custo)
  INTO v_postos, v_plan_pessoas, v_real_pessoas, v_plan_custo, v_real_custo
  FROM linhas;

  RETURN jsonb_build_object(
    'ok', true, 'ref', v_ref, 'pode_custo', v_pode,
    'totais', jsonb_build_object(
       'postos', jsonb_array_length(v_postos),
       'plan_pessoas', v_plan_pessoas,
       'real_pessoas', v_real_pessoas,
       'plan_custo', CASE WHEN v_pode THEN v_plan_custo ELSE NULL END,
       'real_custo', CASE WHEN v_pode THEN v_real_custo ELSE NULL END
    ),
    'postos', v_postos
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_prod_mao_obra_projetado_real(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_mao_obra_projetado_real(uuid, uuid, date) TO authenticated, service_role;

-- RD-95: "?" de cada indicador/coluna da aba "Projetado × Real". Texto em linguagem do usuário.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('maoobra.pxr.ref', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Posição em',
  'Escolha a data de referência da comparação. O quadro mostra os postos, as pessoas planejadas e as alocadas, e os custos vigentes NAQUELA data (planejamento e salários mudam por vigência).',
  'Permite comparar o plano com a realidade num ponto no tempo — hoje, no fechamento do mês ou numa data passada — usando o que valia naquele dia.',
  'Pôr o último dia do mês para conferir o quadro de pessoal com que a produção realmente rodou no mês.',
  'Estranhar números diferentes ao trocar a data: cada data usa a vigência daquele dia; não é erro, é o histórico.',
  'industria', 1, 1, 'publicado'),
 ('maoobra.pxr.plan_pessoas', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Pessoas planejadas',
  'Quantas pessoas o planejamento prevê para o posto, somando as pessoas dos turnos vigentes do posto (aba Postos › turnos).',
  'É a meta de quadro: quantas pessoas o posto deveria ter para rodar como planejado.',
  'Um posto com dois turnos de 3 pessoas aparece com 6 pessoas planejadas.',
  'Posto sem turno cadastrado aparece com 0 planejadas — cadastre o turno no posto para o plano aparecer.',
  'industria', 2, 1, 'publicado'),
 ('maoobra.pxr.real_pessoas', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Pessoas alocadas',
  'Quantas pessoas estão de fato alocadas ao posto na data escolhida (aba Pessoas), contando as alocações vigentes.',
  'Mostra a realidade do quadro e, ao lado do planejado, onde falta ou sobra gente.',
  'Posto que prevê 6 e tem 4 alocadas está 2 pessoas abaixo do plano.',
  'Confundir com o planejado: esta coluna é quem está alocado hoje, não a meta.',
  'industria', 3, 1, 'publicado'),
 ('maoobra.pxr.plan_custo', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Custo planejado/mês',
  'O custo de mão de obra por mês definido no planejamento do posto (campo "mão de obra/mês" da aba Postos › custo), vigente na data.',
  'É o orçamento de mão de obra do posto — a base para comparar com o que está sendo realmente gasto.',
  'Um posto orçado em R$ 33.700/mês de mão de obra.',
  'Posto sem custo planejado cadastrado aparece vazio — preencha o custo do posto na aba Postos.',
  'industria', 4, 1, 'publicado'),
 ('maoobra.pxr.real_custo', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Custo real/mês',
  'A soma dos salários-base das pessoas alocadas ao posto, acrescida dos encargos (1 + encargos% do posto), vigentes na data.',
  'Mostra quanto o posto custa de fato por mês de mão de obra, para comparar com o orçamento.',
  'Três pessoas somando R$ 9.000 de salário, com 68% de encargos, dão R$ 15.120/mês de custo real.',
  'Aparece vazio quando as pessoas do posto ainda não têm salário-base cadastrado (aba Salário) — sem salário não há custo real.',
  'industria', 5, 1, 'publicado'),
 ('maoobra.pxr.variacao', '/dashboard/industrial/rh/mao-de-obra', 'Projetado × Real', 'Diferença (real − plano)',
  'A diferença entre o real e o planejado, em pessoas e em custo. Verde quando o real está dentro do plano (igual ou abaixo no custo); vermelho quando passou.',
  'Aponta de relance os postos que fogem do plano — para onde olhar primeiro.',
  'Real R$ 15.120 contra plano R$ 14.000 mostra +R$ 1.120 em vermelho (acima do orçado).',
  'Ler a diferença de custo quando algum lado está sem dado (plano ou salário): compare só onde os dois existem.',
  'industria', 6, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
