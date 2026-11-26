-- P&M · tela 5 (Catálogo de Serviços) · P5.1 "Template de etapas por serviço"
-- Go-live da agência piloto (CEO 25/11) · tela 135 slice 1 (backend)
--
-- Base para "tempo medido sem clique": cada serviço do catálogo tem seu modelo
-- de etapas (ex.: briefing, criação, revisão interna, aprovação do cliente,
-- publicação). O job nasce com essas etapas (feito em PR seguinte). Cada etapa
-- pode ou não ter o tempo de calendário medido sozinho.
--
-- Migration ADITIVA e idempotente: cria tabela nova + RLS por company_id +
-- REVOKE anon + 3 RPCs (listar/salvar/excluir) no padrão fn_agency_* existente.
-- NÃO altera tabela, função, RLS, grant ou dado existente.

-- ── Tabela: template de etapas por serviço ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_servico_etapa (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  servico_id   uuid NOT NULL REFERENCES public.agency_servico(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  descricao    text,
  ordem        integer NOT NULL DEFAULT 0,
  -- quando true, o tempo de calendário desta etapa é medido sozinho (sem clique)
  medir_tempo  boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_agency_servico_etapa_servico
  ON public.agency_servico_etapa (servico_id, ordem);
CREATE INDEX IF NOT EXISTS ix_agency_servico_etapa_company
  ON public.agency_servico_etapa (company_id);

ALTER TABLE public.agency_servico_etapa ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='agency_servico_etapa'
      AND policyname='p_agency_servico_etapa_tenant'
  ) THEN
    CREATE POLICY p_agency_servico_etapa_tenant ON public.agency_servico_etapa
      FOR ALL
      USING  ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
      WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());
  END IF;
END $$;

REVOKE ALL ON public.agency_servico_etapa FROM anon;

-- ── RPC: listar etapas-modelo de um serviço ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_servico_etapa_listar(
  p_company_id uuid, p_servico_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordem, e.criado_em), '[]'::jsonb) INTO v
    FROM public.agency_servico_etapa e
   WHERE e.company_id = p_company_id AND e.servico_id = p_servico_id;
  RETURN jsonb_build_object('ok', true, 'etapas', v);
END $function$;

-- ── RPC: salvar (upsert) uma etapa-modelo ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_servico_etapa_salvar(
  p_company_id uuid, p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid := NULLIF(p_payload->>'id','')::uuid;
  v_servico  uuid := NULLIF(p_payload->>'servico_id','')::uuid;
  r public.agency_servico_etapa;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  IF COALESCE(btrim(p_payload->>'nome'),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF v_servico IS NULL THEN RAISE EXCEPTION 'servico_obrigatorio'; END IF;
  -- o serviço precisa ser da própria empresa
  IF NOT EXISTS (SELECT 1 FROM public.agency_servico s
                 WHERE s.id = v_servico AND s.company_id = p_company_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'servico_nao_encontrado';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.agency_servico_etapa (company_id, servico_id, nome, descricao, ordem, medir_tempo)
    VALUES (p_company_id, v_servico, btrim(p_payload->>'nome'),
            NULLIF(btrim(p_payload->>'descricao'),''),
            COALESCE(NULLIF(p_payload->>'ordem','')::int, 0),
            COALESCE((p_payload->>'medir_tempo')::boolean, true))
    RETURNING * INTO r;
  ELSE
    UPDATE public.agency_servico_etapa
       SET nome          = btrim(p_payload->>'nome'),
           descricao     = NULLIF(btrim(p_payload->>'descricao'),''),
           ordem         = COALESCE(NULLIF(p_payload->>'ordem','')::int, ordem),
           medir_tempo   = COALESCE((p_payload->>'medir_tempo')::boolean, medir_tempo),
           atualizado_em = now()
     WHERE id = v_id AND company_id = p_company_id AND servico_id = v_servico
    RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $function$;

-- ── RPC: excluir uma etapa-modelo ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_servico_etapa_excluir(
  p_company_id uuid, p_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  DELETE FROM public.agency_servico_etapa
   WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── Grants: nega anon, libera authenticated (padrão fn_agency_*) ──────────────
REVOKE ALL ON FUNCTION public.fn_agency_servico_etapa_listar(uuid, uuid)  FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_agency_servico_etapa_salvar(uuid, jsonb) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_agency_servico_etapa_excluir(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_etapa_listar(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_etapa_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_etapa_excluir(uuid, uuid) TO authenticated;
