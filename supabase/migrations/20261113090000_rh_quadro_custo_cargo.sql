-- PR-A (CEO 11/11, Frioeste) — QUADRO DE PESSOAL + CUSTO POR CARGO/SETOR/SUPERVISOR + R$/h do CARGO.
-- Regra do CEO: custo/hora do CARGO = média de TODAS as pessoas do cargo (custo mensal com encargos ÷ horas/mês).
-- ADITIVA (RD-26/RD-54): só CREATE de tabela/função/índice + seeds de catálogo/ajuda. Nada destrutivo.
-- LGPD: salário/custo e CPF só para RH/diretoria/admin; grupo < 3 pessoas agrega em "Apoio (<3 pessoas)";
--       papel desconhecido = agregado (fail-closed). Reusa o padrão de fn_rh_quadro_lotacao (user_companies.role).
-- Reusa (RD-26): folha_competencia, ind_ponto_colaborador, prod_cargo, prod_setor, prod_cargo_vinculo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) PARÂMETROS DE CUSTO POR EMPRESA
CREATE TABLE IF NOT EXISTS public.rh_parametro_custo (
  company_id    uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  encargos_pct  numeric NOT NULL DEFAULT 38.35,
  horas_mes     numeric NOT NULL DEFAULT 220,
  fonte_custo   text    NOT NULL DEFAULT 'folha_total'
                CHECK (fonte_custo IN ('folha_total','salario_mais_encargos')),
  competencia_ref date,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rh_parametro_custo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_parametro_custo_rls ON public.rh_parametro_custo;
CREATE POLICY rh_parametro_custo_rls ON public.rh_parametro_custo
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.rh_parametro_custo FROM PUBLIC, anon;
GRANT SELECT ON public.rh_parametro_custo TO authenticated;

-- 2) COMPLEMENTO DE RH POR PESSOA (cargo/setor/supervisor/salário) — soft delete + audit (RD-98)
CREATE TABLE IF NOT EXISTS public.rh_pessoa_complemento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  cargo_id      uuid REFERENCES public.prod_cargo(id),
  setor_id      uuid REFERENCES public.prod_setor(id),
  supervisor_nome text,
  salario_base  numeric,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  excluido_em   timestamptz,
  excluido_por  uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS rh_pessoa_complemento_cpf_uni
  ON public.rh_pessoa_complemento (company_id, cpf) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS rh_pessoa_complemento_company_idx
  ON public.rh_pessoa_complemento (company_id) WHERE excluido_em IS NULL;
ALTER TABLE public.rh_pessoa_complemento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_pessoa_complemento_rls ON public.rh_pessoa_complemento;
CREATE POLICY rh_pessoa_complemento_rls ON public.rh_pessoa_complemento
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.rh_pessoa_complemento FROM PUBLIC, anon;
GRANT SELECT ON public.rh_pessoa_complemento TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: quem pode ver salário/custo/CPF (RH industrial, sócio, admin). Fail-closed.
CREATE OR REPLACE FUNCTION public.fn__rh_pode_custo(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
       AND uc.role IN ('rh_industrial','socio'));
$fn$;
REVOKE ALL ON FUNCTION public.fn__rh_pode_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__rh_pode_custo(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) BASE DO QUADRO (fonte única; 1 linha por CPF). Interna: só service_role; os wrappers aplicam máscara/LGPD.
--    custo_mensal: folha_total = total_geral da folha (já com encargos); salario_mais_encargos = salário×(1+enc).
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_base(p_company_id uuid, p_competencia date DEFAULT NULL)
RETURNS TABLE(
  cpf text, matricula text, nome text, funcao text,
  cargo_id uuid, cargo_nome text, setor_id uuid, setor_nome text, supervisor text,
  salario numeric, custo_mensal numeric, custo_hora numeric, origem text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_enc numeric; v_horas numeric; v_fonte text; v_comp date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;

  SELECT COALESCE(pc.encargos_pct,38.35), COALESCE(pc.horas_mes,220), COALESCE(pc.fonte_custo,'folha_total')
    INTO v_enc, v_horas, v_fonte
    FROM (SELECT 1) z LEFT JOIN rh_parametro_custo pc ON pc.company_id = p_company_id;
  v_enc := COALESCE(v_enc,38.35); v_horas := COALESCE(v_horas,220); v_fonte := COALESCE(v_fonte,'folha_total');

  v_comp := COALESCE(p_competencia, (SELECT max(f.competencia) FROM folha_competencia f WHERE f.company_id = p_company_id));

  RETURN QUERY
  WITH cpfs AS (
    SELECT DISTINCT c.cpf FROM (
      SELECT cpf FROM ind_ponto_colaborador WHERE company_id = p_company_id AND cpf IS NOT NULL
      UNION SELECT cpf FROM folha_competencia WHERE company_id = p_company_id AND competencia = v_comp AND cpf IS NOT NULL
      UNION SELECT cpf FROM rh_pessoa_complemento WHERE company_id = p_company_id AND excluido_em IS NULL AND cpf IS NOT NULL
    ) c
  ),
  pto AS (
    SELECT DISTINCT ON (cpf) cpf, matricula, nome, funcao, departamento
    FROM ind_ponto_colaborador WHERE company_id = p_company_id AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ),
  fol AS (
    SELECT cpf, max(nome) AS nome, max(matricula) AS matricula,
           sum(total_geral) AS total_geral, sum(remuneracao) AS remuneracao
    FROM folha_competencia WHERE company_id = p_company_id AND competencia = v_comp AND cpf IS NOT NULL
    GROUP BY cpf
  )
  SELECT
    k.cpf,
    COALESCE(pt.matricula, fo.matricula) AS matricula,
    COALESCE(pt.nome, fo.nome) AS nome,
    pt.funcao,
    COALESCE(cp.cargo_id, vc.cargo_id) AS cargo_id,
    cg.nome AS cargo_nome,
    cp.setor_id,
    COALESCE(st.nome, pt.departamento) AS setor_nome,
    cp.supervisor_nome AS supervisor,
    sal.salario,
    CASE WHEN v_fonte = 'folha_total'
         THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0))
         ELSE sal.salario * (1 + v_enc/100.0) END AS custo_mensal,
    (CASE WHEN v_fonte = 'folha_total'
          THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0))
          ELSE sal.salario * (1 + v_enc/100.0) END) / NULLIF(v_horas,0) AS custo_hora,
    CASE WHEN pt.cpf IS NOT NULL AND fo.cpf IS NOT NULL THEN 'ponto_folha'
         WHEN pt.cpf IS NOT NULL THEN 'so_ponto' ELSE 'so_folha' END AS origem
  FROM cpfs k
  LEFT JOIN pto pt ON pt.cpf = k.cpf
  LEFT JOIN fol fo ON fo.cpf = k.cpf
  LEFT JOIN rh_pessoa_complemento cp ON cp.company_id = p_company_id AND cp.cpf = k.cpf AND cp.excluido_em IS NULL
  LEFT JOIN prod_cargo_vinculo vc ON upper(vc.chave) = upper(pt.funcao) AND vc.company_id = p_company_id
  LEFT JOIN prod_cargo cg ON cg.id = COALESCE(cp.cargo_id, vc.cargo_id)
  LEFT JOIN prod_setor st ON st.id = cp.setor_id
  CROSS JOIN LATERAL (SELECT COALESCE(cp.salario_base, fo.remuneracao) AS salario) sal;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_quadro_base(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_base(uuid, date) TO service_role;

-- 3b) QUADRO para a tela (jsonb; CPF mascarado e salário/custo nulos para quem não pode).
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_pessoas(p_company_id uuid, p_competencia date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_pode boolean; v_comp date; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_pode := fn__rh_pode_custo(p_company_id);
  v_comp := COALESCE(p_competencia, (SELECT max(f.competencia) FROM folha_competencia f WHERE f.company_id = p_company_id));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cpf', CASE WHEN v_pode THEN b.cpf
                  ELSE regexp_replace(COALESCE(b.cpf,''), '^(\d{3})\d{5}(\d{2}).*$', '\1*****\2') END,
      'matricula', b.matricula, 'nome', b.nome, 'funcao', b.funcao,
      'cargo_id', b.cargo_id, 'cargo', b.cargo_nome,
      'setor_id', b.setor_id, 'setor', b.setor_nome, 'supervisor', b.supervisor,
      'salario', CASE WHEN v_pode THEN b.salario ELSE NULL END,
      'custo_mensal', CASE WHEN v_pode THEN b.custo_mensal ELSE NULL END,
      'custo_hora', CASE WHEN v_pode THEN b.custo_hora ELSE NULL END,
      'origem', b.origem
    ) ORDER BY b.nome), '[]'::jsonb) INTO v_lista
  FROM fn_rh_quadro_base(p_company_id, v_comp) b;

  RETURN jsonb_build_object('ok', true, 'pode_custo', v_pode, 'competencia', v_comp, 'pessoas', v_lista);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_quadro_pessoas(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_pessoas(uuid, date) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) SALVAR complemento de 1 pessoa e em LOTE (colar da planilha). Devolve rejeitadas com motivo (RD-74/77).
CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_salvar(p_company_id uuid, p_cpf text, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_cpf text; v_id uuid; v_cargo uuid; v_setor uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;
  v_cpf := regexp_replace(COALESCE(p_cpf,''), '\D', '', 'g');
  IF length(v_cpf) <> 11 THEN RETURN jsonb_build_object('ok', false, 'erro', 'cpf_invalido'); END IF;
  v_cargo := NULLIF(p_dados->>'cargo_id','')::uuid;
  v_setor := NULLIF(p_dados->>'setor_id','')::uuid;

  INSERT INTO rh_pessoa_complemento (company_id, cpf, cargo_id, setor_id, supervisor_nome, salario_base, observacao, criado_por, atualizado_por)
  VALUES (p_company_id, v_cpf, v_cargo, v_setor,
          NULLIF(p_dados->>'supervisor_nome',''), NULLIF(p_dados->>'salario_base','')::numeric,
          NULLIF(p_dados->>'observacao',''), auth.uid(), auth.uid())
  ON CONFLICT (company_id, cpf) WHERE excluido_em IS NULL
  DO UPDATE SET
      cargo_id = COALESCE(EXCLUDED.cargo_id, rh_pessoa_complemento.cargo_id),
      setor_id = COALESCE(EXCLUDED.setor_id, rh_pessoa_complemento.setor_id),
      supervisor_nome = COALESCE(EXCLUDED.supervisor_nome, rh_pessoa_complemento.supervisor_nome),
      salario_base = COALESCE(EXCLUDED.salario_base, rh_pessoa_complemento.salario_base),
      observacao = COALESCE(EXCLUDED.observacao, rh_pessoa_complemento.observacao),
      atualizado_em = now(), atualizado_por = auth.uid()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cpf', v_cpf);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_pessoa_complemento_salvar(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_pessoa_complemento_salvar(uuid, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_lote(p_company_id uuid, p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l jsonb; v_res jsonb; v_ok int := 0; v_rej jsonb := '[]'::jsonb;
        v_dados jsonb; v_cargo uuid; v_setor uuid; v_motivo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas,'[]'::jsonb)) LOOP
    v_motivo := NULL; v_cargo := NULL; v_setor := NULL;
    -- cargo/setor podem vir por NOME (colar da planilha) ou por id; resolve o nome e rejeita se não casar.
    IF NULLIF(l->>'cargo_id','') IS NOT NULL THEN v_cargo := (l->>'cargo_id')::uuid;
    ELSIF NULLIF(l->>'cargo_nome','') IS NOT NULL THEN
      SELECT id INTO v_cargo FROM prod_cargo WHERE company_id = p_company_id AND lower(nome) = lower(l->>'cargo_nome') AND ativo LIMIT 1;
      IF v_cargo IS NULL THEN v_motivo := 'cargo não encontrado: ' || (l->>'cargo_nome'); END IF;
    END IF;
    IF v_motivo IS NULL AND NULLIF(l->>'setor_id','') IS NOT NULL THEN v_setor := (l->>'setor_id')::uuid;
    ELSIF v_motivo IS NULL AND NULLIF(l->>'setor_nome','') IS NOT NULL THEN
      SELECT id INTO v_setor FROM prod_setor WHERE company_id = p_company_id AND lower(nome) = lower(l->>'setor_nome') AND ativo LIMIT 1;
      IF v_setor IS NULL THEN v_motivo := 'setor não encontrado: ' || (l->>'setor_nome'); END IF;
    END IF;
    IF v_motivo IS NOT NULL THEN
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('linha', l, 'motivo', v_motivo)); CONTINUE;
    END IF;
    v_dados := jsonb_strip_nulls(jsonb_build_object(
      'cargo_id', v_cargo, 'setor_id', v_setor,
      'supervisor_nome', NULLIF(l->>'supervisor_nome',''),
      'salario_base', NULLIF(l->>'salario_base',''),
      'observacao', NULLIF(l->>'observacao','')));
    v_res := fn_rh_pessoa_complemento_salvar(p_company_id, l->>'cpf', v_dados);
    IF (v_res->>'ok')::boolean THEN v_ok := v_ok + 1;
    ELSE v_rej := v_rej || jsonb_build_array(jsonb_build_object('linha', l, 'motivo', v_res->>'erro')); END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'gravadas', v_ok, 'rejeitadas', v_rej);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_pessoa_complemento_lote(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_pessoa_complemento_lote(uuid, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CUSTO POR cargo/setor/supervisor (LGPD: grupo <3 agrega p/ quem não é RH; fail-closed).
CREATE OR REPLACE FUNCTION public.fn_rh_custo_por(p_company_id uuid, p_agrupar text, p_competencia date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_pode boolean; v_horas numeric; v_grupos jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_agrupar NOT IN ('cargo','setor','supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agrupar_invalido'); END IF;
  v_pode := fn__rh_pode_custo(p_company_id);
  SELECT COALESCE(horas_mes,220) INTO v_horas FROM rh_parametro_custo WHERE company_id = p_company_id;
  v_horas := COALESCE(v_horas,220);

  WITH base AS (
    SELECT CASE p_agrupar
             WHEN 'cargo' THEN COALESCE(b.cargo_nome,'(sem cargo)')
             WHEN 'setor' THEN COALESCE(b.setor_nome,'(sem setor)')
             ELSE COALESCE(b.supervisor,'(sem supervisor)') END AS grupo,
           b.custo_mensal
    FROM fn_rh_quadro_base(p_company_id, p_competencia) b
  ),
  g1 AS (SELECT grupo, count(*) pessoas, sum(custo_mensal) custo_total FROM base GROUP BY grupo),
  g2 AS (  -- LGPD: quem não pode vê grupos <3 somados em "Apoio (<3 pessoas)"
    SELECT CASE WHEN v_pode OR pessoas >= 3 THEN grupo ELSE 'Apoio (menos de 3 pessoas)' END AS grupo,
           pessoas, custo_total FROM g1
  ),
  g3 AS (SELECT grupo, sum(pessoas) pessoas, sum(custo_total) custo_total FROM g2 GROUP BY grupo)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grupo', grupo, 'pessoas', pessoas,
    'custo_total', round(custo_total,2),
    'custo_medio', round(custo_total / NULLIF(pessoas,0), 2),
    'custo_hora_medio', round((custo_total / NULLIF(pessoas,0)) / NULLIF(v_horas,0), 2)
  ) ORDER BY custo_total DESC), '[]'::jsonb) INTO v_grupos FROM g3;

  RETURN jsonb_build_object('ok', true, 'agrupar', p_agrupar, 'pode_detalhe', v_pode, 'horas_mes', v_horas, 'grupos', v_grupos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_custo_por(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_custo_por(uuid, text, date) TO authenticated, service_role;

-- 6) R$/h médio do CARGO (contrato único que a produtividade/posto vai consumir — PR-B).
CREATE OR REPLACE FUNCTION public.fn_rh_custo_hora_cargo(p_company_id uuid, p_cargo_id uuid, p_ref date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_horas numeric; v_custo_medio numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN NULL; END IF;
  SELECT COALESCE(horas_mes,220) INTO v_horas FROM rh_parametro_custo WHERE company_id = p_company_id;
  v_horas := COALESCE(v_horas,220);
  SELECT avg(b.custo_mensal) INTO v_custo_medio
    FROM fn_rh_quadro_base(p_company_id, p_ref) b
   WHERE b.cargo_id = p_cargo_id AND b.custo_mensal IS NOT NULL;
  RETURN round(COALESCE(v_custo_medio,0) / NULLIF(v_horas,0), 2);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_custo_hora_cargo(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_custo_hora_cargo(uuid, uuid, date) TO authenticated, service_role;

-- 7) SALVAR parâmetros de custo (encargos, horas, fonte, competência) — RH/diretoria/admin.
CREATE OR REPLACE FUNCTION public.fn_rh_parametro_custo_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;
  INSERT INTO rh_parametro_custo (company_id, encargos_pct, horas_mes, fonte_custo, competencia_ref, atualizado_por, atualizado_em)
  VALUES (p_company_id,
          COALESCE(NULLIF(p_dados->>'encargos_pct','')::numeric, 38.35),
          COALESCE(NULLIF(p_dados->>'horas_mes','')::numeric, 220),
          COALESCE(NULLIF(p_dados->>'fonte_custo',''), 'folha_total'),
          NULLIF(p_dados->>'competencia_ref','')::date, auth.uid(), now())
  ON CONFLICT (company_id) DO UPDATE SET
    encargos_pct = COALESCE(NULLIF(p_dados->>'encargos_pct','')::numeric, rh_parametro_custo.encargos_pct),
    horas_mes    = COALESCE(NULLIF(p_dados->>'horas_mes','')::numeric, rh_parametro_custo.horas_mes),
    fonte_custo  = COALESCE(NULLIF(p_dados->>'fonte_custo',''), rh_parametro_custo.fonte_custo),
    competencia_ref = COALESCE(NULLIF(p_dados->>'competencia_ref','')::date, rh_parametro_custo.competencia_ref),
    atualizado_por = auth.uid(), atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_rh_parametro_custo_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_parametro_custo_salvar(uuid, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) MENU / CATÁLOGO / TELA
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, descricao, is_shared)
VALUES ('industrial_rh_quadro', 'Quadro de pessoal', 'industrial', 'recursos_humanos',
        '/dashboard/industrial/rh/quadro', 5, true,
        'Quadro de pessoal da indústria: pessoa (CPF), cargo, setor, supervisor, salário e custo por cargo/setor/supervisor.',
        false)
ON CONFLICT (id) DO NOTHING;

-- Liga o módulo aos MESMOS planos do módulo irmão de RH (produtividade); há trigger que também liga. ON CONFLICT DO NOTHING.
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT pm.plan_id, 'industrial_rh_quadro', pm.is_default_active
FROM public.plan_modules pm
WHERE pm.module_id = 'produtividade'
ON CONFLICT DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real)
VALUES ('dashboard.industrial_rh_quadro', '/dashboard/industrial/rh/quadro', 'industrial', 'Quadro de pessoal',
        'Cadastro do quadro de pessoal e custo da folha por cargo, setor e supervisor; base do custo/hora do cargo.',
        'industrial_rh_quadro', 'pronto')
ON CONFLICT (id) DO NOTHING;

-- 9) AJUDA DE CAMPO (RD-95) — "?" de cada campo/coluna/ação da tela.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('rh.quadro.competencia', '/dashboard/industrial/rh/quadro', 'Quadro', 'Competência', 'O mês de referência da folha.', 'Define qual folha (custo) é usada no quadro e nos custos por cargo.', '10/2026', 'Escolher um mês sem folha importada mostra pessoas sem custo.', 'industrial', 1, 'publicado'),
 ('rh.quadro.encargos', '/dashboard/industrial/rh/quadro', 'Quadro', 'Encargos (%)', 'O percentual de encargos sobre o salário.', 'Quando o custo vem do salário, soma os encargos para chegar ao custo mensal.', '38,35', 'Deixar em branco usa o padrão 38,35%.', 'industrial', 2, 'publicado'),
 ('rh.quadro.horas_mes', '/dashboard/industrial/rh/quadro', 'Quadro', 'Horas/mês', 'As horas trabalhadas por mês.', 'Divide o custo mensal para chegar ao R$/h.', '220', 'Zero deixaria o R$/h sem valor.', 'industrial', 3, 'publicado'),
 ('rh.quadro.fonte_custo', '/dashboard/industrial/rh/quadro', 'Quadro', 'Fonte do custo', 'De onde vem o custo mensal.', 'Folha (total com encargos) ou salário + encargos.', 'Folha total', 'Sem folha no mês, cai no salário + encargos.', 'industrial', 4, 'publicado'),
 ('rh.quadro.cpf', '/dashboard/industrial/rh/quadro', 'Quadro', 'CPF', 'O CPF da pessoa (só números).', 'Liga a pessoa à folha e ao ponto; o nome vem do ponto.', '123.456.789-00', 'CPF com menos de 11 dígitos é recusado.', 'industrial', 5, 'publicado'),
 ('rh.quadro.cargo', '/dashboard/industrial/rh/quadro', 'Quadro', 'Cargo', 'O cargo da pessoa.', 'Agrupa o custo por cargo e dá o R$/h do cargo usado nos postos.', 'Eviscerador', 'Pessoa sem cargo não entra no custo por cargo.', 'industrial', 6, 'publicado'),
 ('rh.quadro.setor', '/dashboard/industrial/rh/quadro', 'Quadro', 'Setor', 'O setor da pessoa.', 'Agrupa o custo da folha por setor.', 'Abate', 'Sem setor, cai em "(sem setor)".', 'industrial', 7, 'publicado'),
 ('rh.quadro.supervisor', '/dashboard/industrial/rh/quadro', 'Quadro', 'Supervisor', 'O nome do supervisor responsável.', 'Agrupa o custo da folha por supervisor.', 'João da Silva', 'Nomes diferentes para a mesma pessoa viram grupos separados.', 'industrial', 8, 'publicado'),
 ('rh.quadro.salario', '/dashboard/industrial/rh/quadro', 'Quadro', 'Salário', 'O salário base, se não vier da folha.', 'Entra no custo quando a fonte é salário + encargos, ou quando não há folha.', '2.500,00', 'A folha não traz salário; informe aqui quando precisar.', 'industrial', 9, 'publicado'),
 ('rh.quadro.custo_mensal', '/dashboard/industrial/rh/quadro', 'Quadro', 'Custo mensal', 'Calculado — não se digita.', 'Custo da pessoa no mês (folha total, ou salário + encargos).', 'R$ 3.459,38', '', 'industrial', 10, 'publicado'),
 ('rh.quadro.custo_hora', '/dashboard/industrial/rh/quadro', 'Quadro', 'R$/h', 'Calculado — não se digita.', 'Custo mensal ÷ horas/mês; base do custo do posto e do produto.', 'R$ 15,72', '', 'industrial', 11, 'publicado'),
 ('rh.quadro.colar', '/dashboard/industrial/rh/quadro', 'Quadro', 'Colar da planilha', 'Cole linhas CPF;cargo;setor;supervisor;salário.', 'Cadastra várias pessoas de uma vez; as rejeitadas voltam com o motivo.', '12345678900;Eviscerador;Abate;João;2500', 'Colunas fora de ordem gravam no campo errado.', 'industrial', 12, 'publicado'),
 ('rh.quadro.ligar_cargos', '/dashboard/industrial/rh/quadro', 'Quadro', 'Ligar funções aos cargos', 'Liga a função do ponto a um cargo.', 'Pré-preenche o cargo das pessoas pela função do ponto.', 'EVISCERADOR → Eviscerador', '', 'industrial', 13, 'publicado'),
 ('rh.quadro.aba_cargo', '/dashboard/industrial/rh/quadro', 'Quadro', 'Por cargo', 'Aba de leitura.', 'Pessoas, custo total, custo médio e R$/h médio por cargo.', '', '', 'industrial', 14, 'publicado'),
 ('rh.quadro.aba_setor', '/dashboard/industrial/rh/quadro', 'Quadro', 'Por setor', 'Aba de leitura.', 'Pessoas, custo total, custo médio e R$/h médio por setor.', '', '', 'industrial', 15, 'publicado'),
 ('rh.quadro.aba_supervisor', '/dashboard/industrial/rh/quadro', 'Quadro', 'Por supervisor', 'Aba de leitura.', 'Pessoas, custo total, custo médio e R$/h médio por supervisor.', '', '', 'industrial', 16, 'publicado')
ON CONFLICT (chave) DO NOTHING;
