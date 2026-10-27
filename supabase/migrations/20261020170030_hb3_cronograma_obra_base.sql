-- HB3 (fatia 1): cronograma da obra — tarefas com datas, dependências e linha de base.
-- Só objetos NOVOS. RLS por empresa, REVOKE anon, gravação só pelas funções com guarda de empresa, exclusão lógica (RD-30).
CREATE TABLE IF NOT EXISTS public.projetos_obra_tarefa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id),
  pai_id         uuid REFERENCES public.projetos_obra_tarefa(id),
  nome           text NOT NULL CHECK (length(btrim(nome)) > 0),
  inicio         date NOT NULL,
  fim            date NOT NULL,
  percentual     numeric(5,2) NOT NULL DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
  inicio_base    date,
  fim_base       date,
  ordem          integer NOT NULL DEFAULT 0,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por   uuid,
  CHECK (fim >= inicio)
);
CREATE INDEX IF NOT EXISTS projetos_obra_tarefa_idx
  ON public.projetos_obra_tarefa (company_id, obra_id, ordem) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.projetos_obra_tarefa_dependencia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tarefa_id      uuid NOT NULL REFERENCES public.projetos_obra_tarefa(id),
  predecessora_id uuid NOT NULL REFERENCES public.projetos_obra_tarefa(id),
  defasagem_dias integer NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  CHECK (tarefa_id <> predecessora_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS projetos_obra_tarefa_dep_uq
  ON public.projetos_obra_tarefa_dependencia (tarefa_id, predecessora_id) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos_obra_tarefa_dependencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_tarefa, public.projetos_obra_tarefa_dependencia FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_tarefa_ler ON public.projetos_obra_tarefa;
CREATE POLICY projetos_obra_tarefa_ler ON public.projetos_obra_tarefa FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS projetos_obra_tarefa_dep_ler ON public.projetos_obra_tarefa_dependencia;
CREATE POLICY projetos_obra_tarefa_dep_ler ON public.projetos_obra_tarefa_dependencia FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_tarefa, public.projetos_obra_tarefa_dependencia TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_salvar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_id uuid := NULLIF(p_dados->>'id','')::uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_id IS NULL THEN
    INSERT INTO public.projetos_obra_tarefa (company_id, obra_id, pai_id, nome, inicio, fim, percentual, ordem, criado_por)
    VALUES (v_company, p_obra_id, NULLIF(p_dados->>'pai_id','')::uuid, p_dados->>'nome',
      (p_dados->>'inicio')::date, (p_dados->>'fim')::date,
      COALESCE((p_dados->>'percentual')::numeric, 0), COALESCE((p_dados->>'ordem')::int, 0), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_tarefa SET
      nome = COALESCE(p_dados->>'nome', nome),
      inicio = COALESCE((p_dados->>'inicio')::date, inicio),
      fim = COALESCE((p_dados->>'fim')::date, fim),
      percentual = COALESCE((p_dados->>'percentual')::numeric, percentual),
      ordem = COALESCE((p_dados->>'ordem')::int, ordem)
    WHERE id = v_id AND obra_id = p_obra_id AND company_id = v_company AND excluido_em IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_salvar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_tarefa WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_tarefa SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  UPDATE public.projetos_obra_tarefa_dependencia SET excluido_em = now()
   WHERE (tarefa_id = p_id OR predecessora_id = p_id) AND excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_excluir(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_dependencia_salvar(p_tarefa_id uuid, p_predecessora_id uuid, p_defasagem integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_company2 uuid; v_ciclo boolean;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_tarefa WHERE id = p_tarefa_id AND excluido_em IS NULL;
  SELECT company_id INTO v_company2 FROM public.projetos_obra_tarefa WHERE id = p_predecessora_id AND excluido_em IS NULL;
  IF v_company IS NULL OR v_company2 IS DISTINCT FROM v_company THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  -- sem ciclo: a predecessora não pode depender (direta ou indiretamente) da tarefa
  WITH RECURSIVE cadeia AS (
    SELECT predecessora_id AS id FROM public.projetos_obra_tarefa_dependencia
     WHERE tarefa_id = p_predecessora_id AND excluido_em IS NULL
    UNION
    SELECT d.predecessora_id FROM public.projetos_obra_tarefa_dependencia d
      JOIN cadeia c ON d.tarefa_id = c.id WHERE d.excluido_em IS NULL)
  SELECT EXISTS (SELECT 1 FROM cadeia WHERE id = p_tarefa_id) INTO v_ciclo;
  IF v_ciclo THEN RAISE EXCEPTION 'Dependência circular'; END IF;
  INSERT INTO public.projetos_obra_tarefa_dependencia (company_id, tarefa_id, predecessora_id, defasagem_dias)
  VALUES (v_company, p_tarefa_id, p_predecessora_id, COALESCE(p_defasagem, 0))
  ON CONFLICT (tarefa_id, predecessora_id) WHERE excluido_em IS NULL
  DO UPDATE SET defasagem_dias = EXCLUDED.defasagem_dias;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_dependencia_salvar(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_dependencia_salvar(uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_cronograma_linha_base(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_n integer;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_tarefa SET inicio_base = inicio, fim_base = fim
   WHERE obra_id = p_obra_id AND company_id = v_company AND excluido_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'tarefas', v_n);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_cronograma_linha_base(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_cronograma_linha_base(uuid) TO authenticated, service_role;
