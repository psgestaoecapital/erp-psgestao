-- Compliance · Pausas Técnicas frigorífico (NR-36 psicofisiológica + Art.253 CLT térmica) — Fase 1
--
-- Gera prova documental das pausas obrigatórias cruzando o ponto (IOPoint) com as regras legais.
-- ⚠️ Passivo trabalhista alto (TRT-12 NT 13/2025 · Súmula 438 TST): a empresa precisa PROVAR a concessão.
--
-- ACHADO (auditado RD-38): o coletor IOPoint hoje puxa só o espelho de jornada (/point/getFromPeriod).
-- NÃO há NENHUM dado de pausa no banco (82.034 marcações, 319 pessoas, todas ~4/dia; method/origin = só a
-- FONTE — Relógio/App/Web; point_id é a PK da batida, NÃO uma leitora de pausa; raw sem type/reason/break).
-- Logo, o "REALIZADO" depende de estender o coletor para o endpoint de pausas da IOPoint (pendente do Jian).
--
-- Esta Fase 1 entrega o que é computável AGORA e prepara o resto:
--   • regras das 2 pausas (editável, genérico p/ qualquer frigorífico),
--   • elegíveis por função/manual (liga ind_ponto_colaborador ↔ regra),
--   • o DEVIDO por funcionário/dia (calculado de ind_ponto_dia.worked_seconds),
--   • ind_ponto_pausa (landing do endpoint de pausas) + fn_nr36_apurar que consome o REALIZADO nullable.
-- Enquanto não há REALIZADO, o status é 'aguardando_realizado' — o painel mostra o DEVIDO e NÃO afirma
-- concessão (RD-58/RD-51: nunca prova falsa). Quando o Jian ligar o endpoint, o ciclo fecha sozinho.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Landing das PAUSAS (alvo do coletor estendido — Fase 2, Jian liga o endpoint)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ind_ponto_pausa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,
  cpf text NOT NULL,
  data date NOT NULL,
  inicio timestamptz NOT NULL,
  fim timestamptz,
  duracao_seg integer,
  tipo text,                 -- 'termica_253' | 'psicofisiologica' | bruto da IOPoint (a mapear com o Jian)
  point_id bigint,
  raw jsonb,
  sincronizado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, cpf, inicio)
);
CREATE INDEX IF NOT EXISTS ix_ind_ponto_pausa_dia ON public.ind_ponto_pausa(company_id, cpf, data);
ALTER TABLE public.ind_ponto_pausa ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ind_ponto_pausa' AND policyname='p_ind_ponto_pausa_tenant') THEN
    CREATE POLICY p_ind_ponto_pausa_tenant ON public.ind_ponto_pausa FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
GRANT SELECT ON public.ind_ponto_pausa TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Modelo NR-36 (multi-tenant RLS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_pausa_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('psicofisiologica','termica_253')),
  nome text NOT NULL,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,  -- psico: faixas[]/add; termica: gatilho_min/pausa_min
  base_legal text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, tipo)
);

CREATE TABLE IF NOT EXISTS public.nr36_funcionario_elegivel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  colaborador_id uuid NOT NULL REFERENCES public.ind_ponto_colaborador(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('psicofisiologica','termica_253')),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','funcao','esocial')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, colaborador_id, tipo)
);
CREATE INDEX IF NOT EXISTS ix_nr36_elegivel ON public.nr36_funcionario_elegivel(company_id, tipo, ativo);

CREATE TABLE IF NOT EXISTS public.nr36_pausa_apurada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  colaborador_id uuid,
  cpf text NOT NULL,
  data date NOT NULL,
  tipo text NOT NULL,
  jornada_seg integer,
  devido_min integer,
  realizado_min integer,          -- NULL enquanto não há dado de pausa (aguardando_realizado)
  diferenca_min integer,
  status text NOT NULL,           -- cumprida | parcial | nao_cumprida | aguardando_realizado
  detalhe jsonb,
  apurado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, cpf, data, tipo)
);
CREATE INDEX IF NOT EXISTS ix_nr36_apurada ON public.nr36_pausa_apurada(company_id, data, status);

DO $mig$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['nr36_pausa_regra','nr36_funcionario_elegivel','nr36_pausa_apurada'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='p_'||t||'_tenant') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
        WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())$p$, 'p_'||t||'_tenant', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION public.fn_nr36_assert(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
  RAISE EXCEPTION 'sem_acesso' USING errcode='42501'; END IF; END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Cálculo do DEVIDO (a lei em código; parâmetros vêm da regra — editável)
--    psico: maior faixa cujo limiar <= jornada + adicional se > 9h10
--    térmica 253: floor(jornada / gatilho) * pausa_min
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_devido_min(p_tipo text, p_jornada_seg integer, p_param jsonb)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE h numeric := COALESCE(p_jornada_seg,0)/3600.0; m numeric := COALESCE(p_jornada_seg,0)/60.0; v integer := 0;
BEGIN
  IF p_tipo = 'termica_253' THEN
    v := floor(m / GREATEST(COALESCE((p_param->>'gatilho_min')::numeric, 100), 1))::int * COALESCE((p_param->>'pausa_min')::int, 20);
  ELSE
    SELECT COALESCE(max((x->>'min')::int), 0) INTO v
      FROM jsonb_array_elements(COALESCE(p_param->'faixas', '[]'::jsonb)) x
     WHERE (x->>'ate_h')::numeric <= h;
    IF h > COALESCE((p_param->>'acima_h')::numeric, 9.1667) THEN v := v + COALESCE((p_param->>'acima_add')::int, 10); END IF;
  END IF;
  RETURN GREATEST(COALESCE(v,0), 0);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Regras — seed padrão + salvar + listar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_regra_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.tipo), '[]'::jsonb) INTO v FROM public.nr36_pausa_regra r WHERE r.company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'regras', v);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr36_regra_seed_padrao(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  INSERT INTO public.nr36_pausa_regra (company_id, tipo, nome, base_legal, parametros) VALUES
   (p_company_id, 'psicofisiologica', 'Pausa Psicofisiológica', 'NR-36 item 36.13.2',
    '{"faixas":[{"ate_h":6,"min":20},{"ate_h":7.333,"min":45},{"ate_h":8.8,"min":60}],"acima_h":9.1667,"acima_add":10,"unitario_min":10,"unitario_max":20}'::jsonb),
   (p_company_id, 'termica_253', 'Recuperação Térmica', 'Art. 253 CLT + NR-15 Anexo 3 + Súmula 438 TST',
    '{"gatilho_min":100,"pausa_min":20,"continua":true}'::jsonb)
  ON CONFLICT (company_id, tipo) DO NOTHING;
  RETURN (SELECT public.fn_nr36_regra_listar(p_company_id));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr36_regra_salvar(p_company_id uuid, p_tipo text, p_nome text, p_parametros jsonb, p_ativo boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.nr36_pausa_regra; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_tipo NOT IN ('psicofisiologica','termica_253') THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  INSERT INTO public.nr36_pausa_regra (company_id, tipo, nome, parametros, ativo)
  VALUES (p_company_id, p_tipo, COALESCE(NULLIF(btrim(p_nome),''), p_tipo), COALESCE(p_parametros,'{}'::jsonb), COALESCE(p_ativo,true))
  ON CONFLICT (company_id, tipo) DO UPDATE SET nome = EXCLUDED.nome, parametros = EXCLUDED.parametros, ativo = EXCLUDED.ativo, atualizado_em = now()
  RETURNING * INTO r;
  RETURN to_jsonb(r);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Elegíveis — por função (lote) / toggle manual / listar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_elegiveis_por_funcao(p_company_id uuid, p_tipo text, p_funcoes text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_n int; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  INSERT INTO public.nr36_funcionario_elegivel (company_id, colaborador_id, tipo, origem, ativo)
  SELECT p_company_id, c.id, p_tipo, 'funcao', true FROM public.ind_ponto_colaborador c
   WHERE c.company_id = p_company_id AND c.funcao = ANY(p_funcoes)
  ON CONFLICT (company_id, colaborador_id, tipo) DO UPDATE SET ativo = true, origem = 'funcao';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'marcados', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr36_elegivel_set(p_company_id uuid, p_colaborador_id uuid, p_tipo text, p_ativo boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.ind_ponto_colaborador WHERE id = p_colaborador_id AND company_id = p_company_id) THEN RAISE EXCEPTION 'colaborador_invalido'; END IF;
  INSERT INTO public.nr36_funcionario_elegivel (company_id, colaborador_id, tipo, origem, ativo)
  VALUES (p_company_id, p_colaborador_id, p_tipo, 'manual', COALESCE(p_ativo,true))
  ON CONFLICT (company_id, colaborador_id, tipo) DO UPDATE SET ativo = COALESCE(p_ativo,true), origem = 'manual';
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr36_elegiveis_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'colaborador_id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'funcao', c.funcao, 'departamento', c.departamento,
      'psico', COALESCE((SELECT e.ativo FROM public.nr36_funcionario_elegivel e WHERE e.colaborador_id=c.id AND e.tipo='psicofisiologica'), false),
      'termica', COALESCE((SELECT e.ativo FROM public.nr36_funcionario_elegivel e WHERE e.colaborador_id=c.id AND e.tipo='termica_253'), false)
    ) ORDER BY c.nome), '[]'::jsonb) INTO v
    FROM public.ind_ponto_colaborador c WHERE c.company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'colaboradores', v,
    'funcoes', (SELECT COALESCE(jsonb_agg(DISTINCT c.funcao), '[]'::jsonb) FROM public.ind_ponto_colaborador c WHERE c.company_id = p_company_id AND c.funcao IS NOT NULL));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) MOTOR — apura DEVIDO (jornada) vs REALIZADO (pausas, nullable) por func/dia/tipo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tem_pausas boolean; v_linhas int;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  -- há dado de pausa no período? se não, o REALIZADO é desconhecido (aguardando), NÃO zero (não é "não cumpriu").
  SELECT EXISTS (SELECT 1 FROM public.ind_ponto_pausa WHERE company_id = p_company_id AND data BETWEEN p_dt_ini AND p_dt_fim) INTO v_tem_pausas;

  INSERT INTO public.nr36_pausa_apurada (company_id, colaborador_id, cpf, data, tipo, jornada_seg, devido_min, realizado_min, diferenca_min, status, apurado_em)
  SELECT d.company_id, c.id, d.cpf, d.data, e.tipo, d.worked_seconds,
    public.fn_nr36_devido_min(e.tipo, d.worked_seconds, r.parametros) AS devido,
    CASE WHEN v_tem_pausas THEN COALESCE(pz.min_real, 0) ELSE NULL END AS realizado,
    CASE WHEN v_tem_pausas THEN COALESCE(pz.min_real, 0) - public.fn_nr36_devido_min(e.tipo, d.worked_seconds, r.parametros) ELSE NULL END AS diff,
    CASE
      WHEN NOT v_tem_pausas THEN 'aguardando_realizado'
      WHEN COALESCE(pz.min_real,0) >= public.fn_nr36_devido_min(e.tipo, d.worked_seconds, r.parametros) THEN 'cumprida'
      WHEN COALESCE(pz.min_real,0) > 0 THEN 'parcial'
      ELSE 'nao_cumprida'
    END AS status,
    now()
  FROM public.nr36_funcionario_elegivel e
  JOIN public.ind_ponto_colaborador c ON c.id = e.colaborador_id
  JOIN public.nr36_pausa_regra r ON r.company_id = e.company_id AND r.tipo = e.tipo AND r.ativo
  JOIN public.ind_ponto_dia d ON d.company_id = e.company_id AND d.cpf = c.cpf AND d.data BETWEEN p_dt_ini AND p_dt_fim AND COALESCE(d.worked_seconds,0) > 0
  LEFT JOIN LATERAL (SELECT (sum(pp.duracao_seg)/60)::int AS min_real FROM public.ind_ponto_pausa pp
                     WHERE pp.company_id = d.company_id AND pp.cpf = d.cpf AND pp.data = d.data
                       AND (pp.tipo IS NULL OR pp.tipo = e.tipo)) pz ON true
  WHERE e.company_id = p_company_id AND e.ativo
  ON CONFLICT (company_id, cpf, data, tipo) DO UPDATE SET
    jornada_seg = EXCLUDED.jornada_seg, devido_min = EXCLUDED.devido_min, realizado_min = EXCLUDED.realizado_min,
    diferenca_min = EXCLUDED.diferenca_min, status = EXCLUDED.status, colaborador_id = EXCLUDED.colaborador_id, apurado_em = now();
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'linhas', v_linhas, 'tem_realizado', v_tem_pausas,
    'aviso', CASE WHEN v_tem_pausas THEN NULL ELSE 'Realizado indisponível: o coletor IOPoint ainda não puxa as pausas (Fase 2). Este resultado mostra só o DEVIDO — não prova concessão.' END);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_nr36_apuracao_listar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; v_tem boolean; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT EXISTS (SELECT 1 FROM public.ind_ponto_pausa WHERE company_id = p_company_id) INTO v_tem;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'colaborador_id', a.colaborador_id, 'cpf', a.cpf, 'nome', c.nome, 'funcao', c.funcao,
      'tipo', a.tipo, 'dias', a.dias, 'devido_min', a.devido_tot, 'realizado_min', a.realizado_tot,
      'dias_nao_cumpridos', a.nao_cumpridos, 'dias_parciais', a.parciais, 'dias_aguardando', a.aguardando,
      'status', CASE WHEN a.nao_cumpridos > 0 THEN 'nao_cumprida' WHEN a.parciais > 0 THEN 'parcial'
                     WHEN a.aguardando = a.dias THEN 'aguardando_realizado' ELSE 'cumprida' END
    ) ORDER BY c.nome, a.tipo), '[]'::jsonb) INTO v FROM (
    SELECT ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo, count(*) AS dias, sum(ap.devido_min) AS devido_tot,
           sum(ap.realizado_min) AS realizado_tot,
           count(*) FILTER (WHERE ap.status='nao_cumprida') AS nao_cumpridos,
           count(*) FILTER (WHERE ap.status='parcial') AS parciais,
           count(*) FILTER (WHERE ap.status='aguardando_realizado') AS aguardando
    FROM public.nr36_pausa_apurada ap WHERE ap.company_id = p_company_id AND ap.data BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo
  ) a JOIN public.ind_ponto_colaborador c ON c.id = a.colaborador_id;
  RETURN jsonb_build_object('ok', true, 'tem_realizado', v_tem, 'resumo', v);
END $function$;

-- Relatório-prova cronológico por funcionário (a prova pro passivo — honesto sobre o realizado)
CREATE OR REPLACE FUNCTION public.fn_nr36_relatorio_prova(p_company_id uuid, p_cpf text, p_dt_ini date, p_dt_fim date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; v_col jsonb; v_tem boolean; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT to_jsonb(c) INTO v_col FROM (SELECT nome, cpf, funcao, departamento, matricula FROM public.ind_ponto_colaborador WHERE company_id=p_company_id AND cpf=p_cpf LIMIT 1) c;
  SELECT EXISTS (SELECT 1 FROM public.ind_ponto_pausa WHERE company_id=p_company_id AND cpf=p_cpf) INTO v_tem;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('data', ap.data, 'tipo', ap.tipo, 'jornada_seg', ap.jornada_seg,
      'devido_min', ap.devido_min, 'realizado_min', ap.realizado_min, 'status', ap.status) ORDER BY ap.data, ap.tipo), '[]'::jsonb)
    INTO v FROM public.nr36_pausa_apurada ap WHERE ap.company_id=p_company_id AND ap.cpf=p_cpf AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok', true, 'colaborador', v_col, 'tem_realizado', v_tem, 'periodo', jsonb_build_object('ini',p_dt_ini,'fim',p_dt_fim), 'linhas', v);
END $function$;

-- Alertas — SÓ quando o realizado é conhecido e insuficiente (nunca alerta sobre 'aguardando')
CREATE OR REPLACE FUNCTION public.fn_nr36_alertas(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_n int := 0; BEGIN
  IF p_company_id IS NOT NULL THEN PERFORM public.fn_nr36_assert(p_company_id); END IF;
  INSERT INTO public.erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT g.company_id, 'nr36_pausa', 'critica',
    'Pausas ' || g.tipo || ' não cumpridas: ' || c.nome || ' (' || g.dias || ' dia(s))',
    c.nome || ' tem ' || g.dias || ' dia(s) com pausa ' || g.tipo || ' não cumprida no período recente. Risco de passivo (Art.253/NR-36).',
    jsonb_build_object('cpf', g.cpf, 'tipo', g.tipo, 'dias', g.dias),
    '/dashboard/compliance/pausas-tecnicas'
  FROM (
    SELECT ap.company_id, ap.cpf, ap.tipo, count(*) AS dias
    FROM public.nr36_pausa_apurada ap
    WHERE (p_company_id IS NULL OR ap.company_id = p_company_id)
      AND ap.status = 'nao_cumprida' AND ap.data >= CURRENT_DATE - 30
    GROUP BY ap.company_id, ap.cpf, ap.tipo
  ) g JOIN public.ind_ponto_colaborador c ON c.company_id = g.company_id AND c.cpf = g.cpf
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_alerta_proativo a WHERE a.company_id = g.company_id AND a.tipo='nr36_pausa'
      AND a.contexto->>'cpf' = g.cpf AND a.contexto->>'tipo' = g.tipo
      AND COALESCE(a.resolvido,false)=false AND COALESCE(a.dispensado,false)=false);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'alertas_criados', v_n);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_nr36_regra_seed_padrao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_regra_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_regra_salvar(uuid, text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_elegiveis_por_funcao(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_elegivel_set(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_elegiveis_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apuracao_listar(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_relatorio_prova(uuid, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_alertas(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Menu (module_catalog) + badge honesto (feature_catalog = PARCIAL: falta o realizado)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, layer, is_shared, descricao)
VALUES ('compliance_pausas_tecnicas', 'Pausas Técnicas', 'compliance', 'docs_regulatorios',
        '/dashboard/compliance/pausas-tecnicas', 'Timer', 75, true, '3_specific', false,
        'Pausas obrigatórias de frigorífico (NR-36 psicofisiológica + Art.253 térmica): devido vs realizado + prova.')
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, layer=EXCLUDED.layer, is_shared=EXCLUDED.is_shared, descricao=EXCLUDED.descricao;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, descricao_executiva, descricao_tecnica, observacao)
VALUES ('compliance_pausas_tecnicas', 'compliance_pausas_tecnicas', 'compliance', 'Pausas Técnicas', 'parcial', 60,
  'Controle das pausas obrigatórias de frigorífico (NR-36 + Art.253 CLT): calcula o devido e prepara a prova.',
  'Tela /dashboard/compliance/pausas-tecnicas. Devido calculado de ind_ponto_dia; realizado aguarda o endpoint de pausas da IOPoint (ind_ponto_pausa).',
  'RD-58: PARCIAL de verdade — devido pronto; realizado/prova dependem do coletor de pausas (Fase 2).')
ON CONFLICT (id) DO UPDATE SET status='parcial', percentual_pronto=60, titulo=EXCLUDED.titulo, module_id=EXCLUDED.module_id,
  area=EXCLUDED.area, descricao_executiva=EXCLUDED.descricao_executiva, descricao_tecnica=EXCLUDED.descricao_tecnica, observacao=EXCLUDED.observacao;
