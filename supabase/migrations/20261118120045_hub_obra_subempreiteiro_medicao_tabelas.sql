-- Hub · Gestão de Obras · Subempreiteiros (Blueprint §16 H7 · slice 2a — camada de dados da MEDIÇÃO)
-- Tabelas NOVAS, aditivas, com RLS por company_id (espelha obra_subempreiteiro_contrato) e REVOKE anon.
-- Registra a MEDIÇÃO do subempreiteiro (o quanto foi executado/medido num período) ligada ao CONTRATO,
-- com seus ITENS medidos (descrição, unidade, quantidade, preço = valor gerado).
-- SEM movimento financeiro aqui: a ponte medição aprovada → [→GE] erp_pagar com retenção/INSS/ISS é o
-- slice 2b (reusa a GE, não recria financeiro). Aqui só guardamos o quanto foi medido e a % de retenção
-- copiada do contrato no momento, para o cálculo viver no slice 2b.
-- Soft-delete rastreável (RD-98 p4) nas duas tabelas.

-- 1) Cabeçalho da medição --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obra_subempreiteiro_medicao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  contrato_id    uuid NOT NULL REFERENCES public.obra_subempreiteiro_contrato(id) ON DELETE CASCADE,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  numero         text,                        -- nº/sequência da medição no contrato (livre)
  competencia    date,                        -- mês de referência da medição
  data_medicao   date NOT NULL DEFAULT CURRENT_DATE,
  valor_bruto    numeric NOT NULL DEFAULT 0,  -- soma dos itens medidos (ou informado)
  retencao_pct   numeric NOT NULL DEFAULT 0   -- copiada do contrato no momento da medição
                   CHECK (retencao_pct >= 0 AND retencao_pct <= 100),
  status         text NOT NULL DEFAULT 'rascunho'
                   CHECK (status IN ('rascunho','aprovada','cancelada')),
  observacoes    text,
  excluido_em     timestamptz,
  excluido_por    uuid,
  motivo_exclusao text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- 2) Itens medidos -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obra_subempreiteiro_medicao_item (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  medicao_id        uuid NOT NULL REFERENCES public.obra_subempreiteiro_medicao(id) ON DELETE CASCADE,
  contrato_item_id  uuid REFERENCES public.obra_subempreiteiro_contrato_item(id),  -- item do contrato medido (opcional)
  descricao         text NOT NULL,
  unidade           text,
  quantidade        numeric NOT NULL DEFAULT 0,
  preco_unitario    numeric NOT NULL DEFAULT 0,
  valor             numeric GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,
  ordem             integer NOT NULL DEFAULT 0,
  excluido_em       timestamptz,
  excluido_por      uuid,
  criado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_medicao_contrato ON public.obra_subempreiteiro_medicao(contrato_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_sub_medicao_obra ON public.obra_subempreiteiro_medicao(obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_sub_medicao_item_medicao ON public.obra_subempreiteiro_medicao_item(medicao_id) WHERE excluido_em IS NULL;

-- 3) RLS por company_id (espelha obra_subempreiteiro_contrato: FOR ALL, company-scoped) + REVOKE anon ----
ALTER TABLE public.obra_subempreiteiro_medicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_subempreiteiro_medicao_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obra_subempreiteiro_medicao_rw ON public.obra_subempreiteiro_medicao;
CREATE POLICY obra_subempreiteiro_medicao_rw ON public.obra_subempreiteiro_medicao
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS obra_subempreiteiro_medicao_item_rw ON public.obra_subempreiteiro_medicao_item;
CREATE POLICY obra_subempreiteiro_medicao_item_rw ON public.obra_subempreiteiro_medicao_item
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.obra_subempreiteiro_medicao FROM anon;
REVOKE ALL ON public.obra_subempreiteiro_medicao_item FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_subempreiteiro_medicao TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_subempreiteiro_medicao_item TO authenticated, service_role;

-- 4) RPC de leitura: medições de um contrato, com itens (guardada, somente leitura) ---------------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_listar(p_contrato_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_company uuid;
  v_rows    jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.obra_subempreiteiro_contrato
   WHERE id = p_contrato_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'data_medicao') DESC, (m->>'criado_em') DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', md.id,
      'numero', md.numero,
      'competencia', md.competencia,
      'data_medicao', md.data_medicao,
      'valor_bruto', md.valor_bruto,
      'retencao_pct', md.retencao_pct,
      'valor_retencao', round(md.valor_bruto * md.retencao_pct / 100.0, 2),
      'valor_liquido', round(md.valor_bruto - (md.valor_bruto * md.retencao_pct / 100.0), 2),
      'status', md.status,
      'observacoes', md.observacoes,
      'criado_em', md.criado_em,
      'itens', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', it.id,
          'contrato_item_id', it.contrato_item_id,
          'descricao', it.descricao,
          'unidade', it.unidade,
          'quantidade', it.quantidade,
          'preco_unitario', it.preco_unitario,
          'valor', it.valor,
          'ordem', it.ordem
        ) ORDER BY it.ordem, it.criado_em)
        FROM public.obra_subempreiteiro_medicao_item it
        WHERE it.medicao_id = md.id AND it.excluido_em IS NULL
      ), '[]'::jsonb)
    ) AS m
    FROM public.obra_subempreiteiro_medicao md
    WHERE md.contrato_id = p_contrato_id AND md.excluido_em IS NULL
  ) q;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id, 'medicoes', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) TO authenticated, service_role;

-- 5) RPC de escrita: cria/edita a medição e substitui seus itens de forma rastreável -------------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(p_medicao jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_medicao_id  uuid := NULLIF(p_medicao->>'medicao_id','')::uuid;
  v_contrato_id uuid := NULLIF(p_medicao->>'contrato_id','')::uuid;
  v_contrato    public.obra_subempreiteiro_contrato%ROWTYPE;
  v_company     uuid;
  v_obra_id     uuid;
  v_status      text := COALESCE(NULLIF(p_medicao->>'status',''), 'rascunho');
  v_retencao    numeric;
  v_itens       jsonb := COALESCE(p_medicao->'itens', '[]'::jsonb);
  v_soma_itens  numeric;
  v_valor_bruto numeric;
BEGIN
  -- Em edição, o contrato vem da medição existente (não confia no payload)
  IF v_medicao_id IS NOT NULL THEN
    SELECT contrato_id INTO v_contrato_id FROM public.obra_subempreiteiro_medicao
     WHERE id = v_medicao_id AND excluido_em IS NULL;
    IF v_contrato_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada');
    END IF;
  END IF;

  IF v_contrato_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato é obrigatório');
  END IF;

  SELECT * INTO v_contrato FROM public.obra_subempreiteiro_contrato
   WHERE id = v_contrato_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
  END IF;
  v_company := v_contrato.company_id;
  v_obra_id := v_contrato.obra_id;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('rascunho','aprovada','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status inválido');
  END IF;

  -- Retenção: usa a informada (0–100) ou, na ausência, a % do contrato
  v_retencao := COALESCE(NULLIF(p_medicao->>'retencao_pct','')::numeric, v_contrato.retencao_pct, 0);
  IF v_retencao < 0 OR v_retencao > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Retenção deve estar entre 0 e 100%');
  END IF;

  -- valor_bruto: soma dos itens quando houver; senão o informado
  SELECT COALESCE(SUM((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric), 0)
    INTO v_soma_itens
  FROM jsonb_array_elements(v_itens) i;
  v_valor_bruto := CASE WHEN jsonb_array_length(v_itens) > 0
                        THEN v_soma_itens
                        ELSE COALESCE(NULLIF(p_medicao->>'valor_bruto','')::numeric, 0) END;

  IF v_medicao_id IS NULL THEN
    INSERT INTO public.obra_subempreiteiro_medicao
      (company_id, contrato_id, obra_id, numero, competencia, data_medicao,
       valor_bruto, retencao_pct, status, observacoes, criado_por)
    VALUES
      (v_company, v_contrato_id, v_obra_id,
       NULLIF(p_medicao->>'numero',''),
       NULLIF(p_medicao->>'competencia','')::date,
       COALESCE(NULLIF(p_medicao->>'data_medicao','')::date, CURRENT_DATE),
       v_valor_bruto, v_retencao, v_status,
       NULLIF(p_medicao->>'observacoes',''), auth.uid())
    RETURNING id INTO v_medicao_id;
  ELSE
    UPDATE public.obra_subempreiteiro_medicao SET
      numero        = NULLIF(p_medicao->>'numero',''),
      competencia   = NULLIF(p_medicao->>'competencia','')::date,
      data_medicao  = COALESCE(NULLIF(p_medicao->>'data_medicao','')::date, data_medicao),
      valor_bruto   = v_valor_bruto,
      retencao_pct  = v_retencao,
      status        = v_status,
      observacoes   = NULLIF(p_medicao->>'observacoes',''),
      atualizado_em = now()
    WHERE id = v_medicao_id AND company_id = v_company AND excluido_em IS NULL;
  END IF;

  -- Itens: substituição rastreável (soft-delete dos atuais + insere os enviados)
  UPDATE public.obra_subempreiteiro_medicao_item
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE medicao_id = v_medicao_id AND excluido_em IS NULL;

  INSERT INTO public.obra_subempreiteiro_medicao_item
    (company_id, medicao_id, contrato_item_id, descricao, unidade, quantidade, preco_unitario, ordem)
  SELECT v_company, v_medicao_id,
         NULLIF(i->>'contrato_item_id','')::uuid,
         COALESCE(NULLIF(i->>'descricao',''), '(sem descrição)'),
         NULLIF(i->>'unidade',''),
         COALESCE((i->>'quantidade')::numeric, 0),
         COALESCE((i->>'preco_unitario')::numeric, 0),
         COALESCE((i->>'ordem')::int, (ord.n - 1))
  FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS ord(i, n)
  WHERE COALESCE(NULLIF(i->>'descricao',''), '') <> '';

  RETURN jsonb_build_object('ok', true, 'medicao_id', v_medicao_id, 'valor_bruto', v_valor_bruto,
                            'retencao_pct', v_retencao);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(jsonb) TO authenticated, service_role;

-- 6) RPC de exclusão rastreável (soft-delete) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_excluir(p_medicao_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_company uuid;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão');
  END IF;

  SELECT company_id INTO v_company FROM public.obra_subempreiteiro_medicao
   WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada ou já excluída');
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  UPDATE public.obra_subempreiteiro_medicao_item
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE medicao_id = p_medicao_id AND excluido_em IS NULL;

  UPDATE public.obra_subempreiteiro_medicao
     SET excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo),
         atualizado_em = now()
   WHERE id = p_medicao_id;

  RETURN jsonb_build_object('ok', true, 'medicao_id', p_medicao_id);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_excluir(uuid, text) TO authenticated, service_role;

COMMENT ON TABLE public.obra_subempreiteiro_medicao IS 'Blueprint §16 H7 slice 2a: medição do subempreiteiro (quanto foi executado/medido por período) ligada ao contrato. A ponte medição aprovada→erp_pagar com retenção/INSS/ISS é o slice 2b.';
COMMENT ON TABLE public.obra_subempreiteiro_medicao_item IS 'Itens medidos da medição do subempreiteiro. valor = quantidade * preco_unitario (gerado). contrato_item_id liga ao item do contrato (opcional).';
