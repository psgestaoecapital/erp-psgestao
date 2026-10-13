-- P&M · Contrato com escopo amarrado à produção — Fase 1 (SPEC Eng. Chefe 04/09/2026)
-- "Saber se está produzindo o que está no contrato, ou a mais ou a menos."
-- Decisões do CEO: (A) erp_contrato_id em agency_contratos (1:1), itens/jobs FICAM em agency_contratos,
-- o contrato oficial da GE é alcançado pelo link — sem quebrar a cadeia. Fee LIDO da GE (fonte única).
-- (B) janela por ITEM: mensal=mês civil, trimestral=trimestre, projeto=vida toda. (C) conta CRIADO
-- (job = compromisso), "entregues" (publicado) como coluna extra; cancelado NÃO conta.

-- ============================================================================
-- A) Vínculo com o contrato oficial da GE (1:1). Não bloqueia existentes.
-- ============================================================================
ALTER TABLE public.agency_contratos
  ADD COLUMN IF NOT EXISTS erp_contrato_id uuid REFERENCES public.erp_contratos(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_contratos_erp_contrato
  ON public.agency_contratos (erp_contrato_id) WHERE erp_contrato_id IS NOT NULL;

-- ============================================================================
-- Forward-compat p/ Fase 2 (IA): origem/confirmação/trecho/confiança do item.
-- Fase 1 (manual) usa os defaults (manual/confirmado). RD-58: item IA nasce sugestão.
-- ============================================================================
ALTER TABLE public.agency_contrato_itens
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confirmado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trecho text,
  ADD COLUMN IF NOT EXISTS confianca text;
-- SPEC §7.2: item sem quantidade é válido ("sem limite contratado"). Hoje a coluna é NOT NULL — solta.
ALTER TABLE public.agency_contrato_itens ALTER COLUMN quantidade_contratada DROP NOT NULL;

-- ============================================================================
-- Janela do item por periodicidade (mês civil / trimestre / vida toda) — fonte única
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_item_janela(p_periodicidade text, p_ref date)
RETURNS TABLE(ini date, fim date)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE lower(btrim(COALESCE(p_periodicidade,'')))
           WHEN 'mensal' THEN date_trunc('month', p_ref)::date
           WHEN 'trimestral' THEN date_trunc('quarter', p_ref)::date
           ELSE NULL END,                                   -- projeto/único/nulo → vida toda
         CASE lower(btrim(COALESCE(p_periodicidade,'')))
           WHEN 'mensal' THEN (date_trunc('month', p_ref) + interval '1 month')::date
           WHEN 'trimestral' THEN (date_trunc('quarter', p_ref) + interval '3 months')::date
           ELSE NULL END;
$$;

-- ============================================================================
-- Contratado × realizado — POR servico_id (com fallback texto p/ legado), POR período.
-- Conta CRIADO (exclui cancelado); "entregues"=publicado como extra. Item sem quantidade=sem limite.
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_agency_contrato_realizado(uuid);
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_realizado(p_contrato_id uuid, p_periodo_ref date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb; v_sem_servico jsonb;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_itens FROM (
    SELECT
      ci.id AS item_id, ci.servico_id, ci.tipo_servico,
      COALESCE(sv.nome, ci.tipo_servico) AS servico_nome,
      ci.quantidade_contratada, ci.unidade, ci.periodicidade,
      (ci.quantidade_contratada IS NULL) AS sem_limite,
      jn.ini AS periodo_ini, jn.fim AS periodo_fim,
      cnt.criados, cnt.entregues,
      CASE WHEN ci.quantidade_contratada IS NULL THEN NULL
           ELSE ci.quantidade_contratada - cnt.criados END AS saldo,
      CASE
        WHEN ci.quantidade_contratada IS NULL THEN 'sem_limite'
        WHEN cnt.criados > ci.quantidade_contratada THEN 'a_mais'
        WHEN cnt.criados = ci.quantidade_contratada THEN 'em_dia'
        ELSE 'a_menos' END AS situacao
    FROM agency_contrato_itens ci
    LEFT JOIN agency_servico sv ON sv.id = ci.servico_id
    CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, p_periodo_ref) jn
    CROSS JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE TRUE) AS criados,
        count(*) FILTER (WHERE j.status = 'publicado') AS entregues
      FROM agency_jobs j
      WHERE j.contrato_id = p_contrato_id
        AND j.status NOT IN ('cancelado','cancelada')
        AND (
          (ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
          OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico)))
        )
        AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
    ) cnt
    WHERE ci.contrato_id = p_contrato_id
    ORDER BY ci.tipo_servico
  ) t;

  -- jobs sem serviço vinculado (servico_id nulo) — trabalho que some do controle
  SELECT jsonb_agg(jsonb_build_object('tipo', tp, 'qtd', qtd)) INTO v_sem_servico FROM (
    SELECT COALESCE(NULLIF(lower(btrim(tipo)),''),'(sem tipo)') tp, count(*) qtd
    FROM agency_jobs j
    WHERE j.contrato_id = p_contrato_id AND j.servico_id IS NULL
      AND j.status NOT IN ('cancelado','cancelada')
    GROUP BY 1 ORDER BY 2 DESC
  ) x;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id,
    'periodo_ref', p_periodo_ref,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'jobs_sem_servico', COALESCE(v_sem_servico, '[]'::jsonb));
END;
$function$;

-- ============================================================================
-- Listar — agora traz erp_contrato_id + fee LIDO da GE, e "a mais" do MÊS corrente
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_agency_contrato_listar(uuid);
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_listar(p_company_id uuid)
RETURNS TABLE(contrato_id uuid, cliente_nome text, erp_cliente_id uuid, proposta_id uuid, tipo text,
  fee_mensal numeric, ge_valor_mensal numeric, erp_contrato_id uuid, tem_contrato_ge boolean,
  status text, data_inicio date, itens_total integer, itens_a_mais integer, escopo_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT c.id,
    COALESCE(ac.nome_fantasia, ac.nome, ec.nome_fantasia, ec.razao_social, '—'),
    c.erp_cliente_id, c.proposta_id, c.tipo,
    c.fee_mensal, gc.valor_atual, c.erp_contrato_id, (c.erp_contrato_id IS NOT NULL),
    c.status, c.data_inicio,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) AS itens_total,
    (SELECT count(*)::int FROM agency_contrato_itens ci
       CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, CURRENT_DATE) jn
       WHERE ci.contrato_id = c.id AND ci.quantidade_contratada IS NOT NULL
         AND (SELECT count(*) FROM agency_jobs j
              WHERE j.contrato_id = c.id AND j.status NOT IN ('cancelado','cancelada')
                AND ((ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
                     OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))))
                AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
             ) > ci.quantidade_contratada) AS itens_a_mais,
    CASE WHEN (SELECT count(*) FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) = 0
         THEN 'sem_escopo' ELSE 'com_escopo' END AS escopo_status
  FROM agency_contratos c
  LEFT JOIN agency_clientes ac ON ac.id = c.cliente_id
  LEFT JOIN erp_clientes ec ON ec.id = c.erp_cliente_id
  LEFT JOIN erp_contratos gc ON gc.id = c.erp_contrato_id
  WHERE c.company_id = p_company_id
  ORDER BY c.criado_em DESC;
END;
$function$;

-- ============================================================================
-- CRUD de itens do escopo (de-para com o catálogo) + vínculo com o contrato da GE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_item_salvar(p_contrato_id uuid, p_item jsonb, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid; v_tipo text := NULLIF(btrim(p_item->>'tipo_servico'),''); v_qtd numeric;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_tipo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'servico_obrigatorio', 'campo', 'tipo_servico'); END IF;
  -- quantidade é OPCIONAL (nulo = sem limite contratado). Se veio, tem de ser > 0.
  BEGIN v_qtd := NULLIF(btrim(p_item->>'quantidade_contratada'),'')::numeric; EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'quantidade_invalida', 'campo', 'quantidade_contratada'); END;
  IF v_qtd IS NOT NULL AND v_qtd <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'quantidade_invalida', 'campo', 'quantidade_contratada'); END IF;

  v_id := NULLIF(p_item->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO agency_contrato_itens (company_id, contrato_id, servico_id, tipo_servico, quantidade_contratada,
        unidade, periodicidade, valor_unitario, origem, confirmado, trecho, confianca)
    VALUES (v_company, p_contrato_id, NULLIF(p_item->>'servico_id','')::uuid, v_tipo, v_qtd,
        NULLIF(btrim(p_item->>'unidade'),''), NULLIF(btrim(p_item->>'periodicidade'),''),
        NULLIF(btrim(p_item->>'valor_unitario'),'')::numeric,
        COALESCE(NULLIF(btrim(p_item->>'origem'),''),'manual'),
        COALESCE((p_item->>'confirmado')::boolean, true),
        NULLIF(btrim(p_item->>'trecho'),''), NULLIF(btrim(p_item->>'confianca'),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE agency_contrato_itens SET
      servico_id = NULLIF(p_item->>'servico_id','')::uuid, tipo_servico = v_tipo,
      quantidade_contratada = v_qtd, unidade = NULLIF(btrim(p_item->>'unidade'),''),
      periodicidade = NULLIF(btrim(p_item->>'periodicidade'),''),
      valor_unitario = NULLIF(btrim(p_item->>'valor_unitario'),'')::numeric,
      confirmado = COALESCE((p_item->>'confirmado')::boolean, confirmado)
    WHERE id = v_id AND contrato_id = p_contrato_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_agency_contrato_item_excluir(p_item_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM agency_contrato_itens WHERE id = p_item_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM agency_contrato_itens WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- vincula o contrato da agência ao contrato oficial da GE (1:1 garantido pelo índice único)
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_vincular_erp(p_agency_contrato_id uuid, p_erp_contrato_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_ge_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_agency_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_erp_contrato_id IS NOT NULL THEN
    SELECT company_id INTO v_ge_company FROM erp_contratos WHERE id = p_erp_contrato_id;
    IF v_ge_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_ge_nao_encontrado'); END IF;
    IF v_ge_company <> v_company THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_ge_de_outra_empresa'); END IF;
    IF EXISTS (SELECT 1 FROM agency_contratos WHERE erp_contrato_id = p_erp_contrato_id AND id <> p_agency_contrato_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contrato_ge_ja_vinculado'); END IF;
  END IF;
  UPDATE agency_contratos SET erp_contrato_id = p_erp_contrato_id, atualizado_em = now() WHERE id = p_agency_contrato_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_item_janela(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_realizado(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_item_salvar(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_item_excluir(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_vincular_erp(uuid, uuid, uuid) TO authenticated;
