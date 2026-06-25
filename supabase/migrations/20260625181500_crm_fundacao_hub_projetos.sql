-- ============================================================
-- FUNDAÇÃO CRM HUB DE PROJETOS — 4 tabelas + RLS + RPCs
-- Jornada: lead -> cliente -> oportunidade -> visita/interacao/orcamento
-- Multi-tenant: company_id + RLS get_user_company_ids()
-- ============================================================

-- 1) LEAD (captação fria, antes de virar cliente)
CREATE TABLE IF NOT EXISTS public.erp_crm_lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  nome text NOT NULL,
  telefone text, email text,
  origem text,
  interesse text,
  cidade text, bairro text,
  status text NOT NULL DEFAULT 'novo',
  motivo_descarte text,
  cliente_id uuid REFERENCES erp_clientes(id),
  oportunidade_id uuid,
  responsavel_id uuid REFERENCES users(id),
  observacoes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

-- 2) OPORTUNIDADE (o CARD do funil — peça central)
CREATE TABLE IF NOT EXISTS public.erp_crm_oportunidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  cliente_id uuid REFERENCES erp_clientes(id),
  titulo text NOT NULL,
  etapa text NOT NULL DEFAULT 'prospeccao',
  valor_estimado numeric(15,2),
  valor_proposta numeric(15,2),
  probabilidade int DEFAULT 50,
  origem text,
  obra_endereco text, obra_cidade text, obra_bairro text,
  responsavel_id uuid REFERENCES users(id),
  data_prevista_fechamento date,
  data_fechamento date,
  motivo_perda text,
  orcamento_id uuid REFERENCES erp_orcamentos(id),
  observacoes text,
  ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

-- FK adiada do lead -> oportunidade
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_oportunidade'
  ) THEN
    ALTER TABLE public.erp_crm_lead
      ADD CONSTRAINT fk_lead_oportunidade
      FOREIGN KEY (oportunidade_id) REFERENCES erp_crm_oportunidade(id);
  END IF;
END $$;

-- 3) VISITA TÉCNICA (pendura na oportunidade; gatilho do orçamento)
CREATE TABLE IF NOT EXISTS public.erp_crm_visita (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  oportunidade_id uuid NOT NULL REFERENCES erp_crm_oportunidade(id) ON DELETE CASCADE,
  data_visita timestamptz,
  responsavel_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'agendada',
  endereco text, gps_lat numeric, gps_lng numeric,
  anotacoes text,
  fotos jsonb DEFAULT '[]'::jsonb,
  audio_briefing_url text,
  gerou_orcamento_id uuid REFERENCES erp_orcamentos(id),
  created_at timestamptz DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

-- 4) INTERAÇÃO (timeline do relacionamento)
CREATE TABLE IF NOT EXISTS public.erp_crm_interacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  oportunidade_id uuid REFERENCES erp_crm_oportunidade(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES erp_crm_lead(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  descricao text NOT NULL,
  data_interacao timestamptz DEFAULT now(),
  autor_id uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_crm_oport_company_etapa ON erp_crm_oportunidade(company_id, etapa);
CREATE INDEX IF NOT EXISTS idx_crm_oport_cliente ON erp_crm_oportunidade(cliente_id);
CREATE INDEX IF NOT EXISTS idx_crm_visita_oport ON erp_crm_visita(oportunidade_id);
CREATE INDEX IF NOT EXISTS idx_crm_interacao_oport ON erp_crm_interacao(oportunidade_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_company_status ON erp_crm_lead(company_id, status);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE erp_crm_lead         ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_crm_oportunidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_crm_visita       ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_crm_interacao    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_lead_rls ON erp_crm_lead;
CREATE POLICY crm_lead_rls ON erp_crm_lead FOR ALL
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS crm_oport_rls ON erp_crm_oportunidade;
CREATE POLICY crm_oport_rls ON erp_crm_oportunidade FOR ALL
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS crm_visita_rls ON erp_crm_visita;
CREATE POLICY crm_visita_rls ON erp_crm_visita FOR ALL
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS crm_interacao_rls ON erp_crm_interacao;
CREATE POLICY crm_interacao_rls ON erp_crm_interacao FOR ALL
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION fn_crm_pipeline(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'etapas', (SELECT jsonb_agg(e) FROM (
      SELECT o.etapa,
             count(*) AS qtd,
             COALESCE(sum(o.valor_estimado),0) AS valor_total,
             jsonb_agg(jsonb_build_object(
               'id', o.id, 'titulo', o.titulo,
               'cliente', COALESCE(c.nome_fantasia, c.razao_social),
               'valor_estimado', o.valor_estimado, 'probabilidade', o.probabilidade,
               'responsavel_id', o.responsavel_id, 'ordem', o.ordem,
               'data_prevista', o.data_prevista_fechamento
             ) ORDER BY o.ordem) AS cards
      FROM erp_crm_oportunidade o
      LEFT JOIN erp_clientes c ON c.id=o.cliente_id
      WHERE o.company_id=p_company_id AND o.etapa NOT IN ('ganho','perdido')
      GROUP BY o.etapa) e),
    'resumo', (SELECT jsonb_build_object(
      'abertas', count(*) FILTER (WHERE etapa NOT IN ('ganho','perdido')),
      'ganhas_mes', count(*) FILTER (WHERE etapa='ganho' AND data_fechamento >= date_trunc('month', now())),
      'valor_pipeline', COALESCE(sum(valor_estimado) FILTER (WHERE etapa NOT IN ('ganho','perdido')),0))
      FROM erp_crm_oportunidade WHERE company_id=p_company_id)
  );
$$;

CREATE OR REPLACE FUNCTION fn_crm_mover_etapa(p_id uuid, p_etapa text, p_motivo_perda text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM erp_crm_oportunidade WHERE id=p_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao');
  END IF;
  UPDATE erp_crm_oportunidade SET
    etapa=p_etapa,
    data_fechamento = CASE WHEN p_etapa IN ('ganho','perdido') THEN now()::date ELSE data_fechamento END,
    motivo_perda = CASE WHEN p_etapa='perdido' THEN p_motivo_perda ELSE motivo_perda END,
    updated_at=now()
  WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'etapa',p_etapa);
END; $$;

CREATE OR REPLACE FUNCTION fn_crm_converter_lead(p_lead_id uuid, p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l RECORD; v_cli uuid; v_op uuid;
BEGIN
  SELECT * INTO l FROM erp_crm_lead WHERE id=p_lead_id;
  IF l.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao');
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    v_cli := p_cliente_id;
  ELSE
    INSERT INTO erp_clientes(company_id, nome_fantasia, telefone, email, origem, cidade)
    VALUES (l.company_id, l.nome, l.telefone, l.email, l.origem, l.cidade)
    RETURNING id INTO v_cli;
  END IF;

  INSERT INTO erp_crm_oportunidade(company_id, cliente_id, titulo, etapa, origem, responsavel_id, observacoes)
  VALUES (l.company_id, v_cli, COALESCE(l.interesse, l.nome), 'prospeccao', l.origem, l.responsavel_id, l.observacoes)
  RETURNING id INTO v_op;

  UPDATE erp_crm_lead SET status='convertido', cliente_id=v_cli, oportunidade_id=v_op, updated_at=now()
  WHERE id=p_lead_id;

  RETURN jsonb_build_object('ok',true,'cliente_id',v_cli,'oportunidade_id',v_op);
END; $$;

GRANT EXECUTE ON FUNCTION fn_crm_pipeline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_crm_mover_etapa(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_crm_converter_lead(uuid,uuid) TO authenticated;
