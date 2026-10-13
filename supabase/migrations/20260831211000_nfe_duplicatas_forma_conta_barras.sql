-- NF-e Recebida Bloco 2 · §5 — forma de pagamento, conta e código de barras na duplicata.
-- Aditivo: campos OPCIONAIS. Nota sem eles continua funcionando igual.
-- RD-44: a FK canônica de conta é erp_banco_contas (NÃO erp_contas_bancarias). erp_pagar guarda
-- conta_bancaria como TEXTO → o gerar_pagar resolve o conta_bancaria_id para o nome da conta.

-- 5.1 · colunas novas na duplicata
ALTER TABLE public.erp_nfe_recebidas_duplicatas
  ADD COLUMN IF NOT EXISTS forma_pagamento   text,
  ADD COLUMN IF NOT EXISTS conta_bancaria_id uuid REFERENCES public.erp_banco_contas(id),
  ADD COLUMN IF NOT EXISTS codigo_barras     text;

-- 5.2 · dup_editar aceita os 3 campos; código de barras valida 44/47 dígitos (avisa, NÃO bloqueia)
CREATE OR REPLACE FUNCTION public.fn_nfe_duplicatas_editar(p_nfe_id uuid, p_parcelas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v erp_nfe_recebidas%ROWTYPE; e jsonb; v_soma numeric := 0; v_n int := 0;
        v_cb text; v_avisos jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota_nao_encontrada'); END IF;
  IF v.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v.lancado_pagar THEN RETURN jsonb_build_object('ok',false,'erro','ja_lancado'); END IF;   -- depois de gerado é na tela de contas a pagar
  SELECT COALESCE(sum((x->>'valor')::numeric),0) INTO v_soma FROM jsonb_array_elements(COALESCE(p_parcelas,'[]'::jsonb)) x;
  IF abs(v_soma - COALESCE(v.valor_total,0)) > 0.02 THEN
    RETURN jsonb_build_object('ok',false,'erro','soma_nao_bate','soma_parcelas',v_soma,'valor_nota',v.valor_total); END IF;
  DELETE FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id=v.id AND pagar_id IS NULL;   -- só as ainda não geradas
  FOR e IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    v_cb := NULLIF(regexp_replace(COALESCE(e->>'codigo_barras',''), '\D', '', 'g'), '');
    -- 44 = arrecadação/concessionária · 47 = linha digitável de boleto. Fora disso, AVISA, não bloqueia.
    IF v_cb IS NOT NULL AND length(v_cb) NOT IN (44, 47) THEN
      v_avisos := v_avisos || jsonb_build_object('parcela', v_n, 'codigo_barras_digitos', length(v_cb)); END IF;
    INSERT INTO erp_nfe_recebidas_duplicatas (nfe_recebida_id, company_id, numero_dup, data_vencimento, valor,
      forma_pagamento, conta_bancaria_id, codigo_barras)
    VALUES (v.id, v.company_id, COALESCE(NULLIF(e->>'numero',''), v_n::text), (e->>'vencimento')::date, (e->>'valor')::numeric,
      NULLIF(e->>'forma_pagamento',''), NULLIF(e->>'conta_bancaria_id','')::uuid, v_cb);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'parcelas',v_n,'soma',v_soma,'avisos_codigo_barras',v_avisos);
END $function$;

-- 5.3 · gerar_pagar repassa forma/conta(texto)/código de barras ao erp_pagar — cirúrgico no INSERT do ramo duplicata.
DO $$
DECLARE v_def text; v_new text; v_oc int; a text; b text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='fn_nfe_recebida_gerar_pagar' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_nfe_recebida_gerar_pagar nao encontrada'; END IF;
  -- idempotente: se já repassa, não faz nada
  IF position('bc.id = d.conta_bancaria_id' IN v_def) > 0 THEN RETURN; END IF;

  -- âncora A: lista de colunas do INSERT do ramo duplicata (único com 'parcela,')
  a := 'parcela, ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes)';
  v_oc := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'ancora A (colunas) esperava 1, achei %', v_oc; END IF;
  v_new := replace(v_def, a, 'parcela, ref_externa_id, ref_externa_sistema, import_hash, importado_em, observacoes, forma_pagamento, conta_bancaria, codigo_barras)');

  -- âncora B: observacoes do ramo duplicata (o ramo sem-duplicata diz 'sem duplicatas')
  b := '''Gerado automaticamente da NF-e de compra (DF-e). Chave ''||v.chave_acesso)';
  v_oc := (length(v_new) - length(replace(v_new, b, ''))) / length(b);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'ancora B (values) esperava 1, achei %', v_oc; END IF;
  v_new := replace(v_new, b,
    '''Gerado automaticamente da NF-e de compra (DF-e). Chave ''||v.chave_acesso, d.forma_pagamento, (SELECT bc.nome FROM erp_banco_contas bc WHERE bc.id = d.conta_bancaria_id), d.codigo_barras)');

  EXECUTE v_new;
END $$;
