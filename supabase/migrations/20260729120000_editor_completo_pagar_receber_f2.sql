-- EDITOR COMPLETO de Lançamentos Pagar/Receber (F2). Antes: fn_pagar_editar/fn_receber_editar só gravavam
-- 4 campos (descricao, valor, data_vencimento, numero_documento). Agora: TODOS os campos editáveis num único
-- save, com trilha em erp_lancamento_log gravando SÓ o que mudou (de→para). RD-55 aditivo (as RPCs antigas
-- seguem existindo p/ a edição inline); RD-52 uma fonte de verdade (o whitelist de colunas vive na RPC);
-- RD-51 nada mascarado (o log guarda o diff real). NÃO bloqueia editar pago/conciliado — o aviso é na UI.
-- Campos de sistema NUNCA entram no whitelist: id, company_id, created_at, updated_at, import_hash,
-- ref_externa_*, importado_em, ultima_sync, conciliado, movimento_banco_id, boleto_*, deleted_*, fornecedor_id,
-- cliente_id, aprovado_por, score_antifraude, valor_pago, status (fluxos próprios: marcar pago / conciliação).

-- ── PAGAR ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_editar_completo(p_id uuid, p_campos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  v_tipos jsonb := jsonb_build_object(
    'fornecedor_nome','text','descricao','text','categoria','text','valor','numeric',
    'data_emissao','date','data_vencimento','date','data_pagamento','date','data_competencia','date',
    'forma_pagamento','text','numero_documento','text','numero_nf','text','codigo_barras','text',
    'parcela','text','conta_bancaria','text','centro_custo','text','linha_negocio','text',
    'juros','numeric','multa','numeric','desconto','numeric','observacoes','text',
    'recorrente','boolean','recorrencia_meses','integer');
  v_notnull text[] := ARRAY['descricao','valor','data_vencimento'];
  v_antes jsonb; v_depois jsonb; v_company_id uuid; v_email text := public.fn_user_email_atual();
  v_sets text := ''; v_alterados jsonb; k text; t text;
BEGIN
  SELECT to_jsonb(p.*), p.company_id INTO v_antes, v_company_id FROM public.erp_pagar p WHERE p.id = p_id;
  IF v_antes IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  FOR k, t IN SELECT * FROM jsonb_each_text(v_tipos) LOOP
    IF NOT (p_campos ? k) THEN CONTINUE; END IF;
    -- NOT NULL: nunca zera um campo obrigatório (RD-51 — vazio não vira NULL à força)
    IF k = ANY(v_notnull) AND NULLIF(p_campos->>k,'') IS NULL THEN CONTINUE; END IF;
    v_sets := v_sets || format('%I = NULLIF($1->>%L,'''')::%s, ', k, k, t);
  END LOOP;

  IF v_sets = '' THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', '{}'::jsonb, 'sem_mudanca', true); END IF;

  EXECUTE format('UPDATE public.erp_pagar SET %s updated_at = now() WHERE id = $2', v_sets) USING p_campos, p_id;
  SELECT to_jsonb(p.*) INTO v_depois FROM public.erp_pagar p WHERE p.id = p_id;

  -- diff: só os campos do whitelist que de fato mudaram (de→para)
  SELECT COALESCE(jsonb_object_agg(kk, jsonb_build_object('de', v_antes->kk, 'para', v_depois->kk)), '{}'::jsonb)
    INTO v_alterados
  FROM (SELECT jsonb_object_keys(v_tipos) AS kk) s
  WHERE (v_antes->>kk) IS DISTINCT FROM (v_depois->>kk);

  IF v_alterados <> '{}'::jsonb THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'EDITOU', v_alterados, 'erp_pagar');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', v_alterados);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pagar_editar_completo(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pagar_editar_completo(uuid, jsonb) TO authenticated;

-- ── RECEBER ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receber_editar_completo(p_id uuid, p_campos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  v_tipos jsonb := jsonb_build_object(
    'cliente_nome','text','descricao','text','categoria','text','valor','numeric',
    'data_emissao','date','data_vencimento','date','data_pagamento','date','data_competencia','date',
    'forma_pagamento','text','numero_documento','text','numero_nf','text',
    'parcela','text','conta_bancaria','text','centro_custo','text','linha_negocio','text',
    'juros','numeric','multa','numeric','desconto','numeric','observacoes','text',
    'recorrente','boolean','recorrencia_meses','integer','contrato_id','uuid');
  v_notnull text[] := ARRAY['descricao','valor','data_vencimento'];
  v_antes jsonb; v_depois jsonb; v_company_id uuid; v_email text := public.fn_user_email_atual();
  v_sets text := ''; v_alterados jsonb; k text; t text;
BEGIN
  SELECT to_jsonb(r.*), r.company_id INTO v_antes, v_company_id FROM public.erp_receber r WHERE r.id = p_id;
  IF v_antes IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  FOR k, t IN SELECT * FROM jsonb_each_text(v_tipos) LOOP
    IF NOT (p_campos ? k) THEN CONTINUE; END IF;
    IF k = ANY(v_notnull) AND NULLIF(p_campos->>k,'') IS NULL THEN CONTINUE; END IF;
    v_sets := v_sets || format('%I = NULLIF($1->>%L,'''')::%s, ', k, k, t);
  END LOOP;

  IF v_sets = '' THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', '{}'::jsonb, 'sem_mudanca', true); END IF;

  EXECUTE format('UPDATE public.erp_receber SET %s updated_at = now() WHERE id = $2', v_sets) USING p_campos, p_id;
  SELECT to_jsonb(r.*) INTO v_depois FROM public.erp_receber r WHERE r.id = p_id;

  SELECT COALESCE(jsonb_object_agg(kk, jsonb_build_object('de', v_antes->kk, 'para', v_depois->kk)), '{}'::jsonb)
    INTO v_alterados
  FROM (SELECT jsonb_object_keys(v_tipos) AS kk) s
  WHERE (v_antes->>kk) IS DISTINCT FROM (v_depois->>kk);

  IF v_alterados <> '{}'::jsonb THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'EDITOU', v_alterados, 'erp_receber');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', v_alterados);
END $function$;
REVOKE ALL ON FUNCTION public.fn_receber_editar_completo(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_receber_editar_completo(uuid, jsonb) TO authenticated;
