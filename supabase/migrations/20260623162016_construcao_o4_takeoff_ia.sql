-- =====================================================================
-- CONSTRUCAO · O4 — Takeoff por IA da Planta
-- =====================================================================

-- 1) PLANTA enviada (ancorada num orcamento)
CREATE TABLE IF NOT EXISTS erp_obra_planta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  orcamento_id    uuid REFERENCES erp_orcamentos(id) ON DELETE SET NULL,
  nome            text NOT NULL,
  arquivo_path    text NOT NULL,
  arquivo_tipo    text,
  escala_informada text,
  status          text NOT NULL DEFAULT 'enviada'
                  CHECK (status IN ('enviada','processando','processada','erro','confirmada')),
  ia_resumo       jsonb,
  ia_erro         text,
  area_total_m2   numeric(12,2),
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_obra_planta_company ON erp_obra_planta(company_id);
CREATE INDEX IF NOT EXISTS idx_obra_planta_orc ON erp_obra_planta(orcamento_id);

-- 2) AMBIENTE extraido pela IA
CREATE TABLE IF NOT EXISTS erp_obra_planta_ambiente (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  planta_id       uuid NOT NULL REFERENCES erp_obra_planta(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  largura_m       numeric(8,2),
  comprimento_m   numeric(8,2),
  area_m2         numeric(10,2),
  perimetro_ml    numeric(10,2),
  pe_direito_m    numeric(6,2),
  confianca       text DEFAULT 'media' CHECK (confianca IN ('alta','media','baixa')),
  origem          text NOT NULL DEFAULT 'ia' CHECK (origem IN ('ia','manual')),
  confirmado      boolean NOT NULL DEFAULT false,
  servico_id      uuid REFERENCES projetos_servicos(id) ON DELETE SET NULL,
  base_calculo    text DEFAULT 'area' CHECK (base_calculo IN ('area','perimetro','pe_direito_parede')),
  observacao      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planta_amb_company ON erp_obra_planta_ambiente(company_id);
CREATE INDEX IF NOT EXISTS idx_planta_amb_planta ON erp_obra_planta_ambiente(planta_id);

-- =====================================================================
-- RLS + POLICIES + trigger updated_at
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_obra_planta','erp_obra_planta_ambiente']
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

-- 3) BUCKET privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('projetos-plantas','projetos-plantas', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS projetos_plantas_rw ON storage.objects;
CREATE POLICY projetos_plantas_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='projetos-plantas' AND (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text))
  WITH CHECK (bucket_id='projetos-plantas' AND (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text));

-- =====================================================================
-- RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_takeoff_planta_salvar(
  p_company_id uuid, p_nome text, p_arquivo_path text, p_arquivo_tipo text DEFAULT NULL,
  p_orcamento_id uuid DEFAULT NULL, p_escala text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_obra_planta(company_id,orcamento_id,nome,arquivo_path,arquivo_tipo,escala_informada,status,criado_por)
  VALUES (p_company_id,p_orcamento_id,p_nome,p_arquivo_path,p_arquivo_tipo,p_escala,'enviada',auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_takeoff_ambientes_salvar(
  p_company_id uuid, p_planta_id uuid, p_ambientes jsonb
) RETURNS int LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_count int := 0; r jsonb;
BEGIN
  DELETE FROM erp_obra_planta_ambiente WHERE planta_id=p_planta_id AND company_id=p_company_id AND origem='ia' AND confirmado=false;
  FOR r IN SELECT * FROM jsonb_array_elements(p_ambientes)
  LOOP
    INSERT INTO erp_obra_planta_ambiente(company_id,planta_id,nome,largura_m,comprimento_m,area_m2,perimetro_ml,pe_direito_m,confianca,origem)
    VALUES (p_company_id,p_planta_id,
      COALESCE(r->>'nome','Ambiente'),
      NULLIF(r->>'largura_m','')::numeric, NULLIF(r->>'comprimento_m','')::numeric,
      NULLIF(r->>'area_m2','')::numeric, NULLIF(r->>'perimetro_ml','')::numeric, NULLIF(r->>'pe_direito_m','')::numeric,
      COALESCE(r->>'confianca','media'),'ia');
    v_count := v_count + 1;
  END LOOP;
  UPDATE erp_obra_planta SET status='processada',
    area_total_m2=(SELECT COALESCE(sum(area_m2),0) FROM erp_obra_planta_ambiente WHERE planta_id=p_planta_id)
  WHERE id=p_planta_id AND company_id=p_company_id;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION fn_takeoff_ambiente_atualizar(
  p_company_id uuid, p_id uuid, p_nome text DEFAULT NULL, p_area_m2 numeric DEFAULT NULL,
  p_perimetro_ml numeric DEFAULT NULL, p_pe_direito_m numeric DEFAULT NULL,
  p_servico_id uuid DEFAULT NULL, p_base_calculo text DEFAULT NULL, p_confirmado boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  UPDATE erp_obra_planta_ambiente SET
    nome=COALESCE(p_nome,nome), area_m2=COALESCE(p_area_m2,area_m2),
    perimetro_ml=COALESCE(p_perimetro_ml,perimetro_ml), pe_direito_m=COALESCE(p_pe_direito_m,pe_direito_m),
    servico_id=COALESCE(p_servico_id,servico_id), base_calculo=COALESCE(p_base_calculo,base_calculo),
    confirmado=COALESCE(p_confirmado,confirmado)
  WHERE id=p_id AND company_id=p_company_id;
END $$;

CREATE OR REPLACE FUNCTION fn_takeoff_gerar_orcamento(
  p_company_id uuid, p_planta_id uuid, p_orcamento_id uuid
) RETURNS int LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_count int := 0; a record; v_qtd numeric; v_ordem int;
BEGIN
  SELECT COALESCE(max(ordem),0) INTO v_ordem FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR a IN
    SELECT amb.*, s.nome AS s_nome, s.codigo AS s_codigo, s.unidade AS s_unidade, s.custo_unitario_total
    FROM erp_obra_planta_ambiente amb
    JOIN projetos_servicos s ON s.id=amb.servico_id
    WHERE amb.planta_id=p_planta_id AND amb.company_id=p_company_id AND amb.confirmado=true AND amb.servico_id IS NOT NULL
  LOOP
    v_qtd := CASE a.base_calculo
               WHEN 'perimetro' THEN COALESCE(a.perimetro_ml,0)
               WHEN 'pe_direito_parede' THEN COALESCE(a.perimetro_ml,0)*COALESCE(a.pe_direito_m,0)
               ELSE COALESCE(a.area_m2,0) END;
    v_ordem := v_ordem + 1;
    INSERT INTO erp_orcamentos_itens(orcamento_id,company_id,ordem,tipo_item,servico_id,servico_codigo,servico_descricao,
      produto_nome,unidade,quantidade,preco_custo,preco_unitario,subtotal,observacoes)
    VALUES (p_orcamento_id,p_company_id,v_ordem,'servico',a.servico_id,a.s_codigo,a.s_nome,
      a.s_nome||' - '||a.nome, a.s_unidade, v_qtd, a.custo_unitario_total, a.custo_unitario_total,
      ROUND(v_qtd*COALESCE(a.custo_unitario_total,0),2), 'Gerado por takeoff IA - '||a.nome);
    v_count := v_count + 1;
  END LOOP;
  UPDATE erp_obra_planta SET status='confirmada' WHERE id=p_planta_id AND company_id=p_company_id;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION fn_takeoff_planta_salvar(uuid,text,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_takeoff_ambientes_salvar(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_takeoff_ambiente_atualizar(uuid,uuid,text,numeric,numeric,numeric,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_takeoff_gerar_orcamento(uuid,uuid,uuid) TO authenticated;
