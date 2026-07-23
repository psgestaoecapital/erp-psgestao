-- =====================================================================
-- PECUARIA · ONDA 2 — Manejo & Pesagem (GMD)
-- =====================================================================

-- 0) Colunas de leitura rapida no animal (peso atual / GMD)
ALTER TABLE erp_pec_animal ADD COLUMN IF NOT EXISTS peso_atual_kg numeric(8,2);
ALTER TABLE erp_pec_animal ADD COLUMN IF NOT EXISTS data_ultima_pesagem date;
ALTER TABLE erp_pec_animal ADD COLUMN IF NOT EXISTS gmd_atual_kg_dia numeric(6,3);

-- 1) PESAGEM
CREATE TABLE IF NOT EXISTS erp_pec_pesagem (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  animal_id       uuid REFERENCES erp_pec_animal(id) ON DELETE CASCADE,
  lote_id         uuid REFERENCES erp_pec_lote(id) ON DELETE CASCADE,
  data            date NOT NULL DEFAULT CURRENT_DATE,
  peso_kg         numeric(8,2) NOT NULL,
  gmd_kg_dia      numeric(6,3),
  origem          text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','balanca','estimado')),
  observacao      text,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pec_pesagem_ref CHECK (animal_id IS NOT NULL OR lote_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pec_pesagem_company ON erp_pec_pesagem(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_pesagem_animal ON erp_pec_pesagem(animal_id, data);
CREATE INDEX IF NOT EXISTS idx_pec_pesagem_lote ON erp_pec_pesagem(lote_id, data);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_pesagem_ref ON erp_pec_pesagem(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;

-- 2) EVENTO SANITARIO
CREATE TABLE IF NOT EXISTS erp_pec_evento_sanitario (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  animal_id       uuid REFERENCES erp_pec_animal(id) ON DELETE CASCADE,
  lote_id         uuid REFERENCES erp_pec_lote(id) ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'vacina'
                  CHECK (tipo IN ('vacina','vermifugo','medicamento','exame','outro')),
  produto         text,
  data            date NOT NULL DEFAULT CURRENT_DATE,
  dose            text,
  proxima_dose    date,
  responsavel     text,
  observacao      text,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pec_sanit_ref CHECK (animal_id IS NOT NULL OR lote_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pec_sanit_company ON erp_pec_evento_sanitario(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_sanit_animal ON erp_pec_evento_sanitario(animal_id);
CREATE INDEX IF NOT EXISTS idx_pec_sanit_lote ON erp_pec_evento_sanitario(lote_id);
CREATE INDEX IF NOT EXISTS idx_pec_sanit_proxima ON erp_pec_evento_sanitario(company_id, proxima_dose) WHERE proxima_dose IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_sanit_ref ON erp_pec_evento_sanitario(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;

-- =====================================================================
-- RLS + POLICIES + triggers
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_pec_pesagem','erp_pec_evento_sanitario']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_pol ON %I;', t, t);
    EXECUTE format($p$CREATE POLICY %I_pol ON %I FOR ALL TO authenticated
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));$p$, t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON %I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();', t, t);
  END LOOP;
END $$;

-- =====================================================================
-- RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_pec_pesagem_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_peso_kg numeric,
  p_animal_id uuid DEFAULT NULL, p_lote_id uuid DEFAULT NULL,
  p_data date DEFAULT NULL, p_origem text DEFAULT 'manual', p_observacao text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_data date := COALESCE(p_data, CURRENT_DATE);
  v_peso_ant numeric; v_data_ant date; v_dias int; v_gmd numeric; v_id uuid;
BEGIN
  SELECT peso_kg, data INTO v_peso_ant, v_data_ant
  FROM erp_pec_pesagem
  WHERE company_id = p_company_id AND data < v_data
    AND ( (p_animal_id IS NOT NULL AND animal_id = p_animal_id)
       OR (p_animal_id IS NULL AND p_lote_id IS NOT NULL AND lote_id = p_lote_id) )
  ORDER BY data DESC LIMIT 1;

  IF v_peso_ant IS NOT NULL THEN
    v_dias := GREATEST((v_data - v_data_ant), 1);
    v_gmd := round((p_peso_kg - v_peso_ant) / v_dias, 3);
  END IF;

  INSERT INTO erp_pec_pesagem(company_id,propriedade_id,animal_id,lote_id,data,peso_kg,gmd_kg_dia,origem,observacao,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,v_data,p_peso_kg,v_gmd,p_origem,p_observacao,auth.uid())
  RETURNING id INTO v_id;

  IF p_animal_id IS NOT NULL THEN
    UPDATE erp_pec_animal
      SET peso_atual_kg = p_peso_kg, data_ultima_pesagem = v_data, gmd_atual_kg_dia = COALESCE(v_gmd, gmd_atual_kg_dia)
    WHERE id = p_animal_id AND company_id = p_company_id;
  END IF;

  INSERT INTO erp_pec_movimentacao(company_id,propriedade_id,animal_id,lote_id,tipo,data,peso_kg,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,'pesagem',v_data,p_peso_kg,auth.uid());

  RETURN json_build_object('id', v_id, 'gmd_kg_dia', v_gmd, 'peso_kg', p_peso_kg, 'data', v_data);
END $$;

CREATE OR REPLACE FUNCTION fn_pec_curva_ganho(p_company_id uuid, p_animal_id uuid)
RETURNS json LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT json_build_object(
    'pesagens', COALESCE((SELECT json_agg(json_build_object('data',data,'peso_kg',peso_kg,'gmd_kg_dia',gmd_kg_dia) ORDER BY data)
                FROM erp_pec_pesagem WHERE company_id=p_company_id AND animal_id=p_animal_id), '[]'::json),
    'gmd_medio', (SELECT round(avg(gmd_kg_dia),3) FROM erp_pec_pesagem WHERE company_id=p_company_id AND animal_id=p_animal_id AND gmd_kg_dia IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION fn_pec_evento_sanitario_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_tipo text, p_produto text DEFAULT NULL,
  p_animal_id uuid DEFAULT NULL, p_lote_id uuid DEFAULT NULL, p_data date DEFAULT NULL,
  p_dose text DEFAULT NULL, p_proxima_dose date DEFAULT NULL, p_responsavel text DEFAULT NULL, p_observacao text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_pec_evento_sanitario(company_id,propriedade_id,animal_id,lote_id,tipo,produto,data,dose,proxima_dose,responsavel,observacao,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,p_tipo,p_produto,COALESCE(p_data,CURRENT_DATE),p_dose,p_proxima_dose,p_responsavel,p_observacao,auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_painel_manejo(p_company_id uuid, p_propriedade_id uuid DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT json_build_object(
    'gmd_medio_rebanho', (SELECT round(avg(gmd_atual_kg_dia),3) FROM erp_pec_animal
        WHERE company_id=p_company_id AND status='ativo' AND gmd_atual_kg_dia IS NOT NULL
        AND (p_propriedade_id IS NULL OR propriedade_id=p_propriedade_id)),
    'pesados_30d', (SELECT count(DISTINCT animal_id) FROM erp_pec_pesagem
        WHERE company_id=p_company_id AND data >= CURRENT_DATE-30
        AND (p_propriedade_id IS NULL OR propriedade_id=p_propriedade_id)),
    'pendencias_sanitarias', COALESCE((SELECT json_agg(json_build_object(
          'tipo',tipo,'produto',produto,'proxima_dose',proxima_dose,'animal_id',animal_id,'lote_id',lote_id) ORDER BY proxima_dose)
        FROM erp_pec_evento_sanitario
        WHERE company_id=p_company_id AND proxima_dose IS NOT NULL AND proxima_dose <= CURRENT_DATE+15
        AND (p_propriedade_id IS NULL OR propriedade_id=p_propriedade_id)), '[]'::json)
  );
$$;

GRANT EXECUTE ON FUNCTION fn_pec_pesagem_registrar(uuid,uuid,numeric,uuid,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_curva_ganho(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_evento_sanitario_registrar(uuid,uuid,text,text,uuid,uuid,date,text,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_painel_manejo(uuid,uuid) TO authenticated;
