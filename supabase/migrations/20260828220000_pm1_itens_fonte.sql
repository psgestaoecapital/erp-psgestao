-- SPEC PM-1 (PR-D) · a TABELA agency_proposta_itens vira a FONTE dos itens (decisão CEO 28/08).
-- O jsonb agency_propostas.itens deixa de ser mestre: vira ESPELHO DE SAÍDA (tabela → jsonb), backup vivo
-- para leitores legados. RD-30: o jsonb NÃO é apagado. Item passa a ter vida própria (id estável, soft-delete).
--
-- ROLLBACK declarado (se algo quebrar): recriar o trigger do PR-B (jsonb→tabela) e dropar o espelho +
-- fn_agency_proposta_itens_sync; o editor volta a ler p.itens (jsonb). O jsonb continua íntegro (espelho o
-- manteve atualizado), então a volta é sem perda. Os SQLs do rollback estão no fim deste arquivo (comentados).

-- 1) aposenta o mirror jsonb→tabela do PR-B (a tabela agora manda; ele reconstruiria e apagaria o soft-delete)
DROP TRIGGER IF EXISTS tg_agency_proposta_itens_sync ON public.agency_propostas;
DROP FUNCTION IF EXISTS public.tg_agency_proposta_itens_sync();

-- 2) espelho de saída: tabela → jsonb (mantém agency_propostas.itens como backup vivo p/ leitores legados)
CREATE OR REPLACE FUNCTION public.tg_agency_proposta_jsonb_espelho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_prop uuid; v_itens jsonb;
BEGIN
  v_prop := COALESCE(NEW.proposta_id, OLD.proposta_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'servico_id', i.servico_id, 'tipo_servico', i.tipo_servico, 'descricao', i.descricao,
      'unidade', i.unidade, 'periodicidade', i.periodicidade, 'quantidade', i.quantidade,
      'valor_unitario', i.valor_unitario, 'valor_total', i.valor_total,
      'horas_estimadas', i.horas_estimadas, 'entregaveis', i.entregaveis
    ) ORDER BY i.ordem), '[]'::jsonb) INTO v_itens
    FROM public.agency_proposta_itens i
   WHERE i.proposta_id = v_prop AND i.excluido_em IS NULL;
  -- só o jsonb-espelho + updated_at; valor_total/valor_final são do editor (não mexe aqui, evita loop)
  UPDATE public.agency_propostas SET itens = v_itens, updated_at = now() WHERE id = v_prop;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS tg_agency_proposta_jsonb_espelho ON public.agency_proposta_itens;
CREATE TRIGGER tg_agency_proposta_jsonb_espelho
  AFTER INSERT OR UPDATE OR DELETE ON public.agency_proposta_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_proposta_jsonb_espelho();

-- 3) o editor concilia a lista de itens de uma vez: upsert dos presentes + soft-delete dos ausentes.
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_itens_sync(p_proposta_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid; e jsonb; v_ord int := 0; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM agency_propostas WHERE id = p_proposta_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- soft-delete dos itens que sumiram da lista (RD-30 — a linha não some)
  UPDATE agency_proposta_itens SET excluido_em = now()
   WHERE proposta_id = p_proposta_id AND excluido_em IS NULL
     AND id NOT IN (SELECT NULLIF(x->>'id','')::uuid FROM jsonb_array_elements(p_itens) x WHERE NULLIF(x->>'id','') IS NOT NULL);

  FOR e IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_ord := v_ord + 1;
    v_id := NULLIF(e->>'id','')::uuid;
    IF v_id IS NOT NULL THEN
      UPDATE agency_proposta_itens SET
        servico_id    = (SELECT s.id FROM agency_servico s WHERE s.id = NULLIF(e->>'servico_id','')::uuid),
        ordem         = v_ord,
        descricao     = COALESCE(NULLIF(btrim(e->>'descricao'), ''), 'Item'),
        tipo_servico  = NULLIF(btrim(e->>'tipo_servico'), ''),
        unidade       = COALESCE(NULLIF(btrim(e->>'unidade'), ''), 'un'),
        periodicidade = NULLIF(btrim(e->>'periodicidade'), ''),
        quantidade    = COALESCE((e->>'quantidade')::numeric, 1),
        valor_unitario= COALESCE((e->>'valor_unitario')::numeric, 0),
        horas_estimadas = (e->>'horas_estimadas')::numeric,
        entregaveis   = CASE WHEN jsonb_typeof(e->'entregaveis') IN ('array','object') THEN e->'entregaveis' ELSE NULL END,
        excluido_em   = NULL
       WHERE id = v_id AND proposta_id = p_proposta_id;
    ELSE
      INSERT INTO agency_proposta_itens
        (company_id, proposta_id, servico_id, ordem, descricao, tipo_servico, unidade, periodicidade, quantidade, valor_unitario, horas_estimadas, entregaveis)
      VALUES (v_company, p_proposta_id,
        (SELECT s.id FROM agency_servico s WHERE s.id = NULLIF(e->>'servico_id','')::uuid),
        v_ord, COALESCE(NULLIF(btrim(e->>'descricao'), ''), 'Item'), NULLIF(btrim(e->>'tipo_servico'), ''),
        COALESCE(NULLIF(btrim(e->>'unidade'), ''), 'un'), NULLIF(btrim(e->>'periodicidade'), ''),
        COALESCE((e->>'quantidade')::numeric, 1), COALESCE((e->>'valor_unitario')::numeric, 0),
        (e->>'horas_estimadas')::numeric,
        CASE WHEN jsonb_typeof(e->'entregaveis') IN ('array','object') THEN e->'entregaveis' ELSE NULL END);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true,
    'total_itens', (SELECT count(*) FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL),
    'valor_total', (SELECT COALESCE(sum(valor_total), 0) FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_agency_proposta_itens_sync(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_itens_sync(uuid, jsonb) TO authenticated, service_role;

-- ROLLBACK (se necessário):
--   DROP TRIGGER IF EXISTS tg_agency_proposta_jsonb_espelho ON public.agency_proposta_itens;
--   DROP FUNCTION IF EXISTS public.tg_agency_proposta_jsonb_espelho();
--   DROP FUNCTION IF EXISTS public.fn_agency_proposta_itens_sync(uuid, jsonb);
--   -- e recriar o trigger jsonb→tabela do PR-B (migração 20260828180000). O jsonb está íntegro (espelho manteve).
