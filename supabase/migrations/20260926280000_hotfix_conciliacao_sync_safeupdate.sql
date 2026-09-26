-- HOTFIX #38 (26/09) · a conciliação de CONTAS A RECEBER falhava pela API com
--   400 {"code":"21000","message":"DELETE requires a WHERE clause"}
-- Causa provada (aceitação @pos-migration, run 36260932868): fn_receber_conciliacao_sync (migration 20260926260000)
-- limpa a tabela temporária com "DELETE FROM _conc_desejado;" — o pg-safeupdate do PostgREST recusa DELETE sem WHERE
-- em toda chamada via API (a prova em rollback rodou como postgres, sem a trava). Correção: "WHERE true".
-- Nada mais muda. Aplicado à mão no banco em 26/09 (hotfix, produção quebrada) com ESTA versão registrada no ledger (RD-52).
CREATE OR REPLACE FUNCTION public.fn_receber_conciliacao_sync(p_receber_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; d record; x record;
  v_b uuid; v_liq numeric; v_soma numeric; v_n int; v_ativas numeric; v_falta numeric;
BEGIN
  SELECT id, company_id, valor, COALESCE(juros,0) AS j, COALESCE(multa,0) AS mu, COALESCE(desconto,0) AS de, forma_pagamento
    INTO r FROM public.erp_receber WHERE id = p_receber_id;
  IF r.id IS NULL THEN RETURN; END IF;
  v_liq := round(r.valor + r.j + r.mu - r.de, 2);

  -- créditos conciliados deste título: vínculos (1:1 e agrupado) + 1:1 sem vínculo (defensivo)
  CREATE TEMP TABLE IF NOT EXISTS _conc_desejado (mov uuid, valor numeric, data date) ON COMMIT DROP;
  DELETE FROM _conc_desejado WHERE true;   -- pg-safeupdate (PostgREST) recusa DELETE sem WHERE
  INSERT INTO _conc_desejado (mov, valor, data)
  SELECT v.movimento_id, round(v.valor_vinculado, 2), m.data_transacao
    FROM public.conciliacao_vinculo v JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
   WHERE v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = p_receber_id AND m.status = 'conciliado'
  UNION ALL
  SELECT m.id, round(abs(m.valor), 2), m.data_transacao
    FROM public.conciliacao_movimento m
   WHERE m.lancamento_tabela = 'erp_receber' AND m.lancamento_id = p_receber_id AND m.status = 'conciliado'
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v
                      WHERE v.movimento_id = m.id AND v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = p_receber_id);

  SELECT COALESCE(sum(valor), 0), count(*) INTO v_soma, v_n FROM _conc_desejado;
  IF v_n >= 2 AND v_soma > v_liq + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liq,'FM999999990.00') USING ERRCODE = '23514';
  END IF;

  -- a) baixas ligadas a créditos que NÃO estão mais conciliados neste título
  FOR x IN
    SELECT b.id, b.origem FROM public.erp_receber_baixa b
     WHERE b.receber_id = p_receber_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM _conc_desejado dd WHERE dd.mov = b.movimento_banco_id)
  LOOP
    IF x.origem = 'conciliacao' THEN
      UPDATE public.erp_receber_baixa SET deleted_at = now(), deleted_by = auth.uid() WHERE id = x.id;
    ELSE
      UPDATE public.erp_receber_baixa SET movimento_banco_id = NULL WHERE id = x.id;   -- manual: só solta o vínculo
    END IF;
  END LOOP;

  -- b) cada crédito conciliado tem a sua baixa (reaproveitando a manual quando for o mesmo dinheiro)
  FOR d IN SELECT * FROM _conc_desejado ORDER BY data, mov LOOP
    SELECT id INTO v_b FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id = d.mov
     ORDER BY criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_receber_baixa SET valor = d.valor WHERE id = v_b AND round(valor, 2) <> d.valor;
      CONTINUE;
    END IF;

    SELECT id INTO v_b FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND abs(valor - d.valor) < 0.01
     ORDER BY data, criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_receber_baixa SET movimento_banco_id = d.mov WHERE id = v_b;   -- confirma o recebimento já registrado
      CONTINUE;
    END IF;

    SELECT COALESCE(sum(valor), 0) INTO v_ativas FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL;
    IF v_ativas + d.valor > v_liq + 0.01 THEN
      -- criar baixa sobrepagaria: o dinheiro já está registrado em baixas sem vínculo → liga-as (sem criar valor)
      v_falta := d.valor;
      FOR x IN SELECT id, valor FROM public.erp_receber_baixa
                WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND valor > 0
                ORDER BY data, criado_em LOOP
        EXIT WHEN v_falta <= 0.01;
        UPDATE public.erp_receber_baixa SET movimento_banco_id = d.mov WHERE id = x.id;
        v_falta := v_falta - x.valor;
      END LOOP;
      CONTINUE;
    END IF;

    INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por)
    VALUES (p_receber_id, r.company_id, d.valor, d.data, 'conciliacao_bancaria', 'conciliacao', d.mov, auth.uid());
  END LOOP;

  -- c) data/forma de pagamento acompanham as baixas (mesma semântica de antes: sem baixa → sem data)
  UPDATE public.erp_receber t
     SET data_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_receber_baixa b WHERE b.receber_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END,
         forma_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                                THEN COALESCE(NULLIF(t.forma_pagamento, ''),
                                              CASE WHEN v_n > 0 THEN 'conciliacao_bancaria' END)
                                ELSE t.forma_pagamento END,
         updated_at = now()
   WHERE t.id = p_receber_id
     AND ( t.data_pagamento IS DISTINCT FROM CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_receber_baixa b WHERE b.receber_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END
        OR (COALESCE(t.valor_pago, 0) > 0 AND NULLIF(t.forma_pagamento, '') IS NULL AND v_n > 0) );
END $function$;

REVOKE ALL ON FUNCTION public.fn_receber_conciliacao_sync(uuid) FROM PUBLIC, anon, authenticated;
