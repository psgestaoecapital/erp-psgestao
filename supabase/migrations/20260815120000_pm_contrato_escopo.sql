-- P&M · Contrato com escopo quantificado (moat). Origem: Eng. Chefe 15/08. Etapa entre Proposta e Campanha.
-- O sistema lê o escopo contratado (qtd/tipo de serviços) e compara contratado × realizado (jobs), sinalizando
-- ultrapassagem. Reusa agency_contratos (P&M) e agency_propostas.itens; o financeiro fica na GE (lancamento_id).
-- Cliente unificado (#1017): casa Lead → Proposta → Contrato pelo mesmo erp_cliente_id.
-- 100% aditivo (RD-30/RD-54): ADD COLUMN/INDEX/TABLE/FUNCTION + backfill que só preenche nulos.
-- Auditado (RD-26): agency_jobs.status ∈ {nao_iniciada, em_aprovacao, publicado} (entregue=publicado),
--   agency_jobs.tipo livre (design/social...), contrato_id já existe (Fase 0). agency_contratos.tipo ∈
--   {recorrente, projeto}, status ∈ {rascunho, ativo, suspenso, encerrado}. Sem erp_cliente_id → adicionado.

-- ── 1) Elo mestre no contrato (casar por erp_cliente_id) ─────────────────────────────
ALTER TABLE public.agency_contratos
  ADD COLUMN IF NOT EXISTS erp_cliente_id uuid REFERENCES public.erp_clientes(id);
CREATE INDEX IF NOT EXISTS idx_agency_contratos_erp_cliente ON public.agency_contratos(erp_cliente_id);

-- ── 2) Tabela de itens (escopo quantificado) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_contrato_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  contrato_id uuid NOT NULL REFERENCES public.agency_contratos(id) ON DELETE CASCADE,
  tipo_servico text NOT NULL,              -- ex.: 'post', 'reels', 'campanha', 'design', 'social'
  quantidade_contratada numeric NOT NULL,
  unidade text,                            -- ex.: 'un/mes', 'un/campanha'
  periodicidade text,                      -- 'mensal' | 'unica' | 'campanha'
  valor_unitario numeric,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE public.agency_contrato_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_contrato_itens_rls ON public.agency_contrato_itens;
CREATE POLICY agency_contrato_itens_rls ON public.agency_contrato_itens
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE INDEX IF NOT EXISTS idx_agency_contrato_itens ON public.agency_contrato_itens(company_id, contrato_id);

-- ── 3) Backfill aditivo: erp_cliente_id do contrato a partir da proposta ─────────────
UPDATE public.agency_contratos c
SET erp_cliente_id = p.erp_cliente_id
FROM public.agency_propostas p
WHERE c.proposta_id = p.id AND p.erp_cliente_id IS NOT NULL AND c.erp_cliente_id IS NULL;

-- ── 4) fn_agency_contrato_criar — cria o contrato P&M a partir de uma proposta aprovada ─────────────
-- Herda cliente unificado (erp + agency via resolver), fee/valor e os itens de escopo da proposta.
-- Idempotente por proposta (RD-52): um contrato por proposta.
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_criar(p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prop agency_propostas%ROWTYPE;
  v_company uuid; v_erp uuid; v_agency uuid; v_contrato uuid;
  v_tipo text := NULLIF(btrim(p_campos->>'tipo'), '');
  v_itens_criados int := 0; v_ja_existia boolean := false;
BEGIN
  SELECT * INTO v_prop FROM agency_propostas WHERE id = NULLIF(btrim(p_campos->>'proposta_id'), '')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  v_company := v_prop.company_id;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso à empresa');
  END IF;
  IF v_prop.status <> 'aprovada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'proposta não está aprovada');
  END IF;

  -- cliente unificado: erp (mestre) + agency (resolvido, nunca id de erp numa FK de agency)
  v_erp := v_prop.erp_cliente_id;
  v_agency := v_prop.cliente_id;
  IF v_agency IS NULL AND v_erp IS NOT NULL THEN
    v_agency := fn_agency_cliente_resolver(v_company, v_erp);
  END IF;

  IF v_tipo IS NULL OR v_tipo NOT IN ('recorrente', 'projeto') THEN
    v_tipo := CASE WHEN COALESCE(v_prop.condicao_pagamento, '') ILIKE '%projeto%' THEN 'projeto' ELSE 'recorrente' END;
  END IF;

  -- idempotência: um contrato por proposta
  SELECT id INTO v_contrato FROM agency_contratos WHERE proposta_id = v_prop.id LIMIT 1;
  IF v_contrato IS NOT NULL THEN
    v_ja_existia := true;
    UPDATE agency_contratos SET erp_cliente_id = COALESCE(erp_cliente_id, v_erp), atualizado_em = now() WHERE id = v_contrato;
  ELSE
    INSERT INTO agency_contratos (
      company_id, cliente_id, erp_cliente_id, proposta_id, tipo, fee_mensal, valor_projeto,
      dia_vencimento, data_inicio, status, responsavel_id, lancamento_id
    ) VALUES (
      v_company, v_agency, v_erp, v_prop.id, v_tipo,
      COALESCE(NULLIF(p_campos->>'fee_mensal', '')::numeric, v_prop.valor_final),
      v_prop.valor_final,
      COALESCE(NULLIF(p_campos->>'dia_vencimento', '')::int, 10),
      COALESCE(NULLIF(btrim(p_campos->>'data_inicio'), '')::date, CURRENT_DATE),
      'ativo',
      COALESCE(NULLIF(btrim(p_campos->>'responsavel_id'), '')::uuid, v_prop.responsavel_id),
      v_prop.lancamento_id
    ) RETURNING id INTO v_contrato;

    -- escopo a partir dos itens da proposta (base)
    INSERT INTO agency_contrato_itens (company_id, contrato_id, tipo_servico, quantidade_contratada, unidade, periodicidade, valor_unitario)
    SELECT v_company, v_contrato,
      COALESCE(NULLIF(btrim(it->>'tipo_servico'), ''), NULLIF(btrim(it->>'descricao'), '')),
      COALESCE(NULLIF(it->>'quantidade', '')::numeric, 1),
      NULLIF(btrim(it->>'unidade'), ''),
      CASE WHEN COALESCE(v_prop.condicao_pagamento, '') ILIKE '%mensal%' THEN 'mensal'
           WHEN COALESCE(v_prop.condicao_pagamento, '') ILIKE '%projeto%' THEN 'unica' ELSE 'mensal' END,
      NULLIF(it->>'valor_unitario', '')::numeric
    FROM jsonb_array_elements(COALESCE(v_prop.itens, '[]'::jsonb)) it
    WHERE COALESCE(NULLIF(btrim(it->>'tipo_servico'), ''), NULLIF(btrim(it->>'descricao'), '')) IS NOT NULL;
    GET DIAGNOSTICS v_itens_criados = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_contrato, 'ja_existia', v_ja_existia,
                            'erp_cliente_id', v_erp, 'cliente_id', v_agency, 'itens_criados', v_itens_criados);
END;
$function$;

-- ── 5) fn_agency_contrato_realizado — contratado × realizado por tipo_servico + ultrapassagem ───────
-- Realizado = jobs ligados ao contrato (contrato_id), casados ao item por lower(trim(tipo)). "entregues" =
-- status 'publicado'. "solicitados" = todos os jobs do tipo (é o que dispara a ultrapassagem — "ao solicitar
-- além da qtd"). Jobs cujo tipo não casa com nenhum item aparecem em nao_mapeados (transparência, RD-58).
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_realizado(p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_itens jsonb; v_nao_map jsonb; v_estourados int;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato não encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_itens FROM (
    SELECT ci.tipo_servico, ci.quantidade_contratada, ci.unidade, ci.periodicidade,
      COALESCE(j.solicitados, 0) AS solicitados,
      COALESCE(j.entregues, 0) AS entregues,
      CASE WHEN ci.quantidade_contratada > 0
           THEN round(COALESCE(j.solicitados, 0)::numeric / ci.quantidade_contratada * 100, 1) ELSE NULL END AS percentual,
      (COALESCE(j.solicitados, 0) >= ci.quantidade_contratada) AS ultrapassou
    FROM agency_contrato_itens ci
    LEFT JOIN (
      SELECT lower(btrim(tipo)) tp, count(*) solicitados, count(*) FILTER (WHERE status = 'publicado') entregues
      FROM agency_jobs WHERE contrato_id = p_contrato_id GROUP BY lower(btrim(tipo))
    ) j ON j.tp = lower(btrim(ci.tipo_servico))
    WHERE ci.contrato_id = p_contrato_id
    ORDER BY ci.tipo_servico
  ) t;

  SELECT jsonb_agg(jsonb_build_object('tipo', tp, 'qtd', qtd)) INTO v_nao_map FROM (
    SELECT lower(btrim(tipo)) tp, count(*) qtd FROM agency_jobs
    WHERE contrato_id = p_contrato_id
      AND lower(btrim(tipo)) NOT IN (SELECT lower(btrim(tipo_servico)) FROM agency_contrato_itens WHERE contrato_id = p_contrato_id)
    GROUP BY lower(btrim(tipo))
  ) x;

  SELECT count(*) INTO v_estourados FROM agency_contrato_itens ci
  WHERE ci.contrato_id = p_contrato_id
    AND (SELECT count(*) FROM agency_jobs j WHERE j.contrato_id = p_contrato_id AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))) >= ci.quantidade_contratada;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'nao_mapeados', COALESCE(v_nao_map, '[]'::jsonb),
    'itens_estourados', v_estourados);
END;
$function$;

-- ── 6) fn_agency_contrato_listar — contratos + status de escopo (dentro/estourado) ──────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_listar(p_company_id uuid)
 RETURNS TABLE(contrato_id uuid, cliente_nome text, erp_cliente_id uuid, proposta_id uuid, tipo text,
               fee_mensal numeric, status text, data_inicio date, itens_total int, itens_estourados int, escopo_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT c.id,
    COALESCE(ac.nome_fantasia, ac.nome, ec.nome_fantasia, ec.razao_social, '—'),
    c.erp_cliente_id, c.proposta_id, c.tipo, c.fee_mensal, c.status, c.data_inicio,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) AS itens_total,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id
        AND (SELECT count(*) FROM agency_jobs j WHERE j.contrato_id = c.id AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))) >= ci.quantidade_contratada) AS itens_estourados,
    CASE WHEN (SELECT count(*) FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id
                 AND (SELECT count(*) FROM agency_jobs j WHERE j.contrato_id = c.id AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))) >= ci.quantidade_contratada) > 0
         THEN 'estourado' ELSE 'dentro' END AS escopo_status
  FROM agency_contratos c
  LEFT JOIN agency_clientes ac ON ac.id = c.cliente_id
  LEFT JOIN erp_clientes ec ON ec.id = c.erp_cliente_id
  WHERE c.company_id = p_company_id
  ORDER BY c.criado_em DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_criar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_realizado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_listar(uuid) TO authenticated;
