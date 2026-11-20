-- PDCA aud8 · /dashboard/produtividade (Quadro posto a posto · DEMO indústria 005) · desenvolvedor_4_g 19/11/2026
-- ============================================================================
-- GAP do auditor (score 90/95): "os 8 postos ocupados exibem CARGO vazio ('—') e os turnos
--   T1/T2/T3 vazios ('—') na tabela Quadro posto a posto — o vínculo cargo↔posto e o quadro de
--   turno não vêm populados na DEMO, então a jornada 'quadro real por turno' aparece incompleta."
-- CAUSA-RAIZ (RD-38, provado no banco de produção):
--   • prod_posto da 005: 11 postos, TODOS com cargo_id NULL  → coluna Cargo = '—'
--   • prod_posto_turno da 005: 0 linhas                       → T1/T2/T3 (projetado) = '—'
--   A tela lê fn_rh_quadro_lotacao, que tira Cargo de prod_posto.cargo_id→prod_cargo e o projetado
--   por turno de prod_posto_turno.pessoas (rankeado por hora_entrada). Sem esses dados, ambos ficam vazios.
-- CORREÇÃO (aditiva, idempotente, travada em is_demo — RD-69/LGPD, dado 100% fictício):
--   dentro de fn_demo_seed_industria_postos (que já recria postos/custos/pessoas a cada reset) passa a:
--   1) carimbar o cargo de cada posto (resolve prod_cargo por nome; cria se faltar), e
--   2) semear o quadro de turno: 3 turnos-catálogo com ids fixos (T1/T2/T3) + prod_posto_turno
--      (1 pessoa no T1 em todo posto; a linha de Abate 01–04 opera em 2 turnos → +1 no T2).
--   Os turnos-catálogo usam ids fixos próprios (faixa …12xx) para NÃO colidir com as instâncias
--   diárias de turno da 005 (…1001/…1002, outro recurso). prod_posto_turno já é APAGADO no início do
--   seed, então a reinserção é limpa a cada reset.
-- Corpo idêntico ao vivo (pg_get_functiondef), só com o cargo no catálogo de postos e o bloco de turno.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_postos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  -- turnos-catálogo (ids fixos próprios; não colidem com as instâncias diárias …1001/…1002)
  v_t1 constant uuid := 'dede0005-0000-4000-a000-000000001201';
  v_t2 constant uuid := 'dede0005-0000-4000-a000-000000001202';
  v_t3 constant uuid := 'dede0005-0000-4000-a000-000000001203';
  v_planta uuid;
  v_abate  uuid;
  v_desossa uuid;
  v_setor  uuid;
  v_posto  uuid;
  v_cargo  uuid;
  v_i      int := 0;
  v_cpf    text;
  r        record;
  -- fluxo produtivo (raias) + rendimento
  v_fab uuid; v_fde uuid;
  v_boi uuid; v_carc uuid; v_dia uuid; v_coxao uuid; v_pic uuid; v_sebo uuid;
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

  -- idempotência: zera o fluxo produtivo da DEMO ANTES dos postos (prod_fluxo_etapa
  -- aponta para posto/fluxo; prod_tarefa para etapa; prod_estrutura para fluxo).
  DELETE FROM prod_tarefa       WHERE company_id = c;
  DELETE FROM prod_estrutura    WHERE company_id = c;
  DELETE FROM prod_fluxo_etapa  WHERE company_id = c;
  DELETE FROM prod_fluxo        WHERE company_id = c;

  -- idempotência: zera só os postos/custos/pessoas desta DEMO
  DELETE FROM prod_posto_custo  WHERE company_id = c;
  DELETE FROM prod_posto_pessoa WHERE company_id = c;
  DELETE FROM prod_posto_turno  WHERE company_id = c;
  DELETE FROM prod_posto        WHERE company_id = c;

  -- turnos-catálogo T1/T2/T3 (ids fixos, idempotentes). Fonte dos horários do quadro de turno e do seletor.
  INSERT INTO ind_turnos (id, company_id, plant_id, turno, codigo, nome, inicio, fim, ativo)
  VALUES
    (v_t1, c, v_planta, 'A', 'T1', 'T1 · 06:00–14:00', '06:00', '14:00', true),
    (v_t2, c, v_planta, 'B', 'T2', 'T2 · 14:00–22:00', '14:00', '22:00', true),
    (v_t3, c, v_planta, 'C', 'T3', 'T3 · 22:00–06:00', '22:00', '06:00', true)
  ON CONFLICT (id) DO UPDATE SET
    company_id = EXCLUDED.company_id, plant_id = EXCLUDED.plant_id, turno = EXCLUDED.turno,
    codigo = EXCLUDED.codigo, nome = EXCLUDED.nome, inicio = EXCLUDED.inicio, fim = EXCLUDED.fim, ativo = true;

  -- catálogo de postos: fluxo do abate → desossa. ocupa=false ⇒ vaga aberta (sem pessoa).
  -- (setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos_pct, cargo)
  FOR r IN
    SELECT * FROM (VALUES
      -- Abate (fluxo da nave de abate)
      ('A','01','Insensibilização',          1, true,  'Bruno Carvalho Demo',  3200, 68, 'Operador de abate'),
      ('A','02','Sangria',                    2, true,  'Diego Rocha Demo',     3000, 68, 'Operador de abate'),
      ('A','03','Esfola',                     3, true,  'Fábio Lima Demo',      3100, 68, 'Operador de abate'),
      ('A','04','Evisceração',                4, true,  'Hugo Martins Demo',    3100, 68, 'Operador de abate'),
      ('A','05','Inspeção oficial (SIF)',     5, false, NULL,                   3600, 68, 'Técnico de segurança do trabalho'),
      ('A','06','Tipificação e pesagem',      6, true,  'João Pedro Demo',      3400, 68, 'Operador de abate'),
      -- Desossa (sala de desossa / embalagem)
      ('D','01','Quarteamento',               1, true,  'Lucas Ferreira Demo',  2900, 68, 'Desossador'),
      ('D','02','Desossa do dianteiro',       2, true,  'Nelson Pires Demo',    2950, 68, 'Desossador'),
      ('D','03','Desossa do traseiro',        3, false, NULL,                   2950, 68, 'Desossador'),
      ('D','04','Embalagem a vácuo',          4, true,  'Paulo Teixeira Demo',  2700, 68, 'Auxiliar de embalagem'),
      ('D','05','Expedição',                  5, false, NULL,                   2800, 68, 'Operador de câmara fria')
    ) AS t(setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos, cargo)
  LOOP
    v_setor := CASE r.setor_tag WHEN 'A' THEN v_abate ELSE v_desossa END;

    -- cargo do posto: resolve prod_cargo por nome (cria se faltar) e carimba no posto
    v_cargo := NULL;
    SELECT id INTO v_cargo FROM prod_cargo
     WHERE company_id = c AND plant_id = v_planta AND nome = r.cargo AND ativo
     ORDER BY created_at LIMIT 1;
    IF v_cargo IS NULL THEN
      INSERT INTO prod_cargo (company_id, plant_id, nome)
      VALUES (c, v_planta, r.cargo) RETURNING id INTO v_cargo;
    END IF;

    INSERT INTO prod_posto (company_id, plant_id, setor_id, cargo_id, numero, atividade, ordem_linha, alocacao, ativo)
    VALUES (c, v_planta, v_setor, v_cargo, r.numero, r.atividade, r.ordem, 'fixa', true)
    RETURNING id INTO v_posto;

    -- custo do posto (salário FAKE + encargos). Base do custo de produção por posto na tela.
    -- horas_operacao_mes = 176 (jornada industrial padrão ~44 h/semana) para o R$/h calcular.
    INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct, horas_operacao_mes)
    VALUES (c, v_planta, v_posto, current_date, r.salario, r.encargos, 176);

    -- quadro de turno projetado (fonte do T1/T2/T3 na tela Quadro): 1 pessoa no T1 em todo posto;
    -- a linha de Abate (postos 01–04) opera em 2 turnos → +1 no T2.
    INSERT INTO prod_posto_turno (company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
    VALUES (c, v_planta, v_posto, v_t1, '06:00', '14:00', 1, current_date);
    IF r.setor_tag = 'A' AND r.ordem <= 4 THEN
      INSERT INTO prod_posto_turno (company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
      VALUES (c, v_planta, v_posto, v_t2, '14:00', '22:00', 1, current_date);
    END IF;

    -- pessoa com CPF MANUAL (sem funcionário real): demonstra o caso "RH preenche na tela".
    IF r.ocupa THEN
      v_i := v_i + 1;
      v_cpf := fn_demo_cpf_valido(556000000 + v_i);
      INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, vigencia_inicio)
      VALUES (c, v_planta, v_posto, NULL, v_cpf, current_date);
    END IF;
  END LOOP;

  -- ===== fluxo produtivo (raias) + etapas + rendimento + tarefas =====
  -- Sem isto, Apontamento/Mapa/Tarefas abrem vazias e a jornada b/c não é exercitável.

  -- 1) raias
  INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
  VALUES (c, v_planta, v_abate,   'Linha de Abate',   'compartilhado', 'desmontagem', 1, true)
  RETURNING id INTO v_fab;
  INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
  VALUES (c, v_planta, v_desossa, 'Linha de Desossa', 'compartilhado', 'desmontagem', 2, true)
  RETURNING id INTO v_fde;

  -- 2) etapas = postos ativos de cada setor, em ordem de linha
  INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT c, v_planta, v_fab, p.id, p.ordem_linha, p.atividade, 'manual', 45, 2, (p.atividade ILIKE '%Inspe%')
    FROM prod_posto p
   WHERE p.company_id = c AND p.setor_id = v_abate AND p.ativo;
  INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT c, v_planta, v_fde, p.id, p.ordem_linha, p.atividade, 'manual', 60, 3, false
    FROM prod_posto p
   WHERE p.company_id = c AND p.setor_id = v_desossa AND p.ativo;

  -- 3) rendimento do caminho (entra/sai por raia)
  SELECT id INTO v_boi   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-001';
  SELECT id INTO v_carc  FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-010';
  SELECT id INTO v_dia   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-100';
  SELECT id INTO v_coxao FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-202';
  SELECT id INTO v_pic   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-204';
  SELECT id INTO v_sebo  FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-400';

  INSERT INTO prod_estrutura (company_id, plant_id, fluxo_id, origem_produto_id, produto_id, tipo_saida, rendimento_padrao_pct, status, vigencia_inicio, ativo)
  SELECT s.a, s.b, s.c, s.d, s.e, s.f, s.g, s.h, s.i, s.j
    FROM (VALUES
      (c, v_planta, v_fab, v_boi,  v_carc,  'principal',  54.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_dia,   'principal',  48.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_coxao, 'coproduto',   9.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_pic,   'coproduto',   2.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_sebo,  'subproduto', 12.0, 'validado', CURRENT_DATE, true)
    ) s(a, b, c, d, e, f, g, h, i, j)
   WHERE s.d IS NOT NULL AND s.e IS NOT NULL AND s.d <> s.e;

  -- 4) 1 tarefa por etapa (cadeia fluxo→etapa→tarefa navegável na tela de Tarefas)
  INSERT INTO prod_tarefa (company_id, plant_id, etapa_id, ordem, nome, estado, ativo)
  SELECT e.company_id, e.plant_id, e.id, 1, e.nome, 'valida', true
    FROM prod_fluxo_etapa e
   WHERE e.company_id = c AND e.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_postos',
    'postos',        (SELECT count(*) FROM prod_posto WHERE company_id = c),
    'postos_com_cargo', (SELECT count(*) FROM prod_posto WHERE company_id = c AND cargo_id IS NOT NULL),
    'turnos_quadro', (SELECT count(*) FROM prod_posto_turno WHERE company_id = c),
    'ocupados',      (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'vagas_abertas', (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND NOT EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'pessoas',       (SELECT count(*) FROM prod_posto_pessoa WHERE company_id = c),
    'custos',        (SELECT count(*) FROM prod_posto_custo WHERE company_id = c),
    'fluxos',        (SELECT count(*) FROM prod_fluxo WHERE company_id = c),
    'etapas',        (SELECT count(*) FROM prod_fluxo_etapa WHERE company_id = c),
    'rendimentos',   (SELECT count(*) FROM prod_estrutura WHERE company_id = c),
    'tarefas',       (SELECT count(*) FROM prod_tarefa WHERE company_id = c));
END $function$;

-- Guarda de função (RD-30 / check-fn-guards): fn_demo_seed_industria_postos é SECURITY DEFINER;
-- só o canal de serviço do reset executa (mesmo ACL atual: service_role).
-- ci-sem-guarda: fn_demo_seed_industria_postos — seed da DEMO trava no company_id fixo
--   b0700000-0000-4000-a000-000000000005 (p_company_id IS DISTINCT FROM c → erro) e exige
--   companies.is_demo IS TRUE; nunca escreve em empresa de cliente, logo não chama fn__guarda_empresa.
REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_postos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_postos(uuid) TO service_role;
