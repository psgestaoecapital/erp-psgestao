-- ============================================================
-- O4.1 · projetos_obras — a obra como entidade (fundação do marco Obras).
-- RD-26: a obra girava implícita em orcamento_id; agora é entidade, nascida do orçamento
-- aprovado/convertido (idempotente por orcamento_id). Numeração via projetos_modulo_config
-- (prefixo_obra + contador_obra). RLS multi-tenant (Pilar 2 · get_user_company_ids()).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.projetos_obras (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  numero            text NOT NULL,
  orcamento_id      uuid REFERENCES public.erp_orcamentos(id) ON DELETE SET NULL,
  oportunidade_id   uuid REFERENCES public.erp_crm_oportunidade(id) ON DELETE SET NULL,
  nome              text NOT NULL,
  cliente_id        uuid,
  cliente_nome      text,
  endereco          text,
  cidade            text,
  bairro            text,
  uf                text,
  status            text NOT NULL DEFAULT 'em_andamento'
                    CHECK (status IN ('em_andamento','pausada','concluida','cancelada')),
  responsavel_id    uuid,
  responsavel_nome  text,
  valor_previsto    numeric(14,2) NOT NULL DEFAULT 0,
  pct_conclusao     integer NOT NULL DEFAULT 0 CHECK (pct_conclusao BETWEEN 0 AND 100),
  data_inicio       date,
  data_prevista_fim date,
  data_conclusao    date,
  observacoes       text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_obra_orcamento UNIQUE (orcamento_id)
);

CREATE INDEX IF NOT EXISTS ix_obras_company   ON public.projetos_obras(company_id);
CREATE INDEX IF NOT EXISTS ix_obras_status    ON public.projetos_obras(company_id, status);
CREATE INDEX IF NOT EXISTS ix_obras_orcamento ON public.projetos_obras(orcamento_id);

CREATE OR REPLACE FUNCTION public.tg_obras_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_obras_touch ON public.projetos_obras;
CREATE TRIGGER trg_obras_touch BEFORE UPDATE ON public.projetos_obras
FOR EACH ROW EXECUTE FUNCTION public.tg_obras_touch();

ALTER TABLE public.projetos_obras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_obras_select ON public.projetos_obras;
CREATE POLICY pol_obras_select ON public.projetos_obras
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS pol_obras_ins ON public.projetos_obras;
CREATE POLICY pol_obras_ins ON public.projetos_obras
  FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS pol_obras_upd ON public.projetos_obras;
CREATE POLICY pol_obras_upd ON public.projetos_obras
  FOR UPDATE USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- 2.1 · nascimento idempotente da obra a partir do orçamento
CREATE OR REPLACE FUNCTION public.fn_obra_criar_de_orcamento(p_orcamento_id uuid)
RETURNS public.projetos_obras
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orc   public.erp_orcamentos%ROWTYPE;
  v_opp   public.erp_crm_oportunidade%ROWTYPE;
  v_cfg   public.projetos_modulo_config%ROWTYPE;
  v_obra  public.projetos_obras%ROWTYPE;
  v_num   text; v_prefixo text; v_seq integer;
BEGIN
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento % não encontrado', p_orcamento_id; END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE orcamento_id = p_orcamento_id;
  IF FOUND THEN RETURN v_obra; END IF;

  SELECT * INTO v_opp FROM public.erp_crm_oportunidade WHERE orcamento_id = p_orcamento_id LIMIT 1;

  SELECT * INTO v_cfg FROM public.projetos_modulo_config WHERE company_id = v_orc.company_id;
  v_prefixo := COALESCE(NULLIF(v_cfg.prefixo_obra,''), 'OBRA');
  v_seq     := COALESCE(v_cfg.contador_obra, 0) + 1;
  v_num     := v_prefixo || '-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  UPDATE public.projetos_modulo_config
     SET contador_obra = v_seq, updated_at = now()
   WHERE company_id = v_orc.company_id;

  INSERT INTO public.projetos_obras (
    company_id, numero, orcamento_id, oportunidade_id,
    nome, cliente_id, cliente_nome, endereco, cidade, bairro,
    status, responsavel_id, responsavel_nome, valor_previsto, data_inicio, created_by
  ) VALUES (
    v_orc.company_id, v_num, v_orc.id, v_opp.id,
    COALESCE(NULLIF(v_opp.titulo,''), v_orc.cliente_nome, 'Obra ' || v_num),
    v_orc.cliente_id, v_orc.cliente_nome, v_opp.obra_endereco, v_opp.obra_cidade, v_opp.obra_bairro,
    'em_andamento', v_opp.responsavel_id, v_opp.responsavel_nome,
    COALESCE(v_orc.total, 0), CURRENT_DATE, auth.uid()
  )
  RETURNING * INTO v_obra;
  RETURN v_obra;
END $$;

-- 2.2 · trigger de nascimento automático (orçamento aprovado/convertido)
CREATE OR REPLACE FUNCTION public.tg_orcamento_gera_obra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('aprovado','convertido')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.fn_obra_criar_de_orcamento(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orcamento_gera_obra ON public.erp_orcamentos;
CREATE TRIGGER trg_orcamento_gera_obra
AFTER INSERT OR UPDATE OF status ON public.erp_orcamentos
FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_gera_obra();

-- 2.3 · listar (board). Pilar 2: interseção com as empresas do usuário (SECURITY DEFINER pula RLS).
CREATE OR REPLACE FUNCTION public.fn_obras_listar(p_company_ids uuid[], p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric,
  pct_conclusao integer, cidade text, uf text, responsavel_nome text,
  data_inicio date, data_prevista_fim date, data_conclusao date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.numero, o.nome, o.cliente_nome, o.status, o.valor_previsto, o.pct_conclusao,
         o.cidade, o.uf, o.responsavel_nome, o.data_inicio, o.data_prevista_fim, o.data_conclusao
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT get_user_company_ids())
     AND (p_status IS NULL OR o.status = p_status)
   ORDER BY
     CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
     o.data_inicio DESC NULLS LAST;
$$;

-- 2.4 · mudar status (ciclo de vida)
CREATE OR REPLACE FUNCTION public.fn_obra_mudar_status(p_obra_id uuid, p_novo_status text)
RETURNS public.projetos_obras
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_obra public.projetos_obras%ROWTYPE;
BEGIN
  IF p_novo_status NOT IN ('em_andamento','pausada','concluida','cancelada') THEN
    RAISE EXCEPTION 'Status inválido: %', p_novo_status;
  END IF;
  UPDATE public.projetos_obras
     SET status = p_novo_status,
         data_conclusao = CASE WHEN p_novo_status = 'concluida' THEN CURRENT_DATE ELSE data_conclusao END,
         pct_conclusao  = CASE WHEN p_novo_status = 'concluida' THEN 100 ELSE pct_conclusao END
   WHERE id = p_obra_id AND company_id IN (SELECT get_user_company_ids())
  RETURNING * INTO v_obra;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra não encontrada ou sem permissão'; END IF;
  RETURN v_obra;
END $$;

-- 2.5 · KPIs do cabeçalho
CREATE OR REPLACE FUNCTION public.fn_obras_kpis(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'em_andamento',       count(*) FILTER (WHERE status='em_andamento'),
    'concluidas',         count(*) FILTER (WHERE status='concluida'),
    'valor_em_andamento', COALESCE(sum(valor_previsto) FILTER (WHERE status='em_andamento'),0),
    'valor_concluido',    COALESCE(sum(valor_previsto) FILTER (WHERE status='concluida'),0)
  )
  FROM public.projetos_obras
  WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids());
$$;

GRANT EXECUTE ON FUNCTION public.fn_obra_criar_de_orcamento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obras_listar(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_mudar_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obras_kpis(uuid[]) TO authenticated;
