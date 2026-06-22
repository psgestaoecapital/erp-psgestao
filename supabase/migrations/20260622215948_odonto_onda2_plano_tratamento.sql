-- ===== PLANO DE TRATAMENTO (cabeçalho) =====
CREATE TABLE IF NOT EXISTS public.erp_odonto_plano_tratamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  profissional_id uuid REFERENCES public.erp_odonto_profissional(id) ON DELETE SET NULL,
  titulo text,
  status text NOT NULL DEFAULT 'orcamento'
    CHECK (status IN ('rascunho','orcamento','aprovado','em_andamento','concluido','cancelado')),
  desconto numeric(12,2) NOT NULL DEFAULT 0,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  condicao_pagamento text,
  observacao text,
  aprovado_em timestamptz,
  aprovado_por text,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== ITENS (procedimento por dente/face) =====
CREATE TABLE IF NOT EXISTS public.erp_odonto_plano_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plano_id uuid NOT NULL REFERENCES public.erp_odonto_plano_tratamento(id) ON DELETE CASCADE,
  procedimento_id uuid REFERENCES public.erp_odonto_procedimento(id) ON DELETE SET NULL,
  descricao text,
  dente text,    -- FDI: '11'..'48' / '51'..'85' / NULL (geral)
  faces text,    -- ex 'OV','MD' / NULL
  valor numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposto'
    CHECK (status IN ('proposto','aprovado','em_andamento','concluido','cancelado')),
  ordem int NOT NULL DEFAULT 0,
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_odonto_plano_pac  ON public.erp_odonto_plano_tratamento (company_id, paciente_id);
CREATE INDEX IF NOT EXISTS idx_odonto_plano_item ON public.erp_odonto_plano_item (plano_id);

-- RLS + triggers
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_odonto_plano_tratamento','erp_odonto_plano_item'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_pol', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()))$p$, t||'_pol', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()', t, t);
  END LOOP;
END $$;

-- ===== RPCs =====
CREATE OR REPLACE FUNCTION public.fn_odonto_plano_salvar(
  p_company_id uuid, p_plano jsonb, p_itens jsonb, p_plano_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid := p_plano_id; it jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_plano_tratamento
      (company_id,paciente_id,profissional_id,titulo,status,desconto,condicao_pagamento,observacao,criado_por)
    VALUES (p_company_id,(p_plano->>'paciente_id')::uuid,NULLIF(p_plano->>'profissional_id','')::uuid,
            p_plano->>'titulo',COALESCE(p_plano->>'status','orcamento'),
            COALESCE((p_plano->>'desconto')::numeric,0),p_plano->>'condicao_pagamento',p_plano->>'observacao',auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_plano_tratamento SET
      profissional_id=NULLIF(p_plano->>'profissional_id','')::uuid, titulo=p_plano->>'titulo',
      status=COALESCE(p_plano->>'status',status), desconto=COALESCE((p_plano->>'desconto')::numeric,desconto),
      condicao_pagamento=p_plano->>'condicao_pagamento', observacao=p_plano->>'observacao'
    WHERE id=v_id AND company_id=p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plano nao encontrado'; END IF;
  END IF;
  DELETE FROM erp_odonto_plano_item WHERE plano_id=v_id;
  FOR it IN SELECT value FROM jsonb_array_elements(COALESCE(p_itens,'[]'::jsonb)) AS value LOOP
    INSERT INTO erp_odonto_plano_item (company_id,plano_id,procedimento_id,descricao,dente,faces,valor,ordem)
    VALUES (p_company_id,v_id,NULLIF(it->>'procedimento_id','')::uuid,it->>'descricao',
            NULLIF(it->>'dente',''),NULLIF(it->>'faces',''),COALESCE((it->>'valor')::numeric,0),COALESCE((it->>'ordem')::int,0));
  END LOOP;
  UPDATE erp_odonto_plano_tratamento p
    SET valor_total = GREATEST(0,(SELECT COALESCE(SUM(valor),0) FROM erp_odonto_plano_item WHERE plano_id=v_id) - p.desconto)
    WHERE id=v_id;
  RETURN json_build_object('ok',true,'id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_odonto_plano_obter(p_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT json_build_object(
    'plano',(SELECT to_jsonb(p) FROM erp_odonto_plano_tratamento p WHERE p.id=p_id),
    'paciente',(SELECT json_build_object('id',pa.id,'nome',pa.nome)
                FROM erp_odonto_plano_tratamento p JOIN erp_odonto_paciente pa ON pa.id=p.paciente_id WHERE p.id=p_id),
    'itens',(SELECT COALESCE(json_agg(json_build_object('id',i.id,'procedimento_id',i.procedimento_id,
              'descricao',i.descricao,'dente',i.dente,'faces',i.faces,'valor',i.valor,'status',i.status,'ordem',i.ordem) ORDER BY i.ordem),'[]'::json)
            FROM erp_odonto_plano_item i WHERE i.plano_id=p_id));
$$;

CREATE OR REPLACE FUNCTION public.fn_odonto_planos_paciente(p_company_id uuid, p_paciente_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(json_agg(json_build_object('id',id,'titulo',titulo,'status',status,'valor_total',valor_total,'criado_em',created_at) ORDER BY created_at DESC),'[]'::json)
  FROM erp_odonto_plano_tratamento WHERE company_id=p_company_id AND paciente_id=p_paciente_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_odonto_plano_aprovar(p_id uuid, p_aprovado_por text)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  UPDATE erp_odonto_plano_tratamento
    SET status='aprovado', aprovado_em=now(), aprovado_por=COALESCE(NULLIF(trim(p_aprovado_por),''),'Paciente')
    WHERE id=p_id AND status IN ('rascunho','orcamento');
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano nao encontrado ou ja aprovado'; END IF;
  UPDATE erp_odonto_plano_item SET status='aprovado' WHERE plano_id=p_id AND status='proposto';
  RETURN json_build_object('ok',true,'id',p_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_odonto_item_status(p_item_id uuid, p_status text)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_status NOT IN ('proposto','aprovado','em_andamento','concluido','cancelado') THEN RAISE EXCEPTION 'Status invalido'; END IF;
  UPDATE erp_odonto_plano_item
    SET status=p_status, concluido_em = CASE WHEN p_status='concluido' THEN now() ELSE NULL END
    WHERE id=p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item nao encontrado'; END IF;
  RETURN json_build_object('ok',true,'id',p_item_id,'status',p_status);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_salvar(uuid,jsonb,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_obter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_planos_paciente(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_aprovar(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_item_status(uuid,text) TO authenticated;
