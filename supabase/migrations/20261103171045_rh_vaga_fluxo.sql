-- Fluxo de VAGA (abertura de posição de quadro) — camada de dados.
-- Tarefa eng_chefe (512538f6): RH abre a vaga (status=solicitada); SÓ a DIRETORIA aprova/recusa
-- (role IN acesso_total,diretor,diretor_area,owner); o solicitante NUNCA aprova a própria.
-- Projetado×Real como fonte: repor posição do quadro projetado (origem='reposicao') NÃO precisa de
-- nova aprovação (entra 'aprovada'); CRIAR posição acima do quadro (origem='criacao') precisa (entra 'solicitada').
-- ADITIVA: tabela nova (RLS por company_id, REVOKE anon, escrita só por função com guarda de papel).
-- Nenhuma função/view/policy existente é alterada. UI em PR seguinte.

CREATE TABLE IF NOT EXISTS public.rh_vaga (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  setor_id        uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE RESTRICT,
  cargo_id        uuid NOT NULL REFERENCES public.prod_cargo(id) ON DELETE RESTRICT,
  posto_id        uuid,                    -- posto do quadro que origina a reposição (opcional)
  quantidade      integer NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  custo_estimado  numeric(14,2),
  justificativa   text,
  origem          text NOT NULL DEFAULT 'criacao' CHECK (origem IN ('reposicao','criacao')),
  status          text NOT NULL DEFAULT 'solicitada'
                    CHECK (status IN ('solicitada','aprovada','recusada','cancelada')),
  solicitante     uuid,
  solicitado_em   timestamptz NOT NULL DEFAULT now(),
  aprovador       uuid,
  decidido_em     timestamptz,
  decisao_motivo  text,
  deleted_at      timestamptz,
  CONSTRAINT ck_rh_vaga_solicitante_ne_aprovador
    CHECK (aprovador IS NULL OR solicitante IS NULL OR aprovador IS DISTINCT FROM solicitante)
);
CREATE INDEX IF NOT EXISTS idx_rh_vaga_empresa_status
  ON public.rh_vaga (company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rh_vaga_setor ON public.rh_vaga (setor_id);
CREATE INDEX IF NOT EXISTS idx_rh_vaga_cargo ON public.rh_vaga (cargo_id);

ALTER TABLE public.rh_vaga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_vaga_select ON public.rh_vaga;
CREATE POLICY rh_vaga_select ON public.rh_vaga
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.rh_vaga FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.rh_vaga FROM authenticated;
GRANT SELECT ON public.rh_vaga TO authenticated;
GRANT ALL ON public.rh_vaga TO service_role;

-- Quem pode DECIDIR (aprovar/recusar): só a diretoria da empresa (+ admin global / CLIENT_OWNER do tenant).
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_pode_decidir(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_admin(), false)
      OR EXISTS (SELECT 1 FROM public.user_companies uc
                  WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
                    AND lower(uc.role) IN ('acesso_total','diretor','diretor_area','owner'))
      OR EXISTS (SELECT 1 FROM public.tenant_user_roles t
                  WHERE t.user_id = auth.uid() AND t.company_id = p_company_id
                    AND t.role = 'CLIENT_OWNER' AND t.is_active = true)
$$;

-- Abrir vaga. origem='reposicao' entra 'aprovada' (não exige diretoria); 'criacao' entra 'solicitada'.
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_abrir(p_company_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_setor uuid; v_cargo uuid; v_posto uuid; v_qtd integer; v_custo numeric(14,2);
  v_just text; v_origem text; v_status text; v_aprovador uuid; v_decidido timestamptz; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  v_setor  := NULLIF(p_payload->>'setor_id','')::uuid;
  v_cargo  := NULLIF(p_payload->>'cargo_id','')::uuid;
  v_posto  := NULLIF(p_payload->>'posto_id','')::uuid;
  v_qtd    := COALESCE((p_payload->>'quantidade')::integer, 1);
  v_custo  := NULLIF(p_payload->>'custo_estimado','')::numeric;
  v_just   := NULLIF(btrim(p_payload->>'justificativa'),'');
  v_origem := lower(COALESCE(NULLIF(p_payload->>'origem',''),'criacao'));

  IF v_setor IS NULL OR v_cargo IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Setor e cargo são obrigatórios');
  END IF;
  IF v_origem NOT IN ('reposicao','criacao') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Origem inválida');
  END IF;
  IF v_qtd < 1 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Quantidade deve ser pelo menos 1');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_setor WHERE id = v_setor AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Setor não pertence a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_cargo WHERE id = v_cargo AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Cargo não pertence a esta empresa');
  END IF;

  IF v_origem = 'reposicao' THEN
    v_status := 'aprovada'; v_aprovador := NULL; v_decidido := now();   -- reposição do quadro não exige nova aprovação
  ELSE
    v_status := 'solicitada'; v_aprovador := NULL; v_decidido := NULL;  -- criação acima do quadro aguarda a diretoria
  END IF;

  INSERT INTO public.rh_vaga
    (company_id, setor_id, cargo_id, posto_id, quantidade, custo_estimado, justificativa,
     origem, status, solicitante, aprovador, decidido_em)
  VALUES
    (p_company_id, v_setor, v_cargo, v_posto, v_qtd, v_custo, v_just,
     v_origem, v_status, auth.uid(), v_aprovador, v_decidido)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'status', v_status);
END $$;

-- Decidir (aprovar/recusar): só a diretoria; o solicitante nunca decide a própria; só de 'solicitada'.
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_decidir(p_vaga_id uuid, p_decisao text, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record; v_dec text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.rh_vaga WHERE id = p_vaga_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Vaga não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF NOT public.fn_rh_vaga_pode_decidir(v.company_id) THEN
    RAISE EXCEPTION 'Somente a diretoria pode aprovar ou recusar vagas' USING ERRCODE = '42501';
  END IF;
  IF v.solicitante IS NOT NULL AND v.solicitante = auth.uid() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O solicitante não pode decidir a própria vaga');
  END IF;
  IF v.status <> 'solicitada' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Só é possível decidir uma vaga em análise');
  END IF;
  v_dec := lower(COALESCE(p_decisao,''));
  IF v_dec NOT IN ('aprovada','recusada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Decisão deve ser aprovada ou recusada');
  END IF;

  UPDATE public.rh_vaga
     SET status = v_dec, aprovador = auth.uid(), decidido_em = now(),
         decisao_motivo = NULLIF(btrim(p_motivo),'')
   WHERE id = p_vaga_id;
  RETURN jsonb_build_object('sucesso', true, 'status', v_dec);
END $$;

-- Cancelar: o solicitante ou a diretoria, enquanto 'solicitada' (soft-delete rastreável — RD-98).
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_cancelar(p_vaga_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.rh_vaga WHERE id = p_vaga_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Vaga não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF NOT (public.fn_rh_vaga_pode_decidir(v.company_id)
          OR (v.solicitante IS NOT NULL AND v.solicitante = auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar esta vaga' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'solicitada' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Só é possível cancelar uma vaga em análise');
  END IF;
  UPDATE public.rh_vaga
     SET status = 'cancelada', decisao_motivo = NULLIF(btrim(p_motivo),''),
         deleted_at = now(), decidido_em = now(), aprovador = auth.uid()
   WHERE id = p_vaga_id;
  RETURN jsonb_build_object('sucesso', true, 'status', 'cancelada');
END $$;

-- Listar vagas da empresa (com nomes de setor/cargo e o flag pode_decidir para a UI).
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_listar(p_company_id uuid, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_itens jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.solicitado_em DESC), '[]'::jsonb) INTO v_itens
  FROM (
    SELECT va.id, va.setor_id, s.nome AS setor_nome, va.cargo_id, c.nome AS cargo_nome,
           va.posto_id, va.quantidade, va.custo_estimado, va.justificativa, va.origem,
           va.status, va.solicitante, va.solicitado_em, va.aprovador, va.decidido_em, va.decisao_motivo
      FROM public.rh_vaga va
      LEFT JOIN public.prod_setor s ON s.id = va.setor_id
      LEFT JOIN public.prod_cargo c ON c.id = va.cargo_id
     WHERE va.company_id = p_company_id
       AND va.deleted_at IS NULL
       AND (p_status IS NULL OR va.status = p_status)
  ) x;
  RETURN jsonb_build_object('itens', v_itens, 'pode_decidir', public.fn_rh_vaga_pode_decidir(p_company_id));
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_rh_vaga_pode_decidir(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_rh_vaga_abrir(uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_rh_vaga_decidir(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_rh_vaga_cancelar(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_rh_vaga_listar(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_pode_decidir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_abrir(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_decidir(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_cancelar(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_listar(uuid, text) TO authenticated, service_role;
