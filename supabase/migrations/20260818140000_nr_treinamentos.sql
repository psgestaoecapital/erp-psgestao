-- Compliance · Treinamentos NR (completo, genérico) — tipos + turmas + presença + certificados + alertas
--
-- Módulo NOVO (0 tabelas/0 RPCs antes; placeholder honesto EM CONSTRUÇÃO). Genérico como a Oficina:
-- serve qualquer empresa com NR (mecânica, construção, indústria) — NADA hardcoded por empresa.
-- Reusa (RD-26): compliance_funcionarios (funcionário), erp_alerta_proativo (alerta proativo, padrão EPI),
-- bucket Storage 'compliance' (certificados, via API route com service role — igual compliance_documentos).
-- Multi-tenant: company_id + RLS company_id IN (get_user_company_ids()). Pilar 1 (NR/SST) + Pilar 2 (RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Modelo de dados
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr_treinamento_tipo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nr_codigo text,                       -- NR-6, NR-10, NR-35… (livre; empresa cadastra o que usa)
  nome text NOT NULL,
  carga_horaria numeric,
  validade_meses integer,               -- ex.: NR-35 = 24; null = sem validade
  reciclagem_meses integer,
  obrigatorio boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nr_turma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo_id uuid NOT NULL REFERENCES public.nr_treinamento_tipo(id) ON DELETE RESTRICT,
  data_realizacao date,
  instrutor text,
  carga_horaria numeric,
  local text,
  status text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','realizada','cancelada')),
  observacao text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nr_turma_tipo ON public.nr_turma(company_id, tipo_id);

CREATE TABLE IF NOT EXISTS public.nr_turma_presenca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  turma_id uuid NOT NULL REFERENCES public.nr_turma(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.compliance_funcionarios(id) ON DELETE CASCADE,
  presente boolean NOT NULL DEFAULT true,
  aproveitamento numeric,               -- nota/aproveitamento opcional
  certificado_url text,                 -- path no bucket 'compliance' (signed URL gerada na API)
  data_emissao_certificado date,
  validade_ate date,                    -- data_realizacao + validade_meses (calculada)
  criado_em timestamptz DEFAULT now(),
  UNIQUE (turma_id, funcionario_id)
);
CREATE INDEX IF NOT EXISTS ix_nr_presenca_func ON public.nr_turma_presenca(company_id, funcionario_id);
CREATE INDEX IF NOT EXISTS ix_nr_presenca_venc ON public.nr_turma_presenca(company_id, validade_ate);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS (multi-tenant) — company_id IN (get_user_company_ids()) OR is_admin()
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nr_treinamento_tipo','nr_turma','nr_turma_presenca'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='p_'||t||'_tenant') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
        WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())$p$,
        'p_'||t||'_tenant', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $mig$;

-- helper: barra acesso fora do tenant (fail-closed) — reusado por todas as RPCs
CREATE OR REPLACE FUNCTION public.fn_nr_assert_acesso(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'sem_acesso' USING errcode = '42501';
  END IF;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Tipos de treinamento — incluir / editar / excluir / listar (pedido do CEO)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr_tipo_salvar(p_company_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := NULLIF(p_payload->>'id','')::uuid; r public.nr_treinamento_tipo;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  IF COALESCE(btrim(p_payload->>'nome'),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.nr_treinamento_tipo (company_id, nr_codigo, nome, carga_horaria, validade_meses, reciclagem_meses, obrigatorio, ativo)
    VALUES (p_company_id, NULLIF(btrim(p_payload->>'nr_codigo'),''), btrim(p_payload->>'nome'),
            NULLIF(p_payload->>'carga_horaria','')::numeric, NULLIF(p_payload->>'validade_meses','')::int,
            NULLIF(p_payload->>'reciclagem_meses','')::int, COALESCE((p_payload->>'obrigatorio')::boolean,false),
            COALESCE((p_payload->>'ativo')::boolean,true))
    RETURNING * INTO r;
  ELSE
    UPDATE public.nr_treinamento_tipo SET
      nr_codigo = NULLIF(btrim(p_payload->>'nr_codigo'),''), nome = btrim(p_payload->>'nome'),
      carga_horaria = NULLIF(p_payload->>'carga_horaria','')::numeric,
      validade_meses = NULLIF(p_payload->>'validade_meses','')::int,
      reciclagem_meses = NULLIF(p_payload->>'reciclagem_meses','')::int,
      obrigatorio = COALESCE((p_payload->>'obrigatorio')::boolean, obrigatorio),
      ativo = COALESCE((p_payload->>'ativo')::boolean, ativo), atualizado_em = now()
    WHERE id = v_id AND company_id = p_company_id
    RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'tipo_nao_encontrado'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_tipo_excluir(p_company_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_turmas int;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT count(*) INTO v_turmas FROM public.nr_turma WHERE tipo_id = p_id AND company_id = p_company_id;
  IF v_turmas > 0 THEN
    -- não apaga histórico de turmas: desativa (some da lista de cadastro, mas preserva o realizado)
    UPDATE public.nr_treinamento_tipo SET ativo = false, atualizado_em = now()
      WHERE id = p_id AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'tipo_nao_encontrado'; END IF;
    RETURN jsonb_build_object('ok', true, 'modo', 'desativado', 'motivo', 'ha_turmas', 'turmas', v_turmas);
  END IF;
  DELETE FROM public.nr_treinamento_tipo WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tipo_nao_encontrado'; END IF;
  RETURN jsonb_build_object('ok', true, 'modo', 'excluido');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_tipo_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('turmas', (
      SELECT count(*) FROM public.nr_turma tu WHERE tu.tipo_id = t.id)) ORDER BY t.nr_codigo NULLS LAST, t.nome), '[]'::jsonb)
    INTO v FROM public.nr_treinamento_tipo t
   WHERE t.company_id = p_company_id AND (p_incluir_inativos OR t.ativo);
  RETURN jsonb_build_object('ok', true, 'tipos', v);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Turmas — salvar / listar / cancelar  (recalcula validade das presenças ao virar "realizada")
-- ─────────────────────────────────────────────────────────────────────────────
-- recalcula validade_ate/data_emissao das presenças de uma turma (chamado ao salvar turma e ao registrar presença)
CREATE OR REPLACE FUNCTION public.fn_nr_recalcular_validade(p_turma_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_status text; v_data date; v_meses int;
BEGIN
  SELECT tu.status, tu.data_realizacao, ti.validade_meses INTO v_status, v_data, v_meses
    FROM public.nr_turma tu JOIN public.nr_treinamento_tipo ti ON ti.id = tu.tipo_id
   WHERE tu.id = p_turma_id;
  IF v_status = 'realizada' AND v_data IS NOT NULL THEN
    UPDATE public.nr_turma_presenca SET
      validade_ate = CASE WHEN v_meses IS NOT NULL THEN (v_data + (v_meses || ' months')::interval)::date ELSE NULL END,
      data_emissao_certificado = COALESCE(data_emissao_certificado, v_data)
    WHERE turma_id = p_turma_id AND presente;
  ELSE
    -- turma não realizada (planejada/cancelada) → sem validade vigente
    UPDATE public.nr_turma_presenca SET validade_ate = NULL WHERE turma_id = p_turma_id;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_turma_salvar(p_company_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := NULLIF(p_payload->>'id','')::uuid; r public.nr_turma;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  IF NULLIF(p_payload->>'tipo_id','') IS NULL THEN RAISE EXCEPTION 'tipo_obrigatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nr_treinamento_tipo WHERE id = (p_payload->>'tipo_id')::uuid AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.nr_turma (company_id, tipo_id, data_realizacao, instrutor, carga_horaria, local, status, observacao)
    VALUES (p_company_id, (p_payload->>'tipo_id')::uuid, NULLIF(p_payload->>'data_realizacao','')::date,
            NULLIF(btrim(p_payload->>'instrutor'),''), NULLIF(p_payload->>'carga_horaria','')::numeric,
            NULLIF(btrim(p_payload->>'local'),''), COALESCE(NULLIF(p_payload->>'status',''),'planejada'),
            NULLIF(btrim(p_payload->>'observacao'),''))
    RETURNING * INTO r;
  ELSE
    UPDATE public.nr_turma SET
      tipo_id = (p_payload->>'tipo_id')::uuid, data_realizacao = NULLIF(p_payload->>'data_realizacao','')::date,
      instrutor = NULLIF(btrim(p_payload->>'instrutor'),''), carga_horaria = NULLIF(p_payload->>'carga_horaria','')::numeric,
      local = NULLIF(btrim(p_payload->>'local'),''), status = COALESCE(NULLIF(p_payload->>'status',''), status),
      observacao = NULLIF(btrim(p_payload->>'observacao'),''), atualizado_em = now()
    WHERE id = v_id AND company_id = p_company_id
    RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'turma_nao_encontrada'; END IF;
  END IF;
  -- turma "realizada" → (re)calcula validade_ate das presenças a partir da data + validade_meses do tipo
  PERFORM public.fn_nr_recalcular_validade(r.id);
  RETURN to_jsonb(r);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_turma_cancelar(p_company_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  UPDATE public.nr_turma SET status = 'cancelada', atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'turma_nao_encontrada'; END IF;
  PERFORM public.fn_nr_recalcular_validade(p_id);
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_turma_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', tu.id, 'tipo_id', tu.tipo_id, 'nr_codigo', ti.nr_codigo, 'tipo_nome', ti.nome,
      'data_realizacao', tu.data_realizacao, 'instrutor', tu.instrutor, 'carga_horaria', tu.carga_horaria,
      'local', tu.local, 'status', tu.status, 'observacao', tu.observacao,
      'presentes', (SELECT count(*) FROM public.nr_turma_presenca pp WHERE pp.turma_id = tu.id AND pp.presente),
      'com_certificado', (SELECT count(*) FROM public.nr_turma_presenca pp WHERE pp.turma_id = tu.id AND pp.certificado_url IS NOT NULL)
    ) ORDER BY tu.data_realizacao DESC NULLS LAST, tu.criado_em DESC), '[]'::jsonb)
    INTO v FROM public.nr_turma tu JOIN public.nr_treinamento_tipo ti ON ti.id = tu.tipo_id
   WHERE tu.company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'turmas', v);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Presença em lote + certificado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr_presenca_registrar(p_company_id uuid, p_turma_id uuid, p_funcionarios uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_func uuid; v_n int := 0;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.nr_turma WHERE id = p_turma_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'turma_nao_encontrada'; END IF;
  FOREACH v_func IN ARRAY COALESCE(p_funcionarios, ARRAY[]::uuid[]) LOOP
    -- só aceita funcionário do mesmo tenant (fail-closed)
    IF NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios f WHERE f.id = v_func AND f.company_id = p_company_id) THEN
      CONTINUE; END IF;
    INSERT INTO public.nr_turma_presenca (company_id, turma_id, funcionario_id, presente)
    VALUES (p_company_id, p_turma_id, v_func, true)
    ON CONFLICT (turma_id, funcionario_id) DO UPDATE SET presente = true;
    v_n := v_n + 1;
  END LOOP;
  PERFORM public.fn_nr_recalcular_validade(p_turma_id);  -- calcula validade_ate se a turma já é "realizada"
  RETURN jsonb_build_object('ok', true, 'registrados', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_certificado_anexar(p_company_id uuid, p_presenca_id uuid, p_arquivo_url text, p_data_emissao date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  UPDATE public.nr_turma_presenca SET certificado_url = p_arquivo_url,
      data_emissao_certificado = COALESCE(p_data_emissao, data_emissao_certificado)
    WHERE id = p_presenca_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'presenca_nao_encontrada'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Matriz por funcionário + vencimentos (semáforo reusa o padrão de compliance)
--    janela "a vencer" = 60 dias (tempo p/ planejar a reciclagem)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr_matriz_funcionario(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.funcionario, m.nr_codigo NULLS LAST, m.tipo_nome), '[]'::jsonb)
    INTO v FROM (
    SELECT DISTINCT ON (p.funcionario_id, tu.tipo_id)
      p.funcionario_id, f.nome_completo AS funcionario, f.cargo, f.setor,
      tu.tipo_id, ti.nr_codigo, ti.nome AS tipo_nome,
      tu.data_realizacao, p.validade_ate, p.certificado_url IS NOT NULL AS tem_certificado,
      (p.validade_ate - CURRENT_DATE) AS dias_para_vencer,
      CASE
        WHEN p.validade_ate IS NULL THEN 'sem_validade'
        WHEN p.validade_ate < CURRENT_DATE THEN 'vencido'
        WHEN p.validade_ate <= CURRENT_DATE + 60 THEN 'a_vencer'
        ELSE 'valido'
      END AS status
    FROM public.nr_turma_presenca p
    JOIN public.nr_turma tu ON tu.id = p.turma_id AND tu.status = 'realizada'
    JOIN public.nr_treinamento_tipo ti ON ti.id = tu.tipo_id
    JOIN public.compliance_funcionarios f ON f.id = p.funcionario_id
    WHERE p.company_id = p_company_id AND p.presente
    ORDER BY p.funcionario_id, tu.tipo_id, tu.data_realizacao DESC NULLS LAST
  ) m;
  RETURN jsonb_build_object('ok', true, 'matriz', v);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr_vencimentos(p_company_id uuid, p_dias integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.validade_ate), '[]'::jsonb) INTO v FROM (
    SELECT p.id AS presenca_id, p.funcionario_id, f.nome_completo AS funcionario, ti.nr_codigo, ti.nome AS tipo_nome,
           p.validade_ate, (p.validade_ate - CURRENT_DATE) AS dias_para_vencer,
           CASE WHEN p.validade_ate < CURRENT_DATE THEN 'vencido' ELSE 'a_vencer' END AS status
    FROM public.nr_turma_presenca p
    JOIN public.nr_turma tu ON tu.id = p.turma_id AND tu.status = 'realizada'
    JOIN public.nr_treinamento_tipo ti ON ti.id = tu.tipo_id
    JOIN public.compliance_funcionarios f ON f.id = p.funcionario_id
    WHERE p.company_id = p_company_id AND p.presente AND p.validade_ate IS NOT NULL
      AND p.validade_ate <= CURRENT_DATE + p_dias
      -- só a reciclagem MAIS RECENTE por funcionário/tipo (não alerta treino já substituído)
      AND p.id = (SELECT p2.id FROM public.nr_turma_presenca p2 JOIN public.nr_turma tu2 ON tu2.id=p2.turma_id AND tu2.status='realizada'
                  WHERE p2.funcionario_id = p.funcionario_id AND tu2.tipo_id = tu.tipo_id AND p2.presente
                  ORDER BY tu2.data_realizacao DESC NULLS LAST LIMIT 1)
  ) x;
  RETURN jsonb_build_object('ok', true, 'vencimentos', v);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Alertas de reciclagem — PLUGA no erp_alerta_proativo (não cria sistema novo).
--    Roda p/ TODAS as empresas (cron); dedup por presenca_id no contexto. Padrão fn_epi_gerar_alertas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr_gerar_alertas()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_criados int := 0;
BEGIN
  INSERT INTO public.erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p.company_id, 'nr_reciclagem',
    CASE WHEN p.validade_ate < CURRENT_DATE THEN 'critica' ELSE 'alta' END,
    CASE WHEN p.validade_ate < CURRENT_DATE
      THEN '🚨 Treinamento ' || COALESCE(ti.nr_codigo,ti.nome) || ' VENCIDO: ' || f.nome_completo
      ELSE '⏰ Reciclagem ' || COALESCE(ti.nr_codigo,ti.nome) || ' em ' || (p.validade_ate - CURRENT_DATE) || ' dias: ' || f.nome_completo END,
    'O treinamento "' || ti.nome || '" de ' || f.nome_completo || ' '
      || CASE WHEN p.validade_ate < CURRENT_DATE THEN 'venceu em ' ELSE 'vence em ' END || p.validade_ate::text
      || '. Programe a reciclagem.',
    jsonb_build_object('presenca_id', p.id, 'funcionario_id', p.funcionario_id, 'tipo_id', tu.tipo_id,
                       'nr_codigo', ti.nr_codigo, 'validade_ate', p.validade_ate, 'dias', (p.validade_ate - CURRENT_DATE)),
    '/dashboard/compliance/treinamentos'
  FROM public.nr_turma_presenca p
  JOIN public.nr_turma tu ON tu.id = p.turma_id AND tu.status = 'realizada'
  JOIN public.nr_treinamento_tipo ti ON ti.id = tu.tipo_id
  JOIN public.compliance_funcionarios f ON f.id = p.funcionario_id
  WHERE p.presente AND p.validade_ate IS NOT NULL
    AND p.validade_ate <= CURRENT_DATE + 60
    -- só a reciclagem mais recente por funcionário/tipo
    AND p.id = (SELECT p2.id FROM public.nr_turma_presenca p2 JOIN public.nr_turma tu2 ON tu2.id=p2.turma_id AND tu2.status='realizada'
                WHERE p2.funcionario_id = p.funcionario_id AND tu2.tipo_id = tu.tipo_id AND p2.presente
                ORDER BY tu2.data_realizacao DESC NULLS LAST LIMIT 1)
    -- dedup: não repete alerta aberto pra mesma presença
    AND NOT EXISTS (
      SELECT 1 FROM public.erp_alerta_proativo a
      WHERE a.company_id = p.company_id AND a.tipo = 'nr_reciclagem'
        AND a.contexto->>'presenca_id' = p.id::text
        AND COALESCE(a.resolvido,false) = false AND COALESCE(a.dispensado,false) = false);
  GET DIAGNOSTICS v_criados = ROW_COUNT;
  RETURN jsonb_build_object('sucesso', true, 'alertas_criados', v_criados, 'executado_em', now());
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Grants + cron diário (05:10) — pluga na infra de cron existente (pg_cron)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_nr_tipo_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_tipo_excluir(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_tipo_listar(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_turma_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_turma_cancelar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_turma_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_presenca_registrar(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_certificado_anexar(uuid, uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_matriz_funcionario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr_vencimentos(uuid, integer) TO authenticated;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('nr-treinamento-alertas-diario', '10 5 * * *', 'SELECT public.fn_nr_gerar_alertas();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron nr-treinamento-alertas-diario nao agendado (%). Agende manualmente se necessario.', SQLERRM;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) RD-58 — módulo sai de "previsto/parcial" para "pronto" (badge reflete a verdade)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.feature_catalog
   SET status = 'pronto', percentual_pronto = 100
 WHERE module_id = 'compliance_treinamentos';
