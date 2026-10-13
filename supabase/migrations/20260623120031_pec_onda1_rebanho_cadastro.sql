-- =====================================================================
-- PECUARIA DE CORTE · ONDA 1 — Rebanho & Cadastro (fundacao)
-- Prefixo de dominio: erp_pec_  | multi-tenant company_id + RLS
-- =====================================================================

-- 1) PROPRIEDADE
CREATE TABLE IF NOT EXISTS erp_pec_propriedade (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  nome            text NOT NULL,
  tipo_operacao   text NOT NULL DEFAULT 'ciclo_completo'
                  CHECK (tipo_operacao IN ('cria','recria','engorda','semiconfinamento','confinamento','ciclo_completo')),
  cidade          text,
  uf              text,
  area_total_ha   numeric(12,2),
  inscricao_estadual text,
  observacao      text,
  ativo           boolean NOT NULL DEFAULT true,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_prop_company ON erp_pec_propriedade(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_prop_ref ON erp_pec_propriedade(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;

-- 2) AREA (estrutura fisica)
CREATE TABLE IF NOT EXISTS erp_pec_area (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  tipo            text NOT NULL DEFAULT 'piquete'
                  CHECK (tipo IN ('piquete','curral_baia','sede','area_arrendada','mangueira','outro')),
  area_ha         numeric(12,2),
  capacidade_ua   numeric(10,2),
  arrendada_para  text,
  observacao      text,
  ativo           boolean NOT NULL DEFAULT true,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_area_company ON erp_pec_area(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_area_prop ON erp_pec_area(propriedade_id);

-- 3) LOTE
CREATE TABLE IF NOT EXISTS erp_pec_lote (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  codigo          text NOT NULL,
  modo            text NOT NULL DEFAULT 'pasto'
                  CHECK (modo IN ('pasto','semiconfinamento','confinamento')),
  fase            text CHECK (fase IN ('cria','recria','engorda','terminacao')),
  area_atual_id   uuid REFERENCES erp_pec_area(id) ON DELETE SET NULL,
  data_abertura   date NOT NULL DEFAULT CURRENT_DATE,
  data_fechamento date,
  status          text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','encerrado')),
  observacao      text,
  ativo           boolean NOT NULL DEFAULT true,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_lote_company ON erp_pec_lote(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_lote_prop ON erp_pec_lote(propriedade_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_lote_ref ON erp_pec_lote(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;

-- 4) ANIMAL
CREATE TABLE IF NOT EXISTS erp_pec_animal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  lote_id         uuid REFERENCES erp_pec_lote(id) ON DELETE SET NULL,
  area_atual_id   uuid REFERENCES erp_pec_area(id) ON DELETE SET NULL,
  identificacao   text,
  sisbov          text,
  sexo            text CHECK (sexo IN ('M','F')),
  categoria       text NOT NULL DEFAULT 'outro'
                  CHECK (categoria IN ('matriz','touro','bezerro','bezerra','garrote','novilha','boi_magro','boi_gordo','descarte','outro')),
  raca            text,
  data_nascimento date,
  mae_id          uuid REFERENCES erp_pec_animal(id) ON DELETE SET NULL,
  origem          text NOT NULL DEFAULT 'nascido' CHECK (origem IN ('nascido','comprado')),
  data_entrada    date NOT NULL DEFAULT CURRENT_DATE,
  peso_entrada_kg numeric(8,2),
  contraparte_nome text,
  status          text NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo','vendido','morto','abatido','transferido')),
  data_saida      date,
  motivo_saida    text,
  observacao      text,
  ativo           boolean NOT NULL DEFAULT true,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_animal_company ON erp_pec_animal(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_animal_prop ON erp_pec_animal(propriedade_id);
CREATE INDEX IF NOT EXISTS idx_pec_animal_lote ON erp_pec_animal(lote_id);
CREATE INDEX IF NOT EXISTS idx_pec_animal_categoria ON erp_pec_animal(company_id, categoria);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_animal_ref ON erp_pec_animal(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_animal_brinco ON erp_pec_animal(company_id, propriedade_id, identificacao)
  WHERE identificacao IS NOT NULL AND status = 'ativo';

-- 5) MOVIMENTACAO
CREATE TABLE IF NOT EXISTS erp_pec_movimentacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  propriedade_id  uuid NOT NULL REFERENCES erp_pec_propriedade(id) ON DELETE CASCADE,
  animal_id       uuid REFERENCES erp_pec_animal(id) ON DELETE SET NULL,
  lote_id         uuid REFERENCES erp_pec_lote(id) ON DELETE SET NULL,
  tipo            text NOT NULL
                  CHECK (tipo IN ('nascimento','compra','desmama','retencao','transferencia','pesagem','entrada_confinamento','venda','morte','abate','ajuste')),
  data            date NOT NULL DEFAULT CURRENT_DATE,
  area_origem_id  uuid REFERENCES erp_pec_area(id) ON DELETE SET NULL,
  area_destino_id uuid REFERENCES erp_pec_area(id) ON DELETE SET NULL,
  lote_destino_id uuid REFERENCES erp_pec_lote(id) ON DELETE SET NULL,
  quantidade      integer NOT NULL DEFAULT 1,
  peso_kg         numeric(8,2),
  valor           numeric(14,2),
  contraparte_nome text,
  observacao      text,
  ref_externa_sistema text,
  ref_externa_id  text,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_mov_company ON erp_pec_movimentacao(company_id);
CREATE INDEX IF NOT EXISTS idx_pec_mov_animal ON erp_pec_movimentacao(animal_id);
CREATE INDEX IF NOT EXISTS idx_pec_mov_lote ON erp_pec_movimentacao(lote_id);
CREATE INDEX IF NOT EXISTS idx_pec_mov_tipo ON erp_pec_movimentacao(company_id, tipo, data);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_mov_ref ON erp_pec_movimentacao(company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_id IS NOT NULL;

-- =====================================================================
-- RLS + POLICIES + trigger updated_at
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_pec_propriedade','erp_pec_area','erp_pec_lote','erp_pec_animal','erp_pec_movimentacao']
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
-- RPCs (SECURITY INVOKER → RLS aplica)
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_pec_propriedade_salvar(
  p_company_id uuid, p_nome text, p_tipo_operacao text DEFAULT 'ciclo_completo',
  p_cidade text DEFAULT NULL, p_uf text DEFAULT NULL, p_area_total_ha numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO erp_pec_propriedade(company_id,nome,tipo_operacao,cidade,uf,area_total_ha,observacao,criado_por)
    VALUES (p_company_id,p_nome,p_tipo_operacao,p_cidade,p_uf,p_area_total_ha,p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_propriedade SET nome=p_nome,tipo_operacao=p_tipo_operacao,cidade=p_cidade,uf=p_uf,
      area_total_ha=p_area_total_ha,observacao=p_observacao
    WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_area_salvar(
  p_company_id uuid, p_propriedade_id uuid, p_nome text, p_tipo text DEFAULT 'piquete',
  p_area_ha numeric DEFAULT NULL, p_capacidade_ua numeric DEFAULT NULL,
  p_arrendada_para text DEFAULT NULL, p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO erp_pec_area(company_id,propriedade_id,nome,tipo,area_ha,capacidade_ua,arrendada_para,observacao,criado_por)
    VALUES (p_company_id,p_propriedade_id,p_nome,p_tipo,p_area_ha,p_capacidade_ua,p_arrendada_para,p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_area SET nome=p_nome,tipo=p_tipo,area_ha=p_area_ha,capacidade_ua=p_capacidade_ua,
      arrendada_para=p_arrendada_para,observacao=p_observacao
    WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_lote_salvar(
  p_company_id uuid, p_propriedade_id uuid, p_codigo text, p_modo text DEFAULT 'pasto',
  p_fase text DEFAULT NULL, p_area_atual_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO erp_pec_lote(company_id,propriedade_id,codigo,modo,fase,area_atual_id,observacao,criado_por)
    VALUES (p_company_id,p_propriedade_id,p_codigo,p_modo,p_fase,p_area_atual_id,p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_lote SET codigo=p_codigo,modo=p_modo,fase=p_fase,area_atual_id=p_area_atual_id,observacao=p_observacao
    WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_animal_salvar(
  p_company_id uuid, p_propriedade_id uuid, p_identificacao text DEFAULT NULL,
  p_sexo text DEFAULT NULL, p_categoria text DEFAULT 'outro', p_raca text DEFAULT NULL,
  p_data_nascimento date DEFAULT NULL, p_origem text DEFAULT 'nascido',
  p_data_entrada date DEFAULT NULL, p_peso_entrada_kg numeric DEFAULT NULL,
  p_lote_id uuid DEFAULT NULL, p_area_atual_id uuid DEFAULT NULL, p_sisbov text DEFAULT NULL,
  p_mae_id uuid DEFAULT NULL, p_contraparte_nome text DEFAULT NULL, p_observacao text DEFAULT NULL,
  p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO erp_pec_animal(company_id,propriedade_id,identificacao,sexo,categoria,raca,data_nascimento,
      origem,data_entrada,peso_entrada_kg,lote_id,area_atual_id,sisbov,mae_id,contraparte_nome,observacao,criado_por)
    VALUES (p_company_id,p_propriedade_id,p_identificacao,p_sexo,p_categoria,p_raca,p_data_nascimento,
      p_origem,COALESCE(p_data_entrada,CURRENT_DATE),p_peso_entrada_kg,p_lote_id,p_area_atual_id,p_sisbov,
      p_mae_id,p_contraparte_nome,p_observacao,auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_pec_animal SET identificacao=p_identificacao,sexo=p_sexo,categoria=p_categoria,raca=p_raca,
      data_nascimento=p_data_nascimento,origem=p_origem,data_entrada=COALESCE(p_data_entrada,data_entrada),
      peso_entrada_kg=p_peso_entrada_kg,lote_id=p_lote_id,area_atual_id=p_area_atual_id,sisbov=p_sisbov,
      mae_id=p_mae_id,contraparte_nome=p_contraparte_nome,observacao=p_observacao
    WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_movimentacao_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_tipo text, p_data date DEFAULT NULL,
  p_animal_id uuid DEFAULT NULL, p_lote_id uuid DEFAULT NULL, p_quantidade int DEFAULT 1,
  p_peso_kg numeric DEFAULT NULL, p_valor numeric DEFAULT NULL,
  p_area_origem_id uuid DEFAULT NULL, p_area_destino_id uuid DEFAULT NULL, p_lote_destino_id uuid DEFAULT NULL,
  p_contraparte_nome text DEFAULT NULL, p_observacao text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_pec_movimentacao(company_id,propriedade_id,animal_id,lote_id,tipo,data,quantidade,peso_kg,valor,
    area_origem_id,area_destino_id,lote_destino_id,contraparte_nome,observacao,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,p_tipo,COALESCE(p_data,CURRENT_DATE),p_quantidade,p_peso_kg,p_valor,
    p_area_origem_id,p_area_destino_id,p_lote_destino_id,p_contraparte_nome,p_observacao,auth.uid())
  RETURNING id INTO v_id;

  IF p_animal_id IS NOT NULL THEN
    IF p_tipo IN ('venda','morte','abate') THEN
      UPDATE erp_pec_animal SET status = CASE p_tipo WHEN 'venda' THEN 'vendido' WHEN 'morte' THEN 'morto' ELSE 'abatido' END,
        data_saida = COALESCE(p_data,CURRENT_DATE), motivo_saida = p_tipo, ativo = false
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'transferencia' THEN
      UPDATE erp_pec_animal SET lote_id = COALESCE(p_lote_destino_id, lote_id), area_atual_id = COALESCE(p_area_destino_id, area_atual_id)
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'retencao' THEN
      UPDATE erp_pec_animal SET categoria = 'novilha' WHERE id=p_animal_id AND company_id=p_company_id AND categoria='bezerra';
    END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pec_painel_rebanho(p_company_id uuid, p_propriedade_id uuid DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT json_build_object(
    'total_cabecas', (SELECT count(*) FROM erp_pec_animal a WHERE a.company_id=p_company_id AND a.status='ativo'
                      AND (p_propriedade_id IS NULL OR a.propriedade_id=p_propriedade_id)),
    'por_categoria', (SELECT COALESCE(json_agg(json_build_object('categoria',categoria,'qtd',qtd) ORDER BY qtd DESC),'[]'::json)
                      FROM (SELECT categoria, count(*) qtd FROM erp_pec_animal a WHERE a.company_id=p_company_id AND a.status='ativo'
                            AND (p_propriedade_id IS NULL OR a.propriedade_id=p_propriedade_id) GROUP BY categoria) s),
    'lotes_ativos', (SELECT count(*) FROM erp_pec_lote l WHERE l.company_id=p_company_id AND l.status='ativo'
                     AND (p_propriedade_id IS NULL OR l.propriedade_id=p_propriedade_id)),
    'areas', (SELECT count(*) FROM erp_pec_area ar WHERE ar.company_id=p_company_id AND ar.ativo
              AND (p_propriedade_id IS NULL OR ar.propriedade_id=p_propriedade_id)),
    'propriedades', (SELECT count(*) FROM erp_pec_propriedade p WHERE p.company_id=p_company_id AND p.ativo)
  );
$$;

GRANT EXECUTE ON FUNCTION fn_pec_propriedade_salvar(uuid,text,text,text,text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_area_salvar(uuid,uuid,text,text,numeric,numeric,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_lote_salvar(uuid,uuid,text,text,text,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_animal_salvar(uuid,uuid,text,text,text,text,date,text,date,numeric,uuid,uuid,text,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_movimentacao_registrar(uuid,uuid,text,date,uuid,uuid,int,numeric,numeric,uuid,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pec_painel_rebanho(uuid,uuid) TO authenticated;
