-- DEMO 005 (Indústria) · horas de operação nos postos semeados, para o R$/h aparecer
-- ============================================================================
-- GAP (auditor_pdca_1, J1/custos-posto): fn_demo_seed_industria_postos recria os 11
-- prod_posto_custo a cada reset com mao_obra_mes > 0 mas horas_operacao_mes = NULL.
-- Como o R$/h do posto é CASE WHEN horas_operacao_mes > 0 THEN mao_obra*(1+encargos)/horas,
-- com horas NULL o R$/h fica EM BRANCO em /dashboard/produtividade/custos-posto —
-- mesmo com pessoas>=3. Um UPDATE avulso é inútil (o seed sobrescreve no próximo reset),
-- então a correção vai DENTRO da função de seed.
--
-- Correção: o INSERT de prod_posto_custo passa a gravar horas_operacao_mes = 176 (h/mês,
-- jornada industrial padrão ~44 h/semana). Valor FAKE de DEMO (RD-69/LGPD), não é cliente.
--
-- ADITIVO e idempotente: só altera a função de seed da DEMO (guardada ao id fixo da 005,
-- que já valida is_demo e recria tudo a cada chamada). Sem DDL, sem RLS, sem dado de cliente.
-- Preserva todo o resto da função.
--
-- ci-sem-guarda: fn_demo_seed_industria_postos — seed de manutenção da DEMO, não é escrita por usuário:
--   trava ao id fixo da 005 (p_company_id IS DISTINCT FROM c) + is_demo IS TRUE; grant só a service_role.
--
-- RD-38 (prova no dado, antes/depois — após o próximo fn_demo_reset da 005):
--   -- ANTES (produção, 11/11): SELECT count(*) FILTER (WHERE horas_operacao_mes IS NULL)
--   --   FROM prod_posto_custo WHERE company_id='b0700000-0000-4000-a000-000000000005'; => 11
--   -- DEPOIS do reset: 0 NULL; 11 custos com horas_operacao_mes = 176; count(*) = 11 (igual).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_postos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_planta uuid;
  v_abate  uuid;
  v_desossa uuid;
  v_setor  uuid;
  v_posto  uuid;
  v_i      int := 0;
  v_cpf    text;
  r        record;
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da demo (RD-30: manutenção deliberada)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  SELECT id INTO v_planta FROM industrial_plants WHERE company_id = c AND codigo_planta = 'DEMO-SST';
  IF v_planta IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_demo_ausente');
  END IF;

  -- os setores são recriados a cada reset (ids novos): procura por nome
  SELECT id INTO v_abate   FROM prod_setor WHERE company_id = c AND nome = 'Abate'   ORDER BY ordem LIMIT 1;
  SELECT id INTO v_desossa FROM prod_setor WHERE company_id = c AND nome = 'Desossa' ORDER BY ordem LIMIT 1;
  IF v_abate IS NULL OR v_desossa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setores_demo_ausentes');
  END IF;

  -- idempotência: zera só os postos/custos/pessoas desta DEMO
  DELETE FROM prod_posto_custo  WHERE company_id = c;
  DELETE FROM prod_posto_pessoa WHERE company_id = c;
  DELETE FROM prod_posto_turno  WHERE company_id = c;
  DELETE FROM prod_posto        WHERE company_id = c;

  -- catálogo de postos: fluxo do abate → desossa. ocupa=false ⇒ vaga aberta (sem pessoa).
  -- (setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos_pct)
  FOR r IN
    SELECT * FROM (VALUES
      -- Abate (fluxo da nave de abate)
      ('A','01','Insensibilização',          1, true,  'Bruno Carvalho Demo',  3200, 68),
      ('A','02','Sangria',                    2, true,  'Diego Rocha Demo',     3000, 68),
      ('A','03','Esfola',                     3, true,  'Fábio Lima Demo',      3100, 68),
      ('A','04','Evisceração',                4, true,  'Hugo Martins Demo',    3100, 68),
      ('A','05','Inspeção oficial (SIF)',     5, false, NULL,                   3600, 68),
      ('A','06','Tipificação e pesagem',      6, true,  'João Pedro Demo',      3400, 68),
      -- Desossa (sala de desossa / embalagem)
      ('D','01','Quarteamento',               1, true,  'Lucas Ferreira Demo',  2900, 68),
      ('D','02','Desossa do dianteiro',       2, true,  'Nelson Pires Demo',    2950, 68),
      ('D','03','Desossa do traseiro',        3, false, NULL,                   2950, 68),
      ('D','04','Embalagem a vácuo',          4, true,  'Paulo Teixeira Demo',  2700, 68),
      ('D','05','Expedição',                  5, false, NULL,                   2800, 68)
    ) AS t(setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos)
  LOOP
    v_setor := CASE r.setor_tag WHEN 'A' THEN v_abate ELSE v_desossa END;

    INSERT INTO prod_posto (company_id, plant_id, setor_id, numero, atividade, ordem_linha, alocacao, ativo)
    VALUES (c, v_planta, v_setor, r.numero, r.atividade, r.ordem, 'fixa', true)
    RETURNING id INTO v_posto;

    -- custo do posto (salário FAKE + encargos). Base do custo de produção por posto na tela.
    -- horas_operacao_mes = 176 (jornada industrial padrão ~44 h/semana) para o R$/h calcular.
    INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct, horas_operacao_mes)
    VALUES (c, v_planta, v_posto, current_date, r.salario, r.encargos, 176);

    -- pessoa com CPF MANUAL (sem funcionário real): demonstra o caso "RH preenche na tela".
    IF r.ocupa THEN
      v_i := v_i + 1;
      v_cpf := fn_demo_cpf_valido(556000000 + v_i);
      INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, vigencia_inicio)
      VALUES (c, v_planta, v_posto, NULL, v_cpf, current_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_postos',
    'postos',        (SELECT count(*) FROM prod_posto WHERE company_id = c),
    'ocupados',      (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'vagas_abertas', (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND NOT EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'pessoas',       (SELECT count(*) FROM prod_posto_pessoa WHERE company_id = c),
    'custos',        (SELECT count(*) FROM prod_posto_custo WHERE company_id = c));
END $function$;

-- Guarda de função (REVOKE anon + grant mínimo): CREATE OR REPLACE preserva a ACL, mas a régua
-- de CI exige a declaração explícita na migration que recria a SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_postos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_postos(uuid) TO service_role;
