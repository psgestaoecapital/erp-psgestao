-- ============================================================
-- AGRO · Onda 2 — Manejo, Pesagem (GMD) e Reproducao
-- ============================================================

-- 1) PESAGEM
CREATE TABLE IF NOT EXISTS public.erp_pec_pesagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  propriedade_id uuid NOT NULL,
  animal_id uuid NOT NULL REFERENCES public.erp_pec_animal(id) ON DELETE CASCADE,
  data date NOT NULL,
  peso_kg numeric NOT NULL CHECK (peso_kg > 0),
  metodo text NOT NULL DEFAULT 'balanca' CHECK (metodo IN ('balanca','visual','fita','estimado')),
  observacao text,
  ref_externa_sistema text,
  ref_externa_id text,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_pesagem_animal_data
  ON public.erp_pec_pesagem (company_id, animal_id, data DESC);

-- 2) REPRODUCAO (historico; estado atual = ultimo evento por animal)
CREATE TABLE IF NOT EXISTS public.erp_pec_repro_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  propriedade_id uuid NOT NULL,
  animal_id uuid NOT NULL REFERENCES public.erp_pec_animal(id) ON DELETE CASCADE,
  data date NOT NULL,
  estado text NOT NULL CHECK (estado IN ('prenha','vazia','iatf','parida','descarte_repro','indefinido')),
  touro_id uuid,
  dg_metodo text CHECK (dg_metodo IN ('toque','ecografia','visual')),
  previsao_parto date,
  observacao text,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_repro_animal_data
  ON public.erp_pec_repro_evento (company_id, animal_id, data DESC);

-- RLS + trigger updated_at
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_pec_pesagem','erp_pec_repro_evento']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_pol ON public.%I;', t, t);
    EXECUTE format($p$CREATE POLICY %I_pol ON public.%I FOR ALL TO authenticated
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));$p$, t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();', t, t);
  END LOOP;
END $$;

-- 3) RPC: registrar pesagem
CREATE OR REPLACE FUNCTION public.fn_pec_pesagem_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_animal_id uuid,
  p_data date, p_peso_kg numeric, p_metodo text DEFAULT 'balanca',
  p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  SELECT EXISTS(SELECT 1 FROM erp_pec_animal WHERE id=p_animal_id AND company_id=p_company_id) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Animal nao pertence a esta empresa'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_pec_pesagem(company_id,propriedade_id,animal_id,data,peso_kg,metodo,observacao,criado_por)
    VALUES (p_company_id,p_propriedade_id,p_animal_id,p_data,p_peso_kg,COALESCE(p_metodo,'balanca'),p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_pesagem
      SET data=p_data, peso_kg=p_peso_kg, metodo=COALESCE(p_metodo,'balanca'), observacao=p_observacao
      WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- 4) RPC: registrar evento reprodutivo
CREATE OR REPLACE FUNCTION public.fn_pec_repro_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_animal_id uuid,
  p_data date, p_estado text, p_dg_metodo text DEFAULT NULL,
  p_touro_id uuid DEFAULT NULL, p_previsao_parto date DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  SELECT EXISTS(SELECT 1 FROM erp_pec_animal WHERE id=p_animal_id AND company_id=p_company_id) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Animal nao pertence a esta empresa'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_pec_repro_evento(company_id,propriedade_id,animal_id,data,estado,dg_metodo,touro_id,previsao_parto,observacao,criado_por)
    VALUES (p_company_id,p_propriedade_id,p_animal_id,p_data,p_estado,p_dg_metodo,p_touro_id,p_previsao_parto,p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_repro_evento
      SET data=p_data, estado=p_estado, dg_metodo=p_dg_metodo, touro_id=p_touro_id,
          previsao_parto=p_previsao_parto, observacao=p_observacao
      WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- 5) RPC: historico de pesagem + GMD por animal
CREATE OR REPLACE FUNCTION public.fn_pec_pesagem_historico(p_company_id uuid, p_animal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_entrada record; v_pontos jsonb := '[]'::jsonb; v_gmd numeric; r record; v_ant_peso numeric; v_ant_data date;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','Sem permissao'); END IF;

  -- ponto inicial: entrada do animal (se houver peso_entrada_kg)
  SELECT peso_entrada_kg, data_entrada INTO v_entrada
    FROM erp_pec_animal WHERE id=p_animal_id AND company_id=p_company_id;
  IF v_entrada.peso_entrada_kg IS NOT NULL AND v_entrada.peso_entrada_kg > 0 THEN
    v_pontos := v_pontos || jsonb_build_array(jsonb_build_object(
      'data', v_entrada.data_entrada, 'peso_kg', v_entrada.peso_entrada_kg, 'origem', 'entrada', 'gmd', NULL));
    v_ant_peso := v_entrada.peso_entrada_kg;
    v_ant_data := v_entrada.data_entrada;
  END IF;

  FOR r IN
    SELECT id, data, peso_kg, metodo FROM erp_pec_pesagem
    WHERE company_id=p_company_id AND animal_id=p_animal_id
    ORDER BY data ASC, created_at ASC
  LOOP
    v_gmd := NULL;
    IF v_ant_peso IS NOT NULL AND v_ant_data IS NOT NULL AND (r.data - v_ant_data) > 0 THEN
      v_gmd := round((r.peso_kg - v_ant_peso) / (r.data - v_ant_data)::numeric, 3);
    END IF;
    v_pontos := v_pontos || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'data', r.data, 'peso_kg', r.peso_kg, 'metodo', r.metodo, 'gmd', v_gmd));
    v_ant_peso := r.peso_kg;
    v_ant_data := r.data;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'pontos', v_pontos);
END $$;

-- 6) RPC: painel de manejo
CREATE OR REPLACE FUNCTION public.fn_pec_manejo_painel(p_company_id uuid, p_propriedade_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_total int; v_pesados_30d int; v_sem_pesagem int;
        v_peso_cat jsonb; v_gmd_medio numeric; v_repro jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','Sem permissao'); END IF;

  SELECT count(*) INTO v_total FROM erp_pec_animal
    WHERE company_id=p_company_id AND propriedade_id=p_propriedade_id AND status='ativo';

  SELECT count(DISTINCT animal_id) INTO v_pesados_30d
    FROM erp_pec_pesagem WHERE company_id=p_company_id AND propriedade_id=p_propriedade_id
      AND data >= CURRENT_DATE - INTERVAL '30 days';

  SELECT count(*) INTO v_sem_pesagem FROM erp_pec_animal a
    WHERE a.company_id=p_company_id AND a.propriedade_id=p_propriedade_id AND a.status='ativo'
      AND NOT EXISTS (SELECT 1 FROM erp_pec_pesagem p WHERE p.animal_id=a.id);

  -- peso medio por categoria (ultimo peso de cada animal)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('categoria',categoria,'peso_medio',peso_medio,'n',n) ORDER BY n DESC),'[]'::jsonb)
    INTO v_peso_cat
    FROM (
      SELECT a.categoria, round(avg(ult.peso_kg)::numeric, 2) AS peso_medio, count(*) AS n
        FROM erp_pec_animal a
        LEFT JOIN LATERAL (
          SELECT peso_kg FROM erp_pec_pesagem p
          WHERE p.animal_id=a.id ORDER BY data DESC LIMIT 1
        ) ult ON true
       WHERE a.company_id=p_company_id AND a.propriedade_id=p_propriedade_id AND a.status='ativo'
         AND ult.peso_kg IS NOT NULL
       GROUP BY a.categoria
    ) s;

  -- GMD medio: media dos GMDs entre as 2 ultimas pesagens de cada animal
  SELECT round(avg(gmd)::numeric, 3) INTO v_gmd_medio
    FROM (
      SELECT (p1.peso_kg - p2.peso_kg) / NULLIF((p1.data - p2.data),0)::numeric AS gmd
        FROM erp_pec_pesagem p1
        JOIN LATERAL (
          SELECT peso_kg, data FROM erp_pec_pesagem
            WHERE animal_id=p1.animal_id AND company_id=p1.company_id AND data < p1.data
            ORDER BY data DESC LIMIT 1
        ) p2 ON true
        JOIN LATERAL (
          SELECT id FROM erp_pec_pesagem WHERE animal_id=p1.animal_id AND company_id=p1.company_id
          ORDER BY data DESC LIMIT 1
        ) ult ON ult.id = p1.id
       WHERE p1.company_id=p_company_id AND p1.propriedade_id=p_propriedade_id
    ) s
    WHERE gmd IS NOT NULL;

  -- distribuicao reprodutiva: ultimo evento de cada animal
  SELECT COALESCE(jsonb_object_agg(estado, n), '{}'::jsonb) INTO v_repro
    FROM (
      SELECT ult.estado, count(*) AS n
        FROM erp_pec_animal a
        JOIN LATERAL (
          SELECT estado FROM erp_pec_repro_evento e
          WHERE e.animal_id=a.id ORDER BY data DESC, created_at DESC LIMIT 1
        ) ult ON true
       WHERE a.company_id=p_company_id AND a.propriedade_id=p_propriedade_id AND a.status='ativo'
       GROUP BY ult.estado
    ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'pesados_30d', v_pesados_30d,
    'pct_pesados_30d', CASE WHEN v_total > 0 THEN round((v_pesados_30d::numeric / v_total) * 100, 1) ELSE 0 END,
    'sem_pesagem', v_sem_pesagem,
    'peso_medio_por_categoria', v_peso_cat,
    'gmd_medio_rebanho', v_gmd_medio,
    'repro_distribuicao', v_repro
  );
END $$;

GRANT EXECUTE ON FUNCTION public.fn_pec_pesagem_registrar(uuid,uuid,uuid,date,numeric,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pec_repro_registrar(uuid,uuid,uuid,date,text,text,uuid,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pec_pesagem_historico(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pec_manejo_painel(uuid,uuid) TO authenticated;
