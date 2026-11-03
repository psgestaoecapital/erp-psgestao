-- Hub · Gestão de Obras · Subempreiteiros (Blueprint §16 H7 · slice 1 — camada de dados)
-- Tabelas NOVAS, aditivas, com RLS por company_id (espelha projetos_obra_item) e REVOKE anon.
-- Registra o CONTRATO do subempreiteiro (fornecedor do cadastro GE = erp_fornecedores) ligado à obra,
-- com seus ITENS (descrição, unidade, quantidade, preço). SEM movimento financeiro aqui:
--   a medição → [→GE] erp_pagar com retenção/INSS/ISS é o slice 2 (reusa a GE, não recria financeiro).
-- Soft-delete rastreável (RD-98 p4) nas duas tabelas. retencao_pct fica como configuração do contrato
-- (o cálculo da retenção/encargos vive no slice 2).

-- 1) Cabeçalho do contrato do subempreiteiro -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obra_subempreiteiro_contrato (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  fornecedor_id  uuid NOT NULL REFERENCES public.erp_fornecedores(id),
  numero         text,
  objeto         text,                        -- escopo contratado ao sub
  valor_total    numeric NOT NULL DEFAULT 0,  -- total do contrato (soma dos itens ou informado)
  retencao_pct   numeric NOT NULL DEFAULT 0 CHECK (retencao_pct >= 0 AND retencao_pct <= 100),
  data_inicio        date,
  data_fim_prevista  date,
  status         text NOT NULL DEFAULT 'rascunho'
                   CHECK (status IN ('rascunho','ativo','concluido','cancelado')),
  observacoes    text,
  excluido_em     timestamptz,
  excluido_por    uuid,
  motivo_exclusao text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- 2) Itens do contrato --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obra_subempreiteiro_contrato_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  contrato_id    uuid NOT NULL REFERENCES public.obra_subempreiteiro_contrato(id) ON DELETE CASCADE,
  descricao      text NOT NULL,
  unidade        text,
  quantidade     numeric NOT NULL DEFAULT 0,
  preco_unitario numeric NOT NULL DEFAULT 0,
  valor          numeric GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,
  ordem          integer NOT NULL DEFAULT 0,
  excluido_em     timestamptz,
  excluido_por    uuid,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_contrato_obra ON public.obra_subempreiteiro_contrato(obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_sub_contrato_fornecedor ON public.obra_subempreiteiro_contrato(fornecedor_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_sub_contrato_item_contrato ON public.obra_subempreiteiro_contrato_item(contrato_id) WHERE excluido_em IS NULL;

-- 3) RLS por company_id (espelha projetos_obra_item: FOR ALL, company-scoped) + REVOKE anon -----------
ALTER TABLE public.obra_subempreiteiro_contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_subempreiteiro_contrato_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obra_subempreiteiro_contrato_rw ON public.obra_subempreiteiro_contrato;
CREATE POLICY obra_subempreiteiro_contrato_rw ON public.obra_subempreiteiro_contrato
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS obra_subempreiteiro_contrato_item_rw ON public.obra_subempreiteiro_contrato_item;
CREATE POLICY obra_subempreiteiro_contrato_item_rw ON public.obra_subempreiteiro_contrato_item
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.obra_subempreiteiro_contrato FROM anon;
REVOKE ALL ON public.obra_subempreiteiro_contrato_item FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_subempreiteiro_contrato TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_subempreiteiro_contrato_item TO authenticated, service_role;

-- 4) RPC de leitura: contratos da obra com itens e nome do fornecedor (guardada, somente leitura) ------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_contrato_listar(p_obra_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_obra public.projetos_obras%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'criado_em') DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ct.id,
      'numero', ct.numero,
      'objeto', ct.objeto,
      'fornecedor_id', ct.fornecedor_id,
      'fornecedor_nome', COALESCE(NULLIF(f.nome_fantasia, ''), f.razao_social, '(sem nome)'),
      'valor_total', ct.valor_total,
      'retencao_pct', ct.retencao_pct,
      'data_inicio', ct.data_inicio,
      'data_fim_prevista', ct.data_fim_prevista,
      'status', ct.status,
      'observacoes', ct.observacoes,
      'criado_em', ct.criado_em,
      'itens', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', it.id,
          'descricao', it.descricao,
          'unidade', it.unidade,
          'quantidade', it.quantidade,
          'preco_unitario', it.preco_unitario,
          'valor', it.valor,
          'ordem', it.ordem
        ) ORDER BY it.ordem, it.criado_em)
        FROM public.obra_subempreiteiro_contrato_item it
        WHERE it.contrato_id = ct.id AND it.excluido_em IS NULL
      ), '[]'::jsonb)
    ) AS c
    FROM public.obra_subempreiteiro_contrato ct
    LEFT JOIN public.erp_fornecedores f ON f.id = ct.fornecedor_id
    WHERE ct.obra_id = p_obra_id AND ct.excluido_em IS NULL
  ) q;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'contratos', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_contrato_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_contrato_listar(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.obra_subempreiteiro_contrato IS 'Blueprint §16 H7 slice 1: contrato do subempreiteiro (fornecedor GE) ligado à obra. Movimento financeiro (medição→erp_pagar, retenção/INSS/ISS) é o slice 2.';
COMMENT ON TABLE public.obra_subempreiteiro_contrato_item IS 'Itens do contrato do subempreiteiro (descrição, unidade, quantidade, preço). valor = quantidade * preco_unitario (gerado).';
