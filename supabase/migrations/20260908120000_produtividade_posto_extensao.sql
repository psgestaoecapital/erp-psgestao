-- ============================================================
-- Produtividade · colunas da planilha + vinculos de custo/EPI/risco + RPCs da tela unica
-- As tres tabelas de vinculo nascem VAZIAS e OPCIONAIS: existem para o dado ter onde entrar
-- quando a operacao comecar — nao bloqueiam nada agora. RLS padrao prod_* nas quatro.
-- ============================================================

-- 2.1 categoria de produto: dentro do mesmo setor ha linhas diferentes (Abate x Miudos).
--     Sem isso, kg de miudo entra na conta do abate. Livre por empresa (decisao P4).
CREATE TABLE IF NOT EXISTS public.prod_categoria_produto (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ordem      int  NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, nome)
);

ALTER TABLE public.prod_posto
  ADD COLUMN IF NOT EXISTS categoria_produto_id uuid
    REFERENCES public.prod_categoria_produto(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS indicador_id uuid;   -- KPI que o posto alimenta
COMMENT ON COLUMN public.prod_posto.indicador_id IS
  'Indicador do catalogo que este posto alimenta. Sem FK por ora: ind_indicador_catalogo '
  'sera confirmada antes de amarrar (RD-26 / decisao P2).';

-- 2.2 QUEM trabalha no posto — a peca que destrava HE, custo e EPI por posto (nominal, opcional).
CREATE TABLE IF NOT EXISTS public.prod_posto_pessoa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id       uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  posto_id       uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.compliance_funcionarios(id) ON DELETE SET NULL,
  cpf            text,
  turno_id       uuid,
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim   date,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid
);
CREATE INDEX IF NOT EXISTS ix_prod_posto_pessoa_vigente
  ON public.prod_posto_pessoa (posto_id) WHERE vigencia_fim IS NULL;
CREATE INDEX IF NOT EXISTS ix_prod_posto_pessoa_cpf
  ON public.prod_posto_pessoa (company_id, cpf) WHERE vigencia_fim IS NULL;
COMMENT ON TABLE public.prod_posto_pessoa IS
  'Alocacao NOMINAL de pessoa a posto, com vigencia. Opcional: o quadro por quantidade '
  '(prod_posto_turno.pessoas) continua sendo a forma principal. O nominal existe para '
  'hora extra, custo e EPI por posto, que dependem da pessoa.';

-- 2.3 EPI exigido pelo posto — vira matriz de conformidade NR-6.
CREATE TABLE IF NOT EXISTS public.prod_posto_epi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posto_id    uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  catalogo_id uuid NOT NULL REFERENCES public.epi_catalogo(id) ON DELETE CASCADE,
  obrigatorio boolean NOT NULL DEFAULT true,
  observacao  text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posto_id, catalogo_id)
);

-- 2.4 risco do posto — alimenta PGR e insalubridade.
CREATE TABLE IF NOT EXISTS public.prod_posto_risco (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posto_id    uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  tipo        text NOT NULL,     -- fisico|quimico|biologico|ergonomico|acidente
  descricao   text NOT NULL,
  grau        text,              -- insalubridade: 20|40 · periculosidade: 30 · NULL = nao classificado
  observacao  text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prod_posto_risco_tipo_chk CHECK (tipo IN
    ('fisico','quimico','biologico','ergonomico','acidente'))
);
COMMENT ON COLUMN public.prod_posto_risco.grau IS
  'Grau de insalubridade/periculosidade em %. NULL = nao classificado, NUNCA zero. '
  'Classificacao e ato do Engenheiro de Seguranca (registro no CREA), nao do sistema.';

-- RLS nas quatro (padrao prod_*: company do usuario ou admin) — isolamento por empresa.
ALTER TABLE public.prod_categoria_produto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_posto_pessoa      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_posto_epi         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_posto_risco       ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_categoria_produto_rw ON public.prod_categoria_produto;
DROP POLICY IF EXISTS prod_posto_pessoa_rw      ON public.prod_posto_pessoa;
DROP POLICY IF EXISTS prod_posto_epi_rw         ON public.prod_posto_epi;
DROP POLICY IF EXISTS prod_posto_risco_rw       ON public.prod_posto_risco;
CREATE POLICY prod_categoria_produto_rw ON public.prod_categoria_produto FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY prod_posto_pessoa_rw ON public.prod_posto_pessoa FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY prod_posto_epi_rw ON public.prod_posto_epi FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY prod_posto_risco_rw ON public.prod_posto_risco FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ------------------------------------------------------------
-- 3.1 fn_prod_fluxo_completo · tudo que a tela precisa numa chamada: o fluxo e o CONTEXTO
--   (setor + unidade de entrada + vinculos), os postos do setor com o quadro vigente e os nomes,
--   as sugestoes de horario do ponto (plant-wide) e as listas dos selects. Guard de tenant.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_completo(p_fluxo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_plant uuid; v_setor uuid; v_fluxo jsonb; v_postos jsonb;
        v_cargos jsonb; v_unidades jsonb; v_tipos jsonb; v_categorias jsonb; v_turnos jsonb;
        v_sugeridos jsonb; v_contexto jsonb;
BEGIN
  SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_fluxo WHERE id = p_fluxo_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'fluxo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_build_object('id', f.id, 'nome', f.nome, 'modo', f.modo, 'setor_id', f.setor_id,
    'setor_nome', s.nome, 'unidade_entrada_id', f.unidade_entrada_id, 'unidade_entrada_codigo', u.codigo)
    INTO v_fluxo FROM prod_fluxo f LEFT JOIN prod_setor s ON s.id=f.setor_id
    LEFT JOIN prod_unidade_medida u ON u.id=f.unidade_entrada_id WHERE f.id = p_fluxo_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'ordem_linha')::int, x->>'numero'), '[]'::jsonb) INTO v_postos FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'ordem_linha', p.ordem_linha, 'atividade', p.atividade,
      'cargo_id', p.cargo_id, 'cargo_nome', cg.nome,
      'unidade_medida_id', p.unidade_medida_id, 'unidade_codigo', um.codigo,
      'tipo_posto_id', p.tipo_posto_id, 'tipo_nome', tp.nome,
      'categoria_produto_id', p.categoria_produto_id, 'categoria_nome', cp.nome,
      'indicador_id', p.indicador_id,
      'capacidade_hora', p.capacidade_hora, 'capacidade_origem', p.capacidade_origem,
      'alocacao', p.alocacao, 'centro_custo', p.centro_custo, 'supervisor_nome', p.supervisor_nome,
      'quadro', (SELECT jsonb_build_object('id', pt.id, 'turno_id', pt.turno_id, 'hora_entrada', pt.hora_entrada,
                   'hora_saida', pt.hora_saida, 'pessoas', pt.pessoas, 'vigencia_inicio', pt.vigencia_inicio)
                 FROM prod_posto_turno pt WHERE pt.posto_id = p.id AND pt.vigencia_fim IS NULL
                 ORDER BY pt.vigencia_inicio DESC LIMIT 1)
    ) AS x
    FROM prod_posto p
    LEFT JOIN prod_cargo cg ON cg.id=p.cargo_id
    LEFT JOIN prod_unidade_medida um ON um.id=p.unidade_medida_id
    LEFT JOIN prod_tipo_posto tp ON tp.id=p.tipo_posto_id
    LEFT JOIN prod_categoria_produto cp ON cp.id=p.categoria_produto_id
    WHERE p.company_id=v_comp AND p.plant_id=v_plant AND p.setor_id=v_setor AND p.ativo IS NOT FALSE
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome),'[]'::jsonb) INTO v_cargos
    FROM prod_cargo WHERE company_id=v_comp AND plant_id=v_plant;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome) ORDER BY codigo),'[]'::jsonb) INTO v_unidades
    FROM prod_unidade_medida WHERE company_id=v_comp AND plant_id=v_plant;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome) ORDER BY codigo),'[]'::jsonb) INTO v_tipos
    FROM prod_tipo_posto WHERE company_id=v_comp AND plant_id=v_plant;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY ordem, nome),'[]'::jsonb) INTO v_categorias
    FROM prod_categoria_produto WHERE company_id=v_comp AND plant_id=v_plant AND ativo;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome,'inicio',inicio,'fim',fim) ORDER BY codigo),'[]'::jsonb) INTO v_turnos
    FROM ind_turnos WHERE company_id=v_comp AND plant_id=v_plant AND ativo IS NOT FALSE;

  -- horarios do ponto (plant-wide: jornada individual, nao por setor — e o que a funcao entrega)
  v_sugeridos := (fn_prod_horarios_frequentes_ponto(v_comp, v_plant))->'itens';

  SELECT jsonb_build_object(
    'ponto', (SELECT count(*) FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id WHERE sv.setor_id=v_setor AND f.tipo='ponto'),
    'producao', (SELECT coalesce(jsonb_agg(DISTINCT sv.chave),'[]'::jsonb) FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id WHERE sv.setor_id=v_setor AND f.tipo='producao')
  ) INTO v_contexto;

  RETURN jsonb_build_object('ok', true, 'fluxo', v_fluxo, 'postos', v_postos, 'contexto', v_contexto,
    'sugestoes_turno', coalesce(v_sugeridos,'[]'::jsonb),
    'listas', jsonb_build_object('cargos', v_cargos, 'unidades', v_unidades, 'tipos', v_tipos, 'categorias', v_categorias, 'turnos', v_turnos));
END $function$;

-- ------------------------------------------------------------
-- 3.2 fn_prod_posto_salvar · uma linha da tabela = uma chamada. Upsert do posto + o quadro de
--   turno na MESMA chamada (antes eram dois passos). Numero automatico pela ordem da linha no
--   setor. Horario aceito do ponto SEM turno_id: materializa/reusa um turno da planta com esse
--   horario (prod_posto_turno.turno_id e NOT NULL). Capacidade em branco = a medir (nunca zero).
--   Numero duplicado devolve erro tratado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_posto_salvar(p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id','')::uuid;
  v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
  v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid;
  v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
  v_atividade text := btrim(coalesce(p_dados->>'atividade',''));
  v_numero text := NULLIF(btrim(coalesce(p_dados->>'numero','')),'');
  v_ordem int;
  v_cap numeric := NULLIF(p_dados->>'capacidade_hora','')::numeric;
  v_criou boolean := false;
  v_turno jsonb := p_dados->'turno';
  v_tid uuid; v_vig date; v_he time; v_hs time; v_pes numeric;
BEGIN
  IF v_id IS NULL THEN
    IF v_comp IS NULL OR v_plant IS NULL OR v_setor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
  ELSE
    SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_posto WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
    v_setor := coalesce(NULLIF(p_dados->>'setor_id','')::uuid, v_setor);
  END IF;

  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_atividade = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'atividade_obrigatoria'); END IF;

  BEGIN
    IF v_id IS NULL THEN
      SELECT coalesce(max(ordem_linha),0) + 1 INTO v_ordem FROM prod_posto
       WHERE company_id=v_comp AND plant_id=v_plant AND setor_id=v_setor;
      v_numero := coalesce(v_numero, v_ordem::text);
      INSERT INTO prod_posto (company_id, plant_id, setor_id, numero, atividade, cargo_id, tipo_posto_id,
        unidade_medida_id, capacidade_hora, capacidade_origem, alocacao, centro_custo, supervisor_nome,
        categoria_produto_id, indicador_id, ordem_linha, ativo)
      VALUES (v_comp, v_plant, v_setor, v_numero, v_atividade,
        NULLIF(p_dados->>'cargo_id','')::uuid, NULLIF(p_dados->>'tipo_posto_id','')::uuid,
        NULLIF(p_dados->>'unidade_medida_id','')::uuid, v_cap,
        CASE WHEN v_cap IS NOT NULL THEN 'medida' ELSE NULL END,
        coalesce(NULLIF(p_dados->>'alocacao',''),'fixa'),
        NULLIF(p_dados->>'centro_custo',''), NULLIF(p_dados->>'supervisor_nome',''),
        NULLIF(p_dados->>'categoria_produto_id','')::uuid, NULLIF(p_dados->>'indicador_id','')::uuid,
        v_ordem, true)
      RETURNING id INTO v_id;
      v_criou := true;
    ELSE
      UPDATE prod_posto SET
        setor_id = v_setor,
        numero = coalesce(v_numero, numero),
        atividade = v_atividade,
        cargo_id = NULLIF(p_dados->>'cargo_id','')::uuid,
        tipo_posto_id = NULLIF(p_dados->>'tipo_posto_id','')::uuid,
        unidade_medida_id = NULLIF(p_dados->>'unidade_medida_id','')::uuid,
        capacidade_hora = v_cap,
        capacidade_origem = CASE WHEN v_cap IS NOT NULL THEN coalesce(capacidade_origem,'medida') ELSE NULL END,
        alocacao = coalesce(NULLIF(p_dados->>'alocacao',''), alocacao),
        centro_custo = NULLIF(p_dados->>'centro_custo',''),
        supervisor_nome = NULLIF(p_dados->>'supervisor_nome',''),
        categoria_produto_id = NULLIF(p_dados->>'categoria_produto_id','')::uuid,
        indicador_id = NULLIF(p_dados->>'indicador_id','')::uuid,
        updated_at = now()
      WHERE id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'numero_duplicado', 'numero', v_numero);
  END;

  IF v_turno IS NOT NULL AND jsonb_typeof(v_turno) = 'object' THEN
    v_tid := NULLIF(v_turno->>'turno_id','')::uuid;
    v_vig := coalesce(NULLIF(v_turno->>'vigencia_inicio','')::date, CURRENT_DATE);
    v_he := NULLIF(v_turno->>'hora_entrada','')::time;
    v_hs := NULLIF(v_turno->>'hora_saida','')::time;
    v_pes := NULLIF(v_turno->>'pessoas','')::numeric;
    -- Turno aceito do ponto (sem turno_id): materializa/reusa um turno da planta com esse horario.
    IF v_tid IS NULL AND v_he IS NOT NULL THEN
      SELECT id INTO v_tid FROM ind_turnos
       WHERE company_id = v_comp AND plant_id = v_plant AND ativo IS NOT FALSE
         AND inicio IS NOT DISTINCT FROM v_he AND fim IS NOT DISTINCT FROM v_hs
       ORDER BY created_at LIMIT 1;
      IF v_tid IS NULL THEN
        INSERT INTO ind_turnos (company_id, plant_id, codigo, nome, inicio, fim, ativo)
        VALUES (v_comp, v_plant, 'T'||to_char(v_he,'HH24MI'),
                to_char(v_he,'HH24:MI') || coalesce('-'||to_char(v_hs,'HH24:MI'),''), v_he, v_hs, true)
        RETURNING id INTO v_tid;
      END IF;
    END IF;
    IF v_tid IS NOT NULL THEN
      UPDATE prod_posto_turno SET vigencia_fim = v_vig - 1
        WHERE posto_id = v_id AND turno_id = v_tid AND vigencia_fim IS NULL AND vigencia_inicio < v_vig;
      INSERT INTO prod_posto_turno (company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
      VALUES (v_comp, v_plant, v_id, v_tid, v_he, v_hs, v_pes, v_vig)
      ON CONFLICT (posto_id, turno_id, vigencia_inicio) DO UPDATE
        SET hora_entrada = EXCLUDED.hora_entrada, hora_saida = EXCLUDED.hora_saida, pessoas = EXCLUDED.pessoas;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id,
    'numero', (SELECT numero FROM prod_posto WHERE id = v_id), 'criou', v_criou);
END $function$;

-- ------------------------------------------------------------
-- 3.3 fn_prod_posto_excluir · nunca apaga em silencio. Sem p_confirmar, devolve o que sera
--   afetado (quadros, etapas de fluxo, alocacoes, EPI, risco) pra tela mostrar antes (RD-55).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_posto_excluir(p_posto_id uuid, p_confirmar boolean, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_afeta jsonb;
BEGIN
  SELECT company_id INTO v_comp FROM prod_posto WHERE id = p_posto_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_build_object(
    'quadros',      (SELECT count(*) FROM prod_posto_turno  WHERE posto_id = p_posto_id),
    'etapas_fluxo', (SELECT count(*) FROM prod_fluxo_etapa  WHERE posto_id = p_posto_id),
    'pessoas',      (SELECT count(*) FROM prod_posto_pessoa WHERE posto_id = p_posto_id),
    'epis',         (SELECT count(*) FROM prod_posto_epi    WHERE posto_id = p_posto_id),
    'riscos',       (SELECT count(*) FROM prod_posto_risco  WHERE posto_id = p_posto_id)
  ) INTO v_afeta;

  IF NOT coalesce(p_confirmar, false) THEN
    RETURN jsonb_build_object('ok', true, 'precisa_confirmar', true, 'afeta', v_afeta);
  END IF;

  DELETE FROM prod_fluxo_etapa WHERE posto_id = p_posto_id;
  DELETE FROM prod_posto_turno WHERE posto_id = p_posto_id;
  DELETE FROM prod_posto WHERE id = p_posto_id;  -- pessoa/epi/risco caem por ON DELETE CASCADE
  RETURN jsonb_build_object('ok', true, 'excluido', true, 'afetou', v_afeta);
END $function$;

-- ------------------------------------------------------------
-- 3.4 fn_prod_prontidao · responde "onde vou ver o resultado?". Diz o que FALTA para o painel
--   ligar, e o que JA TEM (sem inventar). pronto_para_medir = tem posto, quadro e vinculo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_prontidao(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_postos int; v_quadros int; v_svinc int; v_dias int; v_fluxos int;
        v_vponto int; v_prod jsonb; v_falta text[] := '{}';
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT count(*) INTO v_postos FROM prod_posto
   WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE;
  SELECT count(*) INTO v_quadros FROM prod_posto_turno pt JOIN prod_posto p ON p.id=pt.posto_id
   WHERE p.company_id=p_company_id AND p.plant_id=p_plant_id AND pt.vigencia_fim IS NULL;
  SELECT count(DISTINCT setor_id) INTO v_svinc FROM prod_setor_vinculo
   WHERE company_id=p_company_id AND plant_id=p_plant_id;
  SELECT count(*) INTO v_fluxos FROM prod_fluxo WHERE company_id=p_company_id AND plant_id=p_plant_id;
  SELECT count(*) INTO v_dias FROM ind_ponto_marcacao WHERE company_id=p_company_id AND plant_id=p_plant_id;
  SELECT count(*) INTO v_vponto FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id
   WHERE sv.company_id=p_company_id AND sv.plant_id=p_plant_id AND f.tipo='ponto';
  SELECT coalesce(jsonb_agg(DISTINCT sv.chave), '[]'::jsonb) INTO v_prod
   FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id
   WHERE sv.company_id=p_company_id AND sv.plant_id=p_plant_id AND f.tipo='producao';

  IF v_postos  = 0 THEN v_falta := array_append(v_falta, 'nenhum posto cadastrado'); END IF;
  IF v_quadros = 0 THEN v_falta := array_append(v_falta, 'nenhum posto tem quadro de turno'); END IF;
  IF v_svinc   = 0 THEN v_falta := array_append(v_falta, 'nenhum setor vinculado a uma base (ponto ou producao)'); END IF;

  RETURN jsonb_build_object('ok', true,
    'pronto_para_medir', (v_postos > 0 AND v_quadros > 0 AND v_svinc > 0),
    'falta', v_falta,
    'tem', jsonb_build_object('setores_com_vinculo', v_svinc, 'postos', v_postos, 'quadros', v_quadros,
       'dias_com_ponto', v_dias, 'vinculos_ponto', v_vponto, 'producao_chaves', v_prod, 'fluxos', v_fluxos));
END $function$;

-- ============================================================
-- 2-bis · Salario base — da folha primeiro, manual so onde faltar (decisao do CEO 08/09).
--   Remuneracao paga (folha_competencia.remuneracao) != salario base: o valor pago oscila com HE,
--   faltas, adicionais e rescisao. Por isso a folha SUGERE, o humano CONFIRMA, e a variacao entre
--   competencias vira aviso. A fonte SEMPRE aparece na tela junto do valor (RD-51).
--   O elo folha<->funcionario e a MATRICULA (o CPF nao bate: 0 matches em ago/2026; matricula: 154).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prod_salario_base (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id       uuid REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.compliance_funcionarios(id) ON DELETE CASCADE,
  cargo_id       uuid REFERENCES public.prod_cargo(id) ON DELETE CASCADE,
  matricula      integer,
  cpf            text,
  valor          numeric NOT NULL,
  fonte          text NOT NULL,          -- folha | manual | acordo_coletivo
  competencia_ref date,                  -- de qual competencia veio, quando fonte='folha'
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim   date,
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  CONSTRAINT prod_salario_fonte_chk CHECK (fonte IN ('folha','manual','acordo_coletivo')),
  CONSTRAINT prod_salario_alvo_chk CHECK ((funcionario_id IS NOT NULL) OR (cargo_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_prod_salario_vigente
  ON public.prod_salario_base (company_id) WHERE vigencia_fim IS NULL;
COMMENT ON TABLE public.prod_salario_base IS
  'Salario base por pessoa OU por cargo, com vigencia e fonte declarada. '
  'Por cargo serve para estimar custo antes de haver alocacao nominal.';
COMMENT ON COLUMN public.prod_salario_base.fonte IS
  'folha = veio de folha_competencia · manual = digitado · acordo_coletivo = piso da categoria. '
  'A fonte SEMPRE aparece na tela junto do valor (RD-51).';
ALTER TABLE public.prod_salario_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_salario_base_rw ON public.prod_salario_base;
CREATE POLICY prod_salario_base_rw ON public.prod_salario_base FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- fn_prod_salario_sugerir_da_folha · NAO grava. Por pessoa, a remuneracao das ultimas 3
--   competencias <= p_competencia e a variacao entre elas, para o RH decidir. Variacao > 10% =
--   aviso (sinal de HE/adicional/rescisao no pago — nao e o base). Importar 172 remuneracoes como
--   salario base seria inventar o numero de 172 pessoas de uma vez.
CREATE OR REPLACE FUNCTION public.fn_prod_salario_sugerir_da_folha(p_company_id uuid, p_competencia date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH base AS (
    SELECT matricula, nome, cpf, competencia, remuneracao,
           row_number() OVER (PARTITION BY matricula ORDER BY competencia DESC) AS rn
      FROM folha_competencia
     WHERE company_id = p_company_id AND competencia <= p_competencia AND matricula IS NOT NULL
       -- so quem esta PRESENTE na competencia de referencia (equipe atual, nao quem ja saiu);
       -- o sugerido passa a ser sempre o mes de referencia, nao um mes antigo de ex-funcionario.
       AND matricula IN (SELECT matricula FROM folha_competencia
                          WHERE company_id = p_company_id AND competencia = p_competencia AND matricula IS NOT NULL)
  ), ult3 AS (SELECT * FROM base WHERE rn <= 3),
  agg AS (
    SELECT matricula,
           max(nome) FILTER (WHERE rn = 1) AS nome,
           max(cpf)  FILTER (WHERE rn = 1) AS cpf,
           max(remuneracao) FILTER (WHERE rn = 1) AS sugerido,
           min(remuneracao) AS rmin, max(remuneracao) AS rmax,
           jsonb_agg(jsonb_build_object('competencia', competencia, 'remuneracao', remuneracao) ORDER BY competencia DESC) AS comps
      FROM ult3 GROUP BY matricula
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'matricula', matricula, 'nome', nome, 'cpf', cpf, 'sugerido', sugerido, 'competencias', comps,
      'variacao_pct', CASE WHEN rmin > 0 THEN round(100.0 * (rmax - rmin) / rmin) ELSE NULL END,
      'aviso', (rmin > 0 AND (rmax - rmin) / rmin > 0.10)
    ) ORDER BY nome), '[]'::jsonb) INTO v FROM agg;
  RETURN jsonb_build_object('ok', true, 'competencia_ref', p_competencia, 'total', jsonb_array_length(v), 'itens', v);
END $function$;

-- fn_prod_salario_salvar · grava o salario base DEPOIS que o humano confirma (a folha nunca grava
--   sozinha). Resolve funcionario_id pela MATRICULA (o elo real); aceita funcionario_id/cargo_id
--   explicitos. Sem alvo (nem funcionario nem cargo) => erro tratado. Fecha a vigencia anterior do
--   mesmo alvo e abre a nova. A fonte fica registrada com o valor.
CREATE OR REPLACE FUNCTION public.fn_prod_salario_salvar(p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid; v_func uuid := NULLIF(p_dados->>'funcionario_id','')::uuid;
  v_cargo uuid := NULLIF(p_dados->>'cargo_id','')::uuid; v_mat text := NULLIF(btrim(coalesce(p_dados->>'matricula','')),'');
  v_valor numeric := NULLIF(p_dados->>'valor','')::numeric; v_fonte text := coalesce(p_dados->>'fonte','manual'); v_id uuid;
BEGIN
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_obrigatoria'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido'); END IF;
  IF v_fonte NOT IN ('folha','manual','acordo_coletivo') THEN RETURN jsonb_build_object('ok', false, 'erro', 'fonte_invalida'); END IF;

  -- resolve funcionario pela matricula quando nao veio explicito
  IF v_func IS NULL AND v_mat IS NOT NULL THEN
    SELECT id INTO v_func FROM compliance_funcionarios WHERE company_id = v_comp AND matricula = v_mat LIMIT 1;
  END IF;
  IF v_func IS NULL AND v_cargo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_alvo'); END IF;  -- sem funcionario nem cargo, o CHECK barraria

  -- fecha a vigencia anterior aberta do mesmo alvo (pessoa ou cargo)
  UPDATE prod_salario_base SET vigencia_fim = CURRENT_DATE - 1
   WHERE company_id = v_comp AND vigencia_fim IS NULL
     AND ((v_func IS NOT NULL AND funcionario_id = v_func) OR (v_func IS NULL AND cargo_id = v_cargo));

  INSERT INTO prod_salario_base (company_id, plant_id, funcionario_id, cargo_id, matricula, cpf, valor, fonte, competencia_ref, criado_por)
  VALUES (v_comp, NULLIF(p_dados->>'plant_id','')::uuid, v_func, CASE WHEN v_func IS NULL THEN v_cargo ELSE NULL END,
          NULLIF(p_dados->>'matricula','')::int, NULLIF(p_dados->>'cpf',''), v_valor, v_fonte,
          NULLIF(p_dados->>'competencia_ref','')::date, p_user)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'alvo', CASE WHEN v_func IS NOT NULL THEN 'funcionario' ELSE 'cargo' END);
END $function$;
