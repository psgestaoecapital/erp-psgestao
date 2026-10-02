-- Pauta P&M · P2 (SPEC "P&M · Pauta", seções 5 e 6 — lista do banco APROVADA pelo CEO 02/10).
--  1) Filtro único (fn__pauta_filtrar): os contadores das abas e a lista usam a MESMA regra (as abas sempre batem com
--     a lista). Atalhos novos: "Estourando o escopo" (rodada acima do limite do contrato) e "Margem negativa" (custo
--     real — ou estimado — acima do valor do job; só para gestor/financeiro, seção 8).
--  2) fn_pauta_listar: página de 50 jobs, ordenada para o agrupamento escolhido (prazo, cliente, responsável).
--  3) agency_pauta_lote + editar em massa / excluir / restaurar / desfazer (24 h, quem fez ou o gestor): cada ação
--     guarda o "antes" (base do "Minhas últimas ações" da P4) e grava em audit_log_global.
--  4) agency_pauta_preferencia: o filtro de cada pessoa fica salvo entre visitas, em qualquer aparelho.
--  5) agency_job_visto: quando cada pessoa abriu o job — acende o balão de "comentários novos".
--  + menu "Pauta" no P&M e os textos da ajuda de campo ("?") da tela.

-- ───────── 0) quem vê dinheiro (margem e escopo em reais): gestor e financeiro (seção 8) ─────────
CREATE OR REPLACE FUNCTION public.fn_pm_pode_ver_margem(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total'))
$$;
REVOKE ALL ON FUNCTION public.fn_pm_pode_ver_margem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_pode_ver_margem(uuid) TO authenticated, service_role;

-- ───────── 1) filtro único ─────────
-- p_filtros (todos opcionais): clientes[], responsaveis[], grupos[], campanhas[], fees[], servicos[], situacao_cliente[],
-- titulo, codigo (com ou sem a letra da rodada), aguardando (bool), aguardando_de[], data_tipo (prazo|criacao|entrega|
-- conclusao) + data_de/data_ate, atalho (meus|atrasados|hoje|esperando_cliente|estourando_escopo|margem_negativa),
-- lixeira (bool: só os excluídos). SECURITY INVOKER: a RLS de agency_jobs vale para quem chama.
CREATE OR REPLACE FUNCTION public.fn__pauta_filtrar(p_company_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.agency_jobs LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH f AS (SELECT COALESCE(p_filtros, '{}'::jsonb) f, (now() AT TIME ZONE 'America/Sao_Paulo')::date hoje)
  SELECT j.*
    FROM public.agency_jobs j
    LEFT JOIN public.agency_clientes c ON c.id = j.cliente_id
    CROSS JOIN f
   WHERE j.company_id = p_company_id
     AND (CASE WHEN COALESCE((f.f->>'lixeira')::boolean, false) THEN j.excluido_em IS NOT NULL ELSE j.excluido_em IS NULL END)
     AND (NOT (f.f ? 'clientes')     OR j.cliente_id::text     IN (SELECT jsonb_array_elements_text(f.f->'clientes')))
     AND (NOT (f.f ? 'responsaveis') OR j.responsavel_id::text IN (SELECT jsonb_array_elements_text(f.f->'responsaveis')))
     AND (NOT (f.f ? 'grupos')       OR c.grupo_id::text       IN (SELECT jsonb_array_elements_text(f.f->'grupos')))
     AND (NOT (f.f ? 'campanhas')    OR j.campanha_id::text    IN (SELECT jsonb_array_elements_text(f.f->'campanhas')))
     AND (NOT (f.f ? 'fees')         OR j.fee_id::text         IN (SELECT jsonb_array_elements_text(f.f->'fees'))
                                     OR j.contrato_id::text    IN (SELECT jsonb_array_elements_text(f.f->'fees')))
     AND (NOT (f.f ? 'servicos')     OR j.servico_id::text     IN (SELECT jsonb_array_elements_text(f.f->'servicos')))
     AND (NOT (f.f ? 'situacao_cliente') OR c.status           IN (SELECT jsonb_array_elements_text(f.f->'situacao_cliente')))
     AND (NOT (f.f ? 'titulo') OR j.titulo ILIKE '%' || (f.f->>'titulo') || '%')
     AND (NOT (f.f ? 'codigo') OR j.numero::text ILIKE '%' || regexp_replace(f.f->>'codigo', '[A-Za-z]+$', '') || '%')
     AND (NOT (f.f ? 'aguardando') OR ((f.f->>'aguardando')::boolean = (j.status = 'aguardando')))
     AND (NOT (f.f ? 'aguardando_de') OR j.aguardando_de IN (SELECT jsonb_array_elements_text(f.f->'aguardando_de')))
     AND (NOT (f.f ? 'data_de')  OR (CASE f.f->>'data_tipo' WHEN 'criacao' THEN j.created_at::date WHEN 'entrega' THEN j.data_entrega::date
                                       WHEN 'conclusao' THEN j.data_entrega::date ELSE j.data_prazo::date END) >= (f.f->>'data_de')::date)
     AND (NOT (f.f ? 'data_ate') OR (CASE f.f->>'data_tipo' WHEN 'criacao' THEN j.created_at::date WHEN 'entrega' THEN j.data_entrega::date
                                       WHEN 'conclusao' THEN j.data_entrega::date ELSE j.data_prazo::date END) <= (f.f->>'data_ate')::date)
     AND (CASE f.f->>'atalho'
            WHEN 'meus' THEN j.responsavel_id = auth.uid()
            WHEN 'atrasados' THEN j.data_prazo::date < f.hoje AND j.status NOT IN ('concluida', 'publicado')
            WHEN 'hoje' THEN j.data_prazo::date = f.hoje
            WHEN 'esperando_cliente' THEN j.status = 'aguardando' AND j.aguardando_de = 'cliente'
            WHEN 'estourando_escopo' THEN EXISTS (
                   SELECT 1 FROM public.agency_contrato_itens i
                    WHERE i.contrato_id = j.contrato_id AND i.servico_id = j.servico_id
                      AND i.ajustes_limite IS NOT NULL AND j.rodada_ajuste > i.ajustes_limite)
            -- margem: só quem pode ver dinheiro; para os demais o atalho não filtra nada por valor (devolve vazio)
            WHEN 'margem_negativa' THEN public.fn_pm_pode_ver_margem(p_company_id)
                   AND COALESCE(j.valor_job, 0) > 0 AND COALESCE(j.custo_real, j.custo_estimado, 0) > j.valor_job
            ELSE true END)
$$;
REVOKE ALL ON FUNCTION public.fn__pauta_filtrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__pauta_filtrar(uuid, jsonb) TO authenticated, service_role;

-- contadores das abas: mesma assinatura e mesmo formato da P1, agora sobre o filtro único
CREATE OR REPLACE FUNCTION public.fn_pauta_contadores(p_company_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (SELECT status, data_prazo FROM public.fn__pauta_filtrar(p_company_id, p_filtros)),
       h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date hoje)
  SELECT jsonb_build_object(
    'por_situacao', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM base GROUP BY status) s), '{}'::jsonb),
    'total', (SELECT count(*) FROM base),
    'atrasados', (SELECT count(*) FROM base, h WHERE base.data_prazo::date < h.hoje AND base.status NOT IN ('concluida', 'publicado')))
$$;
REVOKE ALL ON FUNCTION public.fn_pauta_contadores(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pauta_contadores(uuid, jsonb) TO authenticated, service_role;

-- ───────── 5) visto por pessoa (balão de comentários novos) ─────────
CREATE TABLE IF NOT EXISTS public.agency_job_visto (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  job_id     uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  visto_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
ALTER TABLE public.agency_job_visto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_job_visto FROM PUBLIC, anon;
DROP POLICY IF EXISTS agency_job_visto_proprio ON public.agency_job_visto;
CREATE POLICY agency_job_visto_proprio ON public.agency_job_visto FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids())
              AND EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.id = job_id AND j.company_id = agency_job_visto.company_id));
GRANT SELECT, INSERT, UPDATE ON public.agency_job_visto TO authenticated;

-- ───────── 2) lista paginada ─────────
CREATE OR REPLACE FUNCTION public.fn_pauta_listar(p_company_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_situacao text DEFAULT NULL,
                                                 p_agrupar text DEFAULT 'prazo', p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_margem boolean; v_por int := LEAST(GREATEST(COALESCE(p_por_pagina, 50), 1), 500); v_pag int := GREATEST(COALESCE(p_pagina, 1), 1);
        v_total bigint; v_itens jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_margem := public.fn_pm_pode_ver_margem(p_company_id);
  SELECT count(*) INTO v_total FROM public.fn__pauta_filtrar(p_company_id, p_filtros) j WHERE p_situacao IS NULL OR j.status = p_situacao;
  WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date hoje),
  base AS (
    SELECT j.*, c.nome_fantasia AS cli_fantasia, c.nome AS cli_nome, c.status AS cli_status, s.nome AS servico_nome,
           (SELECT e.nome FROM public.agency_equipe e WHERE e.company_id = j.company_id AND e.user_id = j.responsavel_id LIMIT 1) AS equipe_nome,
           (SELECT i.ajustes_limite FROM public.agency_contrato_itens i
             WHERE i.contrato_id = j.contrato_id AND i.servico_id = j.servico_id AND i.ajustes_limite IS NOT NULL LIMIT 1) AS limite,
           (j.data_prazo::date < h.hoje AND j.status NOT IN ('concluida', 'publicado')) AS atrasado,
           (h.hoje - j.data_prazo::date) AS dias_atraso
      FROM public.fn__pauta_filtrar(p_company_id, p_filtros) j
      LEFT JOIN public.agency_clientes c ON c.id = j.cliente_id
      LEFT JOIN public.agency_servico s ON s.id = j.servico_id
      CROSS JOIN h
     WHERE p_situacao IS NULL OR j.status = p_situacao),
  pagina AS (
    SELECT * FROM base
     ORDER BY
       CASE WHEN p_agrupar IN ('prazo', 'sem') THEN NOT atrasado END,
       CASE WHEN p_agrupar = 'cliente' THEN COALESCE(cli_fantasia, cli_nome) END,
       CASE WHEN p_agrupar = 'responsavel' THEN COALESCE(equipe_nome, responsavel_nome) END,
       data_prazo NULLS LAST, numero
     OFFSET (v_pag - 1) * v_por LIMIT v_por)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'numero', p.numero,
           'codigo', p.numero || CASE WHEN p.rodada_ajuste BETWEEN 1 AND 26 THEN chr(64 + p.rodada_ajuste) WHEN p.rodada_ajuste > 26 THEN 'Z' ELSE '' END,
           'rodada', p.rodada_ajuste, 'titulo', p.titulo, 'status', p.status, 'prioridade', p.prioridade, 'nota', p.nota,
           'data_prazo', p.data_prazo, 'atrasado', COALESCE(p.atrasado, false), 'dias_atraso', CASE WHEN p.atrasado THEN p.dias_atraso END,
           'cliente_id', p.cliente_id, 'cliente', COALESCE(p.cli_fantasia, p.cli_nome), 'cliente_status', p.cli_status,
           'responsavel_id', p.responsavel_id, 'responsavel', COALESCE(p.equipe_nome, p.responsavel_nome),
           'servico', p.servico_nome, 'tipo', p.tipo,
           'tem_anexo', (jsonb_typeof(p.arquivos) = 'array' AND jsonb_array_length(p.arquivos) > 0),
           'tem_link', (COALESCE(p.arquivos::text, '') ~* 'https?://'),
           'comentarios_novos', (SELECT count(*) FROM public.agency_job_comentarios k
                                  WHERE k.job_id = p.id AND k.excluido_em IS NULL AND k.autor_id IS DISTINCT FROM auth.uid()
                                    AND k.criado_em > COALESCE((SELECT v.visto_em FROM public.agency_job_visto v
                                                                 WHERE v.job_id = p.id AND v.user_id = auth.uid()), '-infinity'::timestamptz)),
           'aguardando_de', p.aguardando_de, 'aguardando_motivo', p.aguardando_motivo,
           'aguardando_dias', CASE WHEN p.status = 'aguardando' AND p.aguardando_desde IS NOT NULL
                                   THEN ((now() AT TIME ZONE 'America/Sao_Paulo')::date - p.aguardando_desde::date) END,
           'ajustes_limite', p.limite,
           'escopo_estourou', (p.limite IS NOT NULL AND p.rodada_ajuste > p.limite),
           'excluido_em', p.excluido_em,
           'valor_job', CASE WHEN v_margem THEN p.valor_job END,
           'custo', CASE WHEN v_margem THEN COALESCE(p.custo_real, p.custo_estimado) END,
           'margem', CASE WHEN v_margem AND COALESCE(p.valor_job, 0) > 0
                          THEN p.valor_job - COALESCE(p.custo_real, p.custo_estimado, 0) END)), '[]'::jsonb)
    INTO v_itens
    FROM pagina p;
  RETURN jsonb_build_object('total', v_total, 'pagina', v_pag, 'por_pagina', v_por, 'pode_ver_margem', v_margem, 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.fn_pauta_listar(uuid, jsonb, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pauta_listar(uuid, jsonb, text, text, integer, integer) TO authenticated, service_role;

-- ───────── 3) ações em massa com desfazer (24 h) ─────────
CREATE TABLE IF NOT EXISTS public.agency_pauta_lote (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  acao        text NOT NULL CHECK (acao IN ('editar', 'excluir', 'restaurar')),
  job_ids     uuid[] NOT NULL,
  campos      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- o que foi pedido (editar)
  antes       jsonb NOT NULL,                        -- [{id, responsavel_id, data_prazo, status, prioridade, excluido_em, excluido_por}]
  criado_em   timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  desfeito_por uuid
);
CREATE INDEX IF NOT EXISTS agency_pauta_lote_user_idx ON public.agency_pauta_lote (company_id, user_id, criado_em DESC);
ALTER TABLE public.agency_pauta_lote ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_pauta_lote FROM PUBLIC, anon;
DROP POLICY IF EXISTS agency_pauta_lote_ler ON public.agency_pauta_lote;
CREATE POLICY agency_pauta_lote_ler ON public.agency_pauta_lote FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) AND (user_id = auth.uid() OR public.fn_acessos_pode_gerir(company_id)));
GRANT SELECT ON public.agency_pauta_lote TO authenticated;   -- grava só pelas funções

CREATE OR REPLACE FUNCTION public.fn__pauta_foto(p_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', j.id, 'responsavel_id', j.responsavel_id, 'data_prazo', j.data_prazo, 'status', j.status,
                                               'prioridade', j.prioridade, 'excluido_em', j.excluido_em, 'excluido_por', j.excluido_por)), '[]'::jsonb)
    FROM public.agency_jobs j WHERE j.id = ANY (p_ids)
$$;
REVOKE ALL ON FUNCTION public.fn__pauta_foto(uuid[]) FROM PUBLIC, anon, authenticated;

-- ids válidos = só os jobs da empresa (o resto da lista é ignorado e contado)
CREATE OR REPLACE FUNCTION public.fn__pauta_ids_da_empresa(p_company_id uuid, p_ids uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(j.id), ARRAY[]::uuid[]) FROM public.agency_jobs j WHERE j.company_id = p_company_id AND j.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
$$;
REVOKE ALL ON FUNCTION public.fn__pauta_ids_da_empresa(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_pauta_editar_em_massa(p_company_id uuid, p_ids uuid[], p_campos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_lote uuid; v_antes jsonb; v_c jsonb := COALESCE(p_campos, '{}'::jsonb); v_n int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  IF NOT (v_c ?| ARRAY['responsavel_id', 'data_prazo', 'status', 'prioridade']) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nada_para_alterar', 'mensagem', 'Escolha o que mudar: responsável, prazo, situação ou prioridade.');
  END IF;
  IF v_c ? 'status' AND NOT EXISTS (SELECT 1 FROM public.agency_config_opcao WHERE company_id = p_company_id AND lista = 'situacao_job'
                                       AND valor = v_c->>'status' AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida');
  END IF;
  IF v_c ? 'responsavel_id' AND v_c->>'responsavel_id' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = (v_c->>'responsavel_id')::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'responsavel_fora_da_empresa');
  END IF;
  v_ids := public.fn__pauta_ids_da_empresa(p_company_id, p_ids);
  IF cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_job'); END IF;
  v_antes := public.fn__pauta_foto(v_ids);
  UPDATE public.agency_jobs j SET
    responsavel_id = CASE WHEN v_c ? 'responsavel_id' THEN NULLIF(v_c->>'responsavel_id', '')::uuid ELSE j.responsavel_id END,
    data_prazo     = CASE WHEN v_c ? 'data_prazo' THEN (v_c->>'data_prazo')::date ELSE j.data_prazo END,
    status         = CASE WHEN v_c ? 'status' THEN v_c->>'status' ELSE j.status END,
    prioridade     = CASE WHEN v_c ? 'prioridade' THEN v_c->>'prioridade' ELSE j.prioridade END,
    updated_at     = now()
  WHERE j.id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.agency_pauta_lote (company_id, user_id, acao, job_ids, campos, antes)
  VALUES (p_company_id, auth.uid(), 'editar', v_ids, v_c, v_antes) RETURNING id INTO v_lote;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'agency_jobs', v_lote::text, 'pauta_editar_em_massa', v_antes, v_c);
  RETURN jsonb_build_object('ok', true, 'lote_id', v_lote, 'alterados', v_n, 'ignorados', cardinality(COALESCE(p_ids, ARRAY[]::uuid[])) - cardinality(v_ids));
END $$;

CREATE OR REPLACE FUNCTION public.fn_pauta_excluir(p_company_id uuid, p_ids uuid[], p_restaurar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_lote uuid; v_antes jsonb; v_n int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  v_ids := public.fn__pauta_ids_da_empresa(p_company_id, p_ids);
  IF cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_job'); END IF;
  v_antes := public.fn__pauta_foto(v_ids);
  -- exclusão sempre lógica (RD-30): a lixeira restaura
  UPDATE public.agency_jobs SET
    excluido_em  = CASE WHEN p_restaurar THEN NULL ELSE now() END,
    excluido_por = CASE WHEN p_restaurar THEN NULL ELSE auth.uid() END,
    updated_at   = now()
  WHERE id = ANY (v_ids) AND (CASE WHEN p_restaurar THEN excluido_em IS NOT NULL ELSE excluido_em IS NULL END);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.agency_pauta_lote (company_id, user_id, acao, job_ids, antes)
  VALUES (p_company_id, auth.uid(), CASE WHEN p_restaurar THEN 'restaurar' ELSE 'excluir' END, v_ids, v_antes) RETURNING id INTO v_lote;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'agency_jobs', v_lote::text, CASE WHEN p_restaurar THEN 'pauta_restaurar' ELSE 'pauta_excluir' END,
          v_antes, jsonb_build_object('job_ids', to_jsonb(v_ids)));
  RETURN jsonb_build_object('ok', true, 'lote_id', v_lote, 'alterados', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.fn_pauta_desfazer(p_lote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v_n int;
BEGIN
  SELECT * INTO l FROM public.agency_pauta_lote WHERE id = p_lote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'lote_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(l.company_id);
  IF l.desfeito_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_desfeito'); END IF;
  IF l.criado_em < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_vencido', 'mensagem', 'Só dá para desfazer nas primeiras 24 horas.');
  END IF;
  IF l.user_id <> auth.uid() AND NOT public.fn_acessos_pode_gerir(l.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao', 'mensagem', 'Desfaz quem fez a ação ou o gestor.');
  END IF;
  UPDATE public.agency_jobs j SET
    responsavel_id = (a->>'responsavel_id')::uuid, data_prazo = (a->>'data_prazo')::date, status = a->>'status',
    prioridade = a->>'prioridade', excluido_em = (a->>'excluido_em')::timestamptz, excluido_por = (a->>'excluido_por')::uuid,
    updated_at = now()
  FROM jsonb_array_elements(l.antes) a
  WHERE j.id = (a->>'id')::uuid AND j.company_id = l.company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.agency_pauta_lote SET desfeito_em = now(), desfeito_por = auth.uid() WHERE id = l.id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (l.company_id, auth.uid(), 'agency_jobs', l.id::text, 'pauta_desfazer', NULL, l.antes);
  RETURN jsonb_build_object('ok', true, 'restaurados', v_n);
END $$;

REVOKE ALL ON FUNCTION public.fn_pauta_editar_em_massa(uuid, uuid[], jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pauta_excluir(uuid, uuid[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pauta_desfazer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pauta_editar_em_massa(uuid, uuid[], jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pauta_excluir(uuid, uuid[], boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pauta_desfazer(uuid) TO authenticated, service_role;

-- ───────── 4) filtro salvo por pessoa ─────────
CREATE TABLE IF NOT EXISTS public.agency_pauta_preferencia (
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  filtros       jsonb NOT NULL DEFAULT '{}'::jsonb,
  agrupar       text NOT NULL DEFAULT 'prazo' CHECK (agrupar IN ('prazo', 'cliente', 'responsavel', 'sem')),
  aba           text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
ALTER TABLE public.agency_pauta_preferencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_pauta_preferencia FROM PUBLIC, anon;
DROP POLICY IF EXISTS agency_pauta_preferencia_propria ON public.agency_pauta_preferencia;
CREATE POLICY agency_pauta_preferencia_propria ON public.agency_pauta_preferencia FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE ON public.agency_pauta_preferencia TO authenticated;

-- ───────── menu: "Pauta" no P&M (logo antes de "Jobs"), nos mesmos planos de "Jobs" ─────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES ('pm_pauta', 'Pauta', 'pm', 'pm_producao', 'ListChecks', '/dashboard/pm/pauta', 55, true,
        'Pauta de Jobs: filtro com visões salvas, abas por situação com contador, lista agrupada por prazo, ações em massa com desfazer, lixeira, impressão e planilha.',
        '3_specific', ARRAY['pm'], false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'pm_pauta' FROM public.plan_modules pm WHERE pm.module_id = 'pm_jobs'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'pm_pauta');

-- ───────── ajuda de campo ("?") da Pauta — textos no banco, editáveis sem deploy ─────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/pauta', 'pm', 'publicado'
FROM (VALUES
 ('pm.pauta.filtro.cliente', 'Filtro', 'Cliente', 'Escolha um ou mais clientes.', 'A lista e os contadores das abas mostram só os jobs desses clientes.', 'MBOX e Pdois.', 'Esquecer um cliente marcado e achar que os jobs sumiram — confira o filtro em uso no topo.', 1),
 ('pm.pauta.filtro.responsavel', 'Filtro', 'Responsável', 'Escolha quem é responsável pelos jobs. "Eu" é a primeira opção.', 'Mostra a pauta de uma pessoa ou de um grupo de pessoas.', 'Eu + Fernanda.', 'Usar o filtro de responsável quando quer só os seus: o atalho "Meus" faz isso num toque.', 2),
 ('pm.pauta.filtro.situacao', 'Filtro', 'Situação do job', '"Por abas" mostra uma aba para cada situação. Ou escolha situações específicas.', 'Separa o que não começou, o que está em produção, aguardando, em aprovação e o que já saiu.', 'Por abas.', 'Procurar um job concluído na aba "Em produção".', 3),
 ('pm.pauta.filtro.data', 'Filtro', 'Data', 'Escolha qual data usar (prazo, criação, entrega ou conclusão) e o período.', 'Recorta a pauta por semana, mês ou qualquer intervalo.', 'Prazo de 01/10 a 07/10.', 'Filtrar por prazo quando queria saber o que foi entregue (use "entrega").', 4),
 ('pm.pauta.filtro.titulo', 'Filtro', 'Título', 'Digite uma parte do título.', 'Acha o job sem saber o código.', '"reels outubro".', 'Digitar o título inteiro com erro de digitação — uma palavra basta.', 5),
 ('pm.pauta.filtro.codigo', 'Filtro', 'Código', 'Digite o número do job, com ou sem a letra da rodada.', 'Abre direto o job que o cliente citou.', '113223 ou 113223A.', 'Achar que 113223A e 113223 são jobs diferentes: a letra é só a rodada de ajuste.', 6),
 ('pm.pauta.filtro.grupo', 'Filtro', 'Grupo de clientes', 'Escolha o grupo.', 'Vê de uma vez os jobs de clientes do mesmo grupo econômico.', 'Grupo Varejo Sul.', 'Grupo vazio: os clientes precisam estar ligados ao grupo no cadastro.', 7),
 ('pm.pauta.filtro.campanha', 'Filtro', 'Campanha', 'Escolha a campanha (aparece depois de escolher o cliente ou o grupo).', 'Junta todos os jobs de uma campanha.', 'Black Friday 2026.', 'Procurar a campanha sem escolher o cliente antes.', 8),
 ('pm.pauta.filtro.fee', 'Filtro', 'Fee (contrato)', 'Escolha o contrato do cliente.', 'Mostra o que entrou no escopo daquele fee.', 'Fee mensal MBOX 2026.', 'Esperar ver jobs avulsos aqui: só entram os ligados ao contrato.', 9),
 ('pm.pauta.filtro.situacao_cliente', 'Filtro', 'Situação do cliente', 'Ativo, pausado ou encerrado.', 'Tira da pauta os clientes que pararam.', 'Só ativos.', 'Esconder um cliente pausado que ainda tem job em aprovação.', 10),
 ('pm.pauta.filtro.tipo_peca', 'Filtro', 'Tipo de peça', 'Escolha do catálogo de serviços.', 'Separa reels, carrosséis, posts etc.', 'Reels.', 'Tipo vazio: o job precisa ter o serviço preenchido.', 11),
 ('pm.pauta.filtro.aguardando', 'Filtro', 'Aguardando', 'Sim ou não, e de quem: cliente, planejamento, fornecedor ou interno.', 'Mostra o que está parado esperando alguém.', 'Aguardando cliente.', 'Confundir "aguardando" com "em aprovação": aguardando é job parado por falta de algo.', 12),
 ('pm.pauta.frase', 'Filtro', 'Descreva o que quer ver', 'Escreva com suas palavras.', 'A IA preenche o filtro para você conferir antes de aplicar. Ela nunca aplica sozinha.', '"jobs da MBOX atrasados da Fernanda".', 'Aplicar sem conferir os campos que a IA preencheu.', 13),
 ('pm.pauta.visao', 'Visões', 'Visão salva', 'Dê um nome ao filtro atual. Gestor pode compartilhar com a equipe.', 'Volta ao mesmo filtro com um toque.', '"Atrasados da equipe".', 'Salvar uma visão pessoal achando que a equipe vai ver: só as compartilhadas aparecem para todos.', 14),
 ('pm.pauta.agrupar', 'Lista', 'Agrupar por', 'Prazo (padrão), cliente, responsável ou sem agrupar.', 'Organiza a lista do jeito que você trabalha. Atrasados ficam sempre no topo no agrupamento por prazo.', 'Por responsável para montar a pauta do dia.', 'Achar que um job sumiu quando ele está em outro grupo.', 15),
 ('pm.pauta.massa.responsavel', 'Edição em massa', 'Responsável', 'Escolha a pessoa que assume os jobs marcados.', 'Redistribui a pauta de uma vez (férias, sobrecarga).', 'Passar 5 jobs da Fernanda para o Lucas.', 'Esquecer de avisar a pessoa — dá para desfazer em até 24 h.', 16),
 ('pm.pauta.massa.prazo', 'Edição em massa', 'Prazo', 'Escolha a nova data de prazo.', 'Remarca vários jobs juntos.', 'Adiar para segunda os jobs parados por material do cliente.', 'Estender prazo sem registrar o motivo com o cliente.', 17),
 ('pm.pauta.massa.situacao', 'Edição em massa', 'Situação', 'Escolha a nova situação.', 'Move vários jobs de etapa de uma vez.', 'Marcar como publicados os posts que já saíram.', 'Mover para "Concluída" job que ainda espera aprovação.', 18),
 ('pm.pauta.selecao', 'Lista', 'Selecionar jobs', 'Marque os jobs (ou "Selecionar todos") para agir em vários de uma vez.', 'Edição em massa, envio para a lixeira e restauração valem para os marcados.', 'Marcar os 5 jobs atrasados da Fernanda e passar para o Lucas.', 'Esquecer jobs marcados de outra aba: a seleção vale só para a lista que está na tela.', 20),
 ('pm.pauta.massa.prioridade', 'Edição em massa', 'Prioridade', 'Baixa, média, alta ou crítica.', 'Ordena o que a equipe ataca primeiro.', 'Alta para os jobs da campanha que estreia amanhã.', 'Marcar tudo como crítico: aí nada é prioridade.', 19)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
