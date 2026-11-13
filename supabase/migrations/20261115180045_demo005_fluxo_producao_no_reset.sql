-- Auditor PDCA · /dashboard/produtividade/apontamento (gap1) e /dashboard/produtividade/tarefas (gap1):
-- a DEMO Indústria (005) abre as telas de Apontamento, Mapa e Tarefas VAZIAS porque
-- não existe fluxo produtivo (prod_fluxo) semeado. Sem fluxo não há raia, etapa nem
-- tarefa, então a jornada do PDCA (critérios b/c: o dado CARREGA para a etapa seguinte
-- e o status muda ao apontar) NÃO é exercitável (RD-38).
--
-- A migration 20261113222010 semeou esse fluxo UMA VEZ (bloco DO avulso), mas o seed
-- NÃO sobrevive ao fn_demo_reset: a cada reset os setores/postos da DEMO são recriados
-- com ids NOVOS (fn_demo_seed_industria_postos deleta e reinsere prod_posto), e o fluxo
-- antigo — que referenciava os ids velhos — some (cascata de setor/posto). Por isso hoje
-- prod_fluxo da DEMO 005 = 0 mesmo com a migration no ledger.
--
-- CORREÇÃO DURADOURA (RD-38): mover o seed do fluxo para DENTRO de
-- fn_demo_seed_industria_postos, logo após os postos serem recriados, usando os ids
-- ATUAIS de setor/posto/produto. Assim o fluxo é reconstruído a cada reset e as telas
-- sempre têm dado para exercitar a jornada.
--
-- O que é semeado (idêntico ao desenho validado em 20261113222010, agora persistente):
--   • 2 raias (prod_fluxo): "Linha de Abate" (setor Abate) e "Linha de Desossa"
--     (setor Desossa), modo compartilhado, direção desmontagem;
--   • etapas (prod_fluxo_etapa) = os postos ativos de cada setor, em ordem de linha;
--   • rendimento do caminho (prod_estrutura): Abate BOV-001 (boi) → BOV-010 (carcaça)
--     54%; Desossa carcaça → BOV-100 dianteiro 48% (principal), BOV-202 9% e BOV-204 2%
--     (coprodutos), BOV-400 12% (subproduto);
--   • 1 tarefa (prod_tarefa) por etapa, nomeada pela atividade do posto, para a tela de
--     Tarefas abrir com a cadeia fluxo→etapa→tarefa navegável.
--
-- SEGURANÇA/ESCOPO: SÓ a DEMO 005 (is_demo, RD-69) — a própria função já trava
-- p_company_id = DEMO e NOT is_demo. Nenhuma linha de cliente é tocada. Sem DDL, sem
-- RLS/grant/RPC nova; usa só tabelas prod_* já existentes (RLS por company_id). Delete
-- físico das linhas da DEMO sob o mesmo guard app.permitir_delete_fisico já ligado na
-- função (RD-30). ADITIVA ao reset, IDEMPOTENTE (zera e recria as linhas da DEMO).
-- ci-sem-guarda: fn_demo_seed_industria_postos — seed de manutenção da DEMO, não é escrita
-- por usuário: trava hard no tenant DEMO de indústria (is_demo IS TRUE; recusa outro
-- p_company_id) e só service_role executa; o lock is_demo é o próprio guard, não fn__guarda_empresa.

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

-- Guarda estática do check-fn-guards (ACL viva já segura; CREATE OR REPLACE preserva a ACL).
-- Função de seed só da DEMO, chamada pela conexão de serviço no fn_demo_reset.
REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_postos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_postos(uuid) TO service_role;
