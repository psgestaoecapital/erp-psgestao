-- Tarefa f448ca7b (Eng. Chefe 11/11) — UNIFICAR os dois modelos de posto.
--
-- Achado (provado no banco): existiam 2 modelos paralelos para a MESMA coisa (RD-71/RD-65):
--   • MODELO A = prod_setor/prod_posto/prod_posto_pessoa/prod_posto_custo/prod_posto_turno
--     (cadastro por fluxo, apontamento e custo MO/kg). É o posto REAL que a produtividade usa.
--   • MODELO B = rh_posto_trabalho/rh_alocacao/rh_remuneracao (fn_rh_importar_postos + fn_rh_quadro_lotacao).
-- Resultado: a planilha importada (MODELO B) NÃO aparecia no cadastro posto a posto (MODELO A),
-- e o cadastro não aparecia no Painel de RH. Prova RD-38: rh_posto_trabalho tem 0 linhas em TODAS
-- as empresas (modelo B nunca populou de verdade) — logo trocar a fonte NÃO regride nada.
--
-- DECISÃO DE ARQUITETURA (Eng. Chefe): o posto é UM só = prod_posto. O RH é camada sobre ele.
--   1) fn_rh_importar_postos passa a gravar em prod_setor/prod_posto/prod_posto_pessoa/prod_posto_custo
--      (REUSANDO os CRUD fn_prod_setor_salvar/fn_prod_cargo_salvar/fn_prod_posto_salvar/
--       fn_prod_posto_custo_salvar/fn_prod_posto_pessoa_alocar — RD-26/RD-71), idempotente pelo Nº PO.
--   2) fn_rh_quadro_lotacao (Painel de RH) passa a ler de prod_posto/prod_posto_pessoa/prod_posto_custo/
--      prod_posto_turno, mantendo EXATAMENTE o mesmo formato de saída (RD-82 — mesma DEMO antes/depois
--      para o que já existia, que era vazio), com o custo gated pela folha (LGPD, fn__pode_ver_folha).
--   3) rh_* ficam em RESERVA (RD-30) — nada de DROP; a assinatura das funções e as chaves do payload
--      da tela de import (#4113) são preservadas (RD-97).
--
-- QUADRO POR TURNO (correção do veredito Eng. Chefe 11/11, decisões 12/11):
--   • O quadro por turno é prod_posto_turno.pessoas — FONTE ÚNICA (RD-71). A importação NÃO inventa
--     turno nem cria colunas novas em prod_posto. As colunas T1/T2/T3 da planilha CASAM com os turnos
--     que JÁ existem na empresa (definições em ind_turnos, data IS NULL), ordenados por horário de
--     entrada: T1 = 1º turno, T2 = 2º, T3 = 3º. O que casa grava em prod_posto_turno (reusa o CRUD
--     fn_prod_posto_turno_salvar, upsert idempotente). O que NÃO casa (planta com menos turnos que a
--     coluna preenchida) vira exceção listada ao usuário (RD-77), nunca descartada em silêncio.
--     Na DEMO 005 (1 turno, 06:00) só T1 entra — é o comportamento certo.
--
-- ADITIVA: só CREATE OR REPLACE de 2 funções já existentes. Sem ADD/DROP de coluna, sem apagar/alterar
-- dado de cliente. O custo individual por posto só aparece para quem pode ver folha.
--
-- PROVA RD-38 (BEGIN/ROLLBACK, impersonando um admin da DEMO Indústria b0700000-...-005):
--   • import de 3 linhas (1 VAGA com T1, 1 pessoa fora do ponto, 1 sem setor) => criados: postos 2,
--     vagas 1, turnos 2 (T1 casou o turno 06:00 nas 2 linhas com setor), remuneracoes 1, excecoes 2
--     (nome_nao_casou_ponto + sem_setor; RD-77), alocacoes 0;
--   • REIMPORT idêntico => postos 0, ja_existiam 2, turnos 2 (upsert do MESMO turno, sem duplicar),
--     excecoes 0 (idempotente pelo Nº PO);
--   • fn_rh_quadro_lotacao lê prod_posto + prod_posto_turno e devolve o MESMO formato (kpis + lista com
--     proj_t1..t3, proj_total, real, gap, custo), com custo só para quem pode_salario. Tudo no ROLLBACK.

-- (1) Import: grava no modelo prod_posto, idempotente pelo Nº PO, pessoa por CPF do ponto,
--     quadro por turno casando os turnos existentes (ind_turnos) em prod_posto_turno.
CREATE OR REPLACE FUNCTION public.fn_rh_importar_postos(p_company_id uuid, p_linhas jsonb, p_registrado_por uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l jsonb; v_reg uuid := COALESCE(p_registrado_por, auth.uid());
  v_plant uuid;
  v_codigo text; v_setor_in text; v_setor_id uuid; v_posto_id uuid;
  v_nome text; v_vaga boolean; v_cpf text; v_func_id uuid;
  v_cargo_in text; v_cargo_id uuid; v_tipo_in text; v_tipo_id uuid; v_cat_in text; v_cat_id uuid;
  v_ativ text; v_cc text; v_sup text;
  v_t int[]; v_n int; v_tn int; v_vig date;
  -- turnos existentes da planta (definições estáveis: data IS NULL), ordenados por horário de entrada
  v_turnos uuid[]; v_turno_hi time[]; v_turno_ho time[]; v_nturnos int;
  v_base numeric; v_insal numeric; v_vale numeric; v_outros numeric; v_enc_val numeric; v_mo numeric; v_pct numeric;
  v_res jsonb;
  n_posto int := 0; n_posto_exist int := 0; n_vaga int := 0; n_aloc int := 0; n_custo int := 0;
  n_exc int := 0; n_turno int := 0;
  v_sum_base numeric := 0; v_sum_exc numeric := 0; v_ant int;
BEGIN
  -- Gate: só RH (rh_industrial) + sócio + admin rodam a carga (consistente com o LGPD do custo).
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'p_linhas_deve_ser_array');
  END IF;

  -- Planta: a primeira planta industrial da empresa (o quadro é da planta).
  SELECT id INTO v_plant FROM industrial_plants WHERE company_id = p_company_id ORDER BY created_at LIMIT 1;
  IF v_plant IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_planta_industrial'); END IF;

  -- Turnos da empresa/planta (NÃO inventa): definições estáveis (data IS NULL), ativas, por horário de entrada.
  SELECT array_agg(id ORDER BY inicio NULLS LAST, created_at),
         array_agg(inicio ORDER BY inicio NULLS LAST, created_at),
         array_agg(fim ORDER BY inicio NULLS LAST, created_at)
    INTO v_turnos, v_turno_hi, v_turno_ho
    FROM ind_turnos
   WHERE company_id = p_company_id AND (plant_id = v_plant OR plant_id IS NULL)
     AND data IS NULL AND ativo;
  v_nturnos := COALESCE(array_length(v_turnos, 1), 0);

  SELECT count(*) INTO v_ant FROM prod_posto WHERE company_id = p_company_id AND plant_id = v_plant;

  FOR l IN SELECT jsonb_array_elements(p_linhas) LOOP
    v_codigo   := NULLIF(btrim(l->>'codigo_po'), '');
    v_setor_in := NULLIF(btrim(l->>'setor_nome'), '');
    v_nome     := NULLIF(btrim(l->>'nome'), '');
    v_vaga     := (v_nome IS NULL OR upper(v_nome) LIKE '%VAGA%');
    v_ativ     := NULLIF(btrim(l->>'atividade'), '');
    v_cc       := NULLIF(btrim(l->>'centro_custo'), '');
    v_sup      := NULLIF(btrim(l->>'supervisao'), '');
    v_cargo_in := NULLIF(btrim(l->>'cargo'), '');
    v_tipo_in  := NULLIF(btrim(l->>'tipo'), '');
    v_cat_in   := NULLIF(btrim(l->>'categoria_produto'), '');
    v_t := ARRAY[
      COALESCE((l->>'qtd_proj_t1')::int, 0),
      COALESCE((l->>'qtd_proj_t2')::int, 0),
      COALESCE((l->>'qtd_proj_t3')::int, 0)
    ];

    -- Setor é OBRIGATÓRIO em prod_posto. Sem setor -> exceção (RD-77, nunca descarta em silêncio).
    -- Idempotente: reimportar a mesma linha rejeitada NÃO duplica a exceção (dedup por Nº PO + nome + motivo).
    IF v_setor_in IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao e WHERE e.company_id = p_company_id
           AND COALESCE(e.codigo_po,'') = COALESCE(v_codigo,'') AND COALESCE(e.nome,'') = COALESCE(v_nome,'') AND e.motivo = 'sem_setor') THEN
        INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
        VALUES (p_company_id, v_nome, v_codigo, 'sem_setor', l, v_reg);
        n_exc := n_exc + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Setor: find-or-create (reusa o CRUD do posto).
    SELECT id INTO v_setor_id FROM prod_setor
     WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant AND lower(nome) = lower(v_setor_in) LIMIT 1;
    IF v_setor_id IS NULL THEN
      v_res := fn_prod_setor_salvar(jsonb_build_object('company_id', p_company_id, 'plant_id', v_plant, 'nome', v_setor_in), v_reg);
      v_setor_id := NULLIF(v_res->>'id', '')::uuid;
    END IF;
    IF v_setor_id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao e WHERE e.company_id = p_company_id
           AND COALESCE(e.codigo_po,'') = COALESCE(v_codigo,'') AND COALESCE(e.nome,'') = COALESCE(v_nome,'') AND e.motivo = 'setor_falhou') THEN
        INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
        VALUES (p_company_id, v_nome, v_codigo, 'setor_falhou', l || jsonb_build_object('_erro', v_res), v_reg);
        n_exc := n_exc + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Cargo: find-or-create.
    v_cargo_id := NULL;
    IF v_cargo_in IS NOT NULL THEN
      SELECT id INTO v_cargo_id FROM prod_cargo
       WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant AND lower(nome) = lower(v_cargo_in) LIMIT 1;
      IF v_cargo_id IS NULL THEN
        v_res := fn_prod_cargo_salvar(jsonb_build_object('company_id', p_company_id, 'plant_id', v_plant, 'nome', v_cargo_in), v_reg);
        v_cargo_id := NULLIF(v_res->>'id', '')::uuid;
      END IF;
    END IF;

    -- Tipo de posto: é um ENUM FIXO do modelo (codigo IN manual/misto/automatico) — só CASA, nunca cria.
    -- Casa pelo nome OU pelo código; ICP sem correspondência => deixa NULL (não polui o enum).
    v_tipo_id := NULL;
    IF v_tipo_in IS NOT NULL THEN
      SELECT id INTO v_tipo_id FROM prod_tipo_posto
       WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant
         AND (lower(nome) = lower(v_tipo_in) OR lower(codigo) = lower(v_tipo_in)) LIMIT 1;
    END IF;

    -- Categoria do produto (ICP): find-or-create.
    v_cat_id := NULL;
    IF v_cat_in IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM prod_categoria_produto
       WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant AND lower(nome) = lower(v_cat_in) LIMIT 1;
      IF v_cat_id IS NULL THEN
        BEGIN
          INSERT INTO prod_categoria_produto (company_id, plant_id, nome, ordem, ativo)
          VALUES (p_company_id, v_plant, v_cat_in,
                  (SELECT COALESCE(max(ordem), 0) + 1 FROM prod_categoria_produto WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant),
                  true) RETURNING id INTO v_cat_id;
        EXCEPTION WHEN unique_violation THEN
          SELECT id INTO v_cat_id FROM prod_categoria_produto
           WHERE company_id = p_company_id AND plant_id IS NOT DISTINCT FROM v_plant AND lower(nome) = lower(v_cat_in) LIMIT 1;
        END;
      END IF;
    END IF;

    -- Atividade é NOT NULL em prod_posto.
    v_ativ := COALESCE(v_ativ, v_cargo_in, 'Posto ' || COALESCE(v_codigo, 's/ código'));

    -- Posto: idempotente pelo Nº PO (empresa+planta). Achou -> atualiza; senão -> cria.
    v_posto_id := NULL;
    IF v_codigo IS NOT NULL THEN
      SELECT id INTO v_posto_id FROM prod_posto
       WHERE company_id = p_company_id AND plant_id = v_plant AND numero = v_codigo LIMIT 1;
    END IF;
    v_res := fn_prod_posto_salvar(jsonb_build_object(
      'id', v_posto_id, 'company_id', p_company_id, 'plant_id', v_plant, 'setor_id', v_setor_id,
      'numero', v_codigo, 'atividade', v_ativ, 'cargo_id', v_cargo_id, 'tipo_posto_id', v_tipo_id,
      'categoria_produto_id', v_cat_id, 'centro_custo', v_cc, 'supervisor_nome', v_sup, 'alocacao', 'fixa'), v_reg);
    IF (v_res->>'ok')::boolean IS NOT TRUE THEN
      IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao e WHERE e.company_id = p_company_id
           AND COALESCE(e.codigo_po,'') = COALESCE(v_codigo,'') AND COALESCE(e.nome,'') = COALESCE(v_nome,'') AND e.motivo = 'posto_falhou') THEN
        INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
        VALUES (p_company_id, v_nome, v_codigo, 'posto_falhou', l || jsonb_build_object('_erro', v_res), v_reg);
        n_exc := n_exc + 1;
      END IF;
      CONTINUE;
    END IF;
    v_posto_id := NULLIF(v_res->>'id', '')::uuid;
    IF (v_res->>'criou')::boolean THEN n_posto := n_posto + 1; ELSE n_posto_exist := n_posto_exist + 1; END IF;

    -- Quadro projetado por turno: casa T1/T2/T3 com os turnos EXISTENTES (ordem por horário de entrada).
    -- Fonte única: prod_posto_turno.pessoas (reusa o CRUD, upsert idempotente). Sem turno -> exceção RD-77.
    FOR v_n IN 1..3 LOOP
      v_tn := v_t[v_n];
      CONTINUE WHEN v_tn <= 0;                       -- coluna vazia: nada a gravar
      IF v_n <= v_nturnos THEN
        -- vigência estável: usa a vigência aberta se já houver (idempotente), senão hoje
        SELECT vigencia_inicio INTO v_vig FROM prod_posto_turno
         WHERE posto_id = v_posto_id AND turno_id = v_turnos[v_n] AND vigencia_fim IS NULL
         ORDER BY vigencia_inicio DESC LIMIT 1;
        v_vig := COALESCE(v_vig, CURRENT_DATE);
        v_res := fn_prod_posto_turno_salvar(v_posto_id, v_turnos[v_n], v_turno_hi[v_n], v_turno_ho[v_n], v_tn, v_vig);
        IF (v_res->>'ok')::boolean THEN n_turno := n_turno + 1; END IF;
      ELSE
        -- planta tem menos turnos que a coluna preenchida -> exceção listada (RD-77), idempotente
        IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao e
             WHERE e.company_id = p_company_id AND COALESCE(e.codigo_po,'') = COALESCE(v_codigo,'')
               AND e.motivo = 'turno_inexistente' AND e.dados->>'_turno_idx' = v_n::text) THEN
          INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
          VALUES (p_company_id, v_nome, v_codigo, 'turno_inexistente',
                  l || jsonb_build_object('_turno_idx', v_n, '_pessoas', v_tn), v_reg);
          n_exc := n_exc + 1;
        END IF;
      END IF;
    END LOOP;

    -- Custo do posto: mao_obra_mes = base+insal+vale+outros; encargos_pct a partir de encargos_valor.
    v_base   := COALESCE((l->>'salario_base')::numeric, 0);
    v_insal  := COALESCE((l->>'insalubridade')::numeric, 0);
    v_vale   := COALESCE((l->>'vale')::numeric, 0);
    v_outros := COALESCE((l->>'outros')::numeric, 0);
    v_enc_val := COALESCE((l->>'encargos_valor')::numeric, 0);
    v_mo := v_base + v_insal + v_vale + v_outros;
    IF v_mo > 0 THEN
      v_pct := round(v_enc_val / v_mo * 100, 4);
      v_res := fn_prod_posto_custo_salvar(jsonb_build_object('posto_id', v_posto_id, 'mao_obra_mes', v_mo, 'encargos_pct', v_pct));
      IF (v_res->>'ok')::boolean THEN n_custo := n_custo + 1; END IF;
    END IF;

    IF v_vaga THEN n_vaga := n_vaga + 1; CONTINUE; END IF;

    -- Pessoa: nome -> CPF do ponto -> funcionário do cadastro -> aloca pelo funcionario_id.
    v_cpf := NULL; v_func_id := NULL;
    SELECT cpf INTO v_cpf FROM ind_ponto_colaborador
     WHERE company_id = p_company_id AND lower(btrim(nome)) = lower(v_nome) LIMIT 1;
    IF v_cpf IS NOT NULL THEN
      SELECT id INTO v_func_id FROM compliance_funcionarios
       WHERE company_id = p_company_id
         AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = regexp_replace(v_cpf, '\D', '', 'g')
       ORDER BY (ativo IS TRUE) DESC LIMIT 1;
    END IF;
    IF v_func_id IS NULL THEN
      -- Sem par no cadastro -> exceção listada (RD-77), nunca descarta em silêncio.
      IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao WHERE company_id = p_company_id
                       AND COALESCE(nome, '') = COALESCE(v_nome, '') AND COALESCE(codigo_po, '') = COALESCE(v_codigo, '')
                       AND motivo IN ('nome_nao_casou_ponto','cpf_sem_funcionario')) THEN
        INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
        VALUES (p_company_id, v_nome, v_codigo, CASE WHEN v_cpf IS NULL THEN 'nome_nao_casou_ponto' ELSE 'cpf_sem_funcionario' END, l, v_reg);
        n_exc := n_exc + 1; v_sum_exc := v_sum_exc + v_base;
      END IF;
      CONTINUE;
    END IF;

    v_res := fn_prod_posto_pessoa_alocar(jsonb_build_object('posto_id', v_posto_id, 'funcionario_id', v_func_id), v_reg);
    IF (v_res->>'ok')::boolean THEN n_aloc := n_aloc + 1; v_sum_base := v_sum_base + v_base; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'antes',  jsonb_build_object('postos', v_ant),
    'criados', jsonb_build_object('postos', n_posto, 'vagas', n_vaga, 'alocacoes', n_aloc, 'turnos', n_turno,
                                  'remuneracoes', n_custo, 'excecoes', n_exc, 'ja_existiam', n_posto_exist),
    'depois', jsonb_build_object('postos', (SELECT count(*) FROM prod_posto WHERE company_id = p_company_id AND plant_id = v_plant)),
    'soma_base_importada', v_sum_base,
    'soma_base_excecoes',  v_sum_exc,
    'soma_base_total',     v_sum_base + v_sum_exc
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_importar_postos(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_importar_postos(uuid, jsonb, uuid) TO authenticated, service_role;

-- (2) Painel de RH: lê do modelo prod_posto + prod_posto_turno, MESMO formato de saída,
--     custo gated pela folha (LGPD, fn__pode_ver_folha — #4564, já em produção).
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_lotacao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pode_salario boolean; v_kpis jsonb; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_pode_salario := fn__pode_ver_folha(p_company_id);  -- gate da folha (LGPD)

  -- Uma CTE em uma única instrução gera KPIs e lista (CTE só vive dentro de uma instrução).
  WITH custo AS (
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id,
           COALESCE(pc.mao_obra_mes,0) * (1 + COALESCE(pc.encargos_pct,0)/100.0) AS custo_mes
    FROM prod_posto_custo pc
    WHERE pc.company_id = p_company_id AND pc.deleted_at IS NULL
    ORDER BY pc.posto_id, pc.vigencia_inicio DESC NULLS LAST
  ),
  -- Quadro projetado = prod_posto_turno.pessoas (fonte única), por horário de entrada do turno.
  turnos AS (
    SELECT pt.posto_id, pt.pessoas,
           row_number() OVER (PARTITION BY pt.posto_id ORDER BY pt.hora_entrada NULLS LAST, pt.turno_id) AS rn
    FROM prod_posto_turno pt
    WHERE pt.company_id = p_company_id
      AND (pt.vigencia_fim IS NULL OR pt.vigencia_fim >= CURRENT_DATE)
  ),
  proj AS (
    SELECT posto_id,
           COALESCE(SUM(pessoas), 0)                      AS proj_total,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 1),0) AS proj_t1,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 2),0) AS proj_t2,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 3),0) AS proj_t3
    FROM turnos GROUP BY posto_id
  ),
  p AS (
    SELECT pp.id, pp.numero, pp.atividade, pp.ativo,
           COALESCE(pr.proj_total, 0) AS proj_total,
           COALESCE(pr.proj_t1, 0) AS proj_t1, COALESCE(pr.proj_t2, 0) AS proj_t2, COALESCE(pr.proj_t3, 0) AS proj_t3,
           st.nome AS setor_nome, cg.nome AS cargo_nome,
           COALESCE(c.custo_mes, 0) AS custo_mes,
           (SELECT count(DISTINCT COALESCE(x.funcionario_id::text, x.cpf, x.id::text))
              FROM prod_posto_pessoa x
             WHERE x.posto_id = pp.id AND (x.vigencia_fim IS NULL OR x.vigencia_fim >= CURRENT_DATE)) AS reais
    FROM prod_posto pp
    LEFT JOIN prod_setor st ON st.id = pp.setor_id
    LEFT JOIN prod_cargo  cg ON cg.id = pp.cargo_id
    LEFT JOIN custo        c ON c.posto_id = pp.id
    LEFT JOIN proj        pr ON pr.posto_id = pp.id
    WHERE pp.company_id = p_company_id
  ),
  kpi AS (
    SELECT jsonb_build_object(
      'postos_ativos',    count(*) FILTER (WHERE ativo),
      'postos_ocupados',  count(*) FILTER (WHERE ativo AND reais > 0),
      'vagas_abertas',    count(*) FILTER (WHERE ativo AND reais < proj_total),
      'proj_total',       COALESCE(sum(proj_total) FILTER (WHERE ativo), 0),
      'real_total',       COALESCE(sum(reais) FILTER (WHERE ativo), 0),
      'custo_registrado', CASE WHEN v_pode_salario THEN COALESCE(sum(custo_mes) FILTER (WHERE ativo), 0) ELSE NULL END
    ) AS j FROM p
  ),
  lst AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'setor', COALESCE(setor_nome, 'Sem setor'),
        'posto_id', id, 'codigo_po', numero, 'cargo', cargo_nome, 'atividade', atividade,
        'proj_t1', proj_t1, 'proj_t2', proj_t2, 'proj_t3', proj_t3, 'proj_total', proj_total,
        'real', reais, 'gap', proj_total - reais,
        'custo', CASE WHEN v_pode_salario THEN custo_mes ELSE NULL END
      ) ORDER BY COALESCE(setor_nome, 'Sem setor'), numero), '[]'::jsonb) AS j
    FROM p WHERE ativo
  )
  SELECT kpi.j, lst.j INTO v_kpis, v_lista FROM kpi, lst;

  RETURN jsonb_build_object('ok', true, 'pode_salario', v_pode_salario, 'kpis', v_kpis, 'lista', v_lista);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_quadro_lotacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_lotacao(uuid) TO authenticated, service_role;
