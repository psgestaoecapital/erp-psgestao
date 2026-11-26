-- P&M · tela 135 "Tempo medido sem clique" (CEO 25/11, go-live da agência piloto)
-- Slice: "o job nasce com as etapas do serviço; cada etapa com situação própria e
--         registro de entrada/saída (tempo de calendário por etapa, sem clique)".
--
-- Slice 1 (já na main: 20261127130645_pm_servico_etapa_template) criou o MODELO de
-- etapas por serviço (agency_servico_etapa). Esta migration cria a INSTÂNCIA por job:
-- quando um job do catálogo tem serviço e esse serviço tem modelo de etapas, o job
-- ganha as etapas do modelo na primeira vez que são lidas (sem clique do usuário).
-- Cada etapa registra entrada/saída por CALENDÁRIO (iniciada_em/concluida_em) — base do
-- esforço inferido sem a pessoa marcar hora.
--
-- Migration ADITIVA e idempotente (RD-94.1): cria tabela NOVA + RLS por company_id +
-- REVOKE anon + 2 RPCs novas (listar com instanciação preguiçosa e idempotente; mudar
-- situação com carimbo de tempo). NÃO altera tabela, função, RLS, grant, trigger ou
-- dado existente. Como hoje há 0 modelos de etapa (agency_servico_etapa vazia, provado
-- no PR), o deploy não cria nenhuma linha nem toca dado de empresa.
-- Code: desenvolvedor_4_g

-- ── Tabela: etapas instanciadas por job ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_job_etapa (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  job_id           uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  -- etapa-modelo que originou esta instância (null quando criada à mão no job)
  servico_etapa_id uuid REFERENCES public.agency_servico_etapa(id) ON DELETE SET NULL,
  nome             text NOT NULL,
  descricao        text,
  ordem            integer NOT NULL DEFAULT 0,
  -- quando true, o tempo de calendário desta etapa é medido sozinho (sem clique)
  medir_tempo      boolean NOT NULL DEFAULT true,
  -- nao_iniciada -> em_andamento -> concluida
  situacao         text NOT NULL DEFAULT 'nao_iniciada'
                   CHECK (situacao IN ('nao_iniciada','em_andamento','concluida')),
  iniciada_em      timestamptz,   -- entrada por calendário (1ª vez em em_andamento)
  concluida_em     timestamptz,   -- saída por calendário (ao concluir)
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_agency_job_etapa_job
  ON public.agency_job_etapa (job_id, ordem);
CREATE INDEX IF NOT EXISTS ix_agency_job_etapa_company
  ON public.agency_job_etapa (company_id);
-- impede instanciar o mesmo modelo de etapa duas vezes no mesmo job (idempotência)
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_job_etapa_modelo
  ON public.agency_job_etapa (job_id, servico_etapa_id)
  WHERE servico_etapa_id IS NOT NULL;

ALTER TABLE public.agency_job_etapa ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='agency_job_etapa'
      AND policyname='p_agency_job_etapa_tenant'
  ) THEN
    CREATE POLICY p_agency_job_etapa_tenant ON public.agency_job_etapa
      FOR ALL
      USING  ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
      WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());
  END IF;
END $$;

REVOKE ALL ON public.agency_job_etapa FROM anon;
GRANT SELECT ON public.agency_job_etapa TO authenticated;

-- ── RPC: listar etapas do job (instancia do modelo na 1ª leitura, idempotente) ─
CREATE OR REPLACE FUNCTION public.fn_agency_job_etapas_listar(
  p_company_id uuid, p_job_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_servico uuid;
  v         jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  -- o job precisa ser da própria empresa
  SELECT j.servico_id INTO v_servico
    FROM public.agency_jobs j
   WHERE j.id = p_job_id AND j.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_nao_encontrado'; END IF;

  -- instancia o modelo só se o job ainda não tem NENHUMA etapa e o serviço tem modelo
  IF v_servico IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_job_etapa e WHERE e.job_id = p_job_id)
  THEN
    INSERT INTO public.agency_job_etapa
      (company_id, job_id, servico_etapa_id, nome, descricao, ordem, medir_tempo)
    SELECT p_company_id, p_job_id, m.id, m.nome, m.descricao, m.ordem, m.medir_tempo
      FROM public.agency_servico_etapa m
     WHERE m.company_id = p_company_id AND m.servico_id = v_servico
    ON CONFLICT (job_id, servico_etapa_id) WHERE servico_etapa_id IS NOT NULL DO NOTHING;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordem, e.criado_em), '[]'::jsonb) INTO v
    FROM public.agency_job_etapa e
   WHERE e.company_id = p_company_id AND e.job_id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'etapas', v);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_job_etapas_listar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_job_etapas_listar(uuid, uuid) TO authenticated, service_role;

-- ── RPC: mudar situação de uma etapa (carimba entrada/saída por calendário) ────
CREATE OR REPLACE FUNCTION public.fn_agency_job_etapa_situacao(
  p_company_id uuid, p_etapa_id uuid, p_situacao text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.agency_job_etapa;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  IF p_situacao NOT IN ('nao_iniciada','em_andamento','concluida') THEN
    RAISE EXCEPTION 'situacao_invalida';
  END IF;

  UPDATE public.agency_job_etapa e
     SET situacao      = p_situacao,
         -- entrada por calendário: carimba na 1ª vez que entra em andamento
         iniciada_em   = CASE
                           WHEN p_situacao = 'nao_iniciada' THEN NULL
                           WHEN e.iniciada_em IS NULL THEN now()
                           ELSE e.iniciada_em
                         END,
         -- saída por calendário: carimba ao concluir; limpa se voltar atrás
         concluida_em  = CASE WHEN p_situacao = 'concluida' THEN now() ELSE NULL END,
         atualizado_em = now()
   WHERE e.id = p_etapa_id AND e.company_id = p_company_id
  RETURNING e.* INTO r;

  IF NOT FOUND THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  RETURN jsonb_build_object('ok', true, 'etapa', to_jsonb(r));
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_job_etapa_situacao(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_job_etapa_situacao(uuid, uuid, text) TO authenticated, service_role;
