-- =============================================================
-- conciliacao-n-para-1-fatura-cartao-v1
-- =============================================================
-- 1 movimento bancario (pagamento de fatura) -> N contas a pagar.
-- Tabela conciliacao_vinculo + 4 RPCs (vincular, desvincular_item,
-- listar vinculos, fechar agrupado).
-- RLS: segue o padrao das demais conciliacao_* (permissive na tabela;
-- Pilar 2 fica nos RPCs por company_id).
--
-- Aplicada via MCP em 2026-06-16.
-- =============================================================

CREATE TABLE IF NOT EXISTS conciliacao_vinculo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimento_id      uuid NOT NULL REFERENCES conciliacao_movimento(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL,
  lancamento_tabela text NOT NULL CHECK (lancamento_tabela IN ('erp_pagar','erp_receber')),
  lancamento_id     uuid NOT NULL,
  valor_vinculado   numeric NOT NULL CHECK (valor_vinculado > 0),
  criado_em         timestamptz DEFAULT now(),
  criado_por        uuid,
  UNIQUE (movimento_id, lancamento_tabela, lancamento_id)
);
CREATE INDEX IF NOT EXISTS ix_conc_vinculo_mov ON conciliacao_vinculo (movimento_id);

ALTER TABLE conciliacao_vinculo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conc_vinculo_read   ON conciliacao_vinculo;
DROP POLICY IF EXISTS conc_vinculo_insert ON conciliacao_vinculo;
DROP POLICY IF EXISTS conc_vinculo_update ON conciliacao_vinculo;
DROP POLICY IF EXISTS conc_vinculo_delete ON conciliacao_vinculo;
DROP POLICY IF EXISTS conc_vinculo_srv    ON conciliacao_vinculo;

CREATE POLICY conc_vinculo_read   ON conciliacao_vinculo FOR SELECT TO authenticated USING (true);
CREATE POLICY conc_vinculo_insert ON conciliacao_vinculo FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY conc_vinculo_update ON conciliacao_vinculo FOR UPDATE TO authenticated USING (true);
CREATE POLICY conc_vinculo_delete ON conciliacao_vinculo FOR DELETE TO authenticated USING (true);
CREATE POLICY conc_vinculo_srv    ON conciliacao_vinculo FOR ALL TO service_role USING (true) WITH CHECK (true);


CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(
  p_movimento_id uuid,
  p_lancamento_tabela text,
  p_lancamento_id uuid,
  p_valor numeric DEFAULT NULL,
  p_operador_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_mov RECORD;
  v_comp uuid;
  v_valor numeric;
  v_soma numeric;
  v_qtd int;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado');
  END IF;
  v_comp := v_mov.company_id;

  IF p_lancamento_tabela NOT IN ('erp_pagar','erp_receber') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tabela invalida');
  END IF;

  IF p_valor IS NULL THEN
    IF p_lancamento_tabela = 'erp_pagar' THEN
      SELECT valor INTO v_valor FROM erp_pagar
       WHERE id = p_lancamento_id AND company_id = v_comp;
    ELSE
      SELECT valor INTO v_valor FROM erp_receber
       WHERE id = p_lancamento_id AND company_id = v_comp;
    END IF;
  ELSE
    v_valor := p_valor;
  END IF;

  IF v_valor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lancamento nao encontrado');
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor deve ser positivo');
  END IF;

  INSERT INTO conciliacao_vinculo (
    movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por
  ) VALUES (
    p_movimento_id, v_comp, p_lancamento_tabela, p_lancamento_id, v_valor, p_operador_id
  )
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO NOTHING;

  SELECT COALESCE(sum(valor_vinculado), 0), count(*)
    INTO v_soma, v_qtd
    FROM conciliacao_vinculo
   WHERE movimento_id = p_movimento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_mov.valor,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_mov.valor) - v_soma, 2),
    'qtd_vinculos', v_qtd,
    'fecha', (abs(abs(v_mov.valor) - v_soma) <= 0.05)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_vincular(uuid, text, uuid, numeric, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_item(
  p_vinculo_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_mov uuid;
  v_val numeric;
  v_soma numeric;
BEGIN
  SELECT movimento_id INTO v_mov FROM conciliacao_vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vinculo nao encontrado');
  END IF;
  DELETE FROM conciliacao_vinculo WHERE id = p_vinculo_id;

  SELECT valor INTO v_val FROM conciliacao_movimento WHERE id = v_mov;
  SELECT COALESCE(sum(valor_vinculado), 0) INTO v_soma
    FROM conciliacao_vinculo WHERE movimento_id = v_mov;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_val,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_val) - v_soma, 2),
    'fecha', (abs(abs(v_val) - v_soma) <= 0.05)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_item(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_conciliacao_vinculos(
  p_movimento_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_mov RECORD;
  v_itens jsonb;
  v_soma numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado');
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'vinculo_id', v.id,
      'tabela', v.lancamento_tabela,
      'lancamento_id', v.lancamento_id,
      'valor', v.valor_vinculado,
      'descricao', COALESCE(p.descricao, r.descricao),
      'vencimento', COALESCE(p.data_vencimento, r.data_vencimento)
    ) ORDER BY v.criado_em), '[]'::jsonb),
    COALESCE(sum(v.valor_vinculado), 0)
    INTO v_itens, v_soma
  FROM conciliacao_vinculo v
  LEFT JOIN erp_pagar   p ON v.lancamento_tabela = 'erp_pagar'   AND p.id = v.lancamento_id
  LEFT JOIN erp_receber r ON v.lancamento_tabela = 'erp_receber' AND r.id = v.lancamento_id
  WHERE v.movimento_id = p_movimento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_mov.valor,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_mov.valor) - v_soma, 2),
    'fecha', (abs(abs(v_mov.valor) - v_soma) <= 0.05),
    'itens', v_itens
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_vinculos(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(
  p_movimento_id uuid,
  p_operador_id uuid DEFAULT NULL,
  p_tolerancia numeric DEFAULT 0.05
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_mov RECORD;
  v_soma numeric;
  v_vin RECORD;
  v_qtd int := 0;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado');
  END IF;

  SELECT COALESCE(sum(valor_vinculado), 0) INTO v_soma
    FROM conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  IF v_soma = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada');
  END IF;

  IF abs(abs(v_mov.valor) - v_soma) > p_tolerancia THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor,
      'soma_vinculada', v_soma,
      'saldo', round(abs(v_mov.valor) - v_soma, 2)
    );
  END IF;

  FOR v_vin IN
    SELECT * FROM conciliacao_vinculo WHERE movimento_id = p_movimento_id
  LOOP
    IF v_vin.lancamento_tabela = 'erp_pagar' THEN
      UPDATE erp_pagar
         SET status = 'pago',
             valor_pago = v_vin.valor_vinculado,
             data_pagamento = v_mov.data_transacao,
             forma_pagamento = COALESCE(forma_pagamento, 'cartao_credito')
       WHERE id = v_vin.lancamento_id;
    ELSE
      UPDATE erp_receber
         SET status = 'pago',
             valor_pago = v_vin.valor_vinculado,
             data_pagamento = v_mov.data_transacao
       WHERE id = v_vin.lancamento_id;
    END IF;
    v_qtd := v_qtd + 1;
  END LOOP;

  UPDATE conciliacao_movimento
     SET status = 'conciliado',
         match_origem = 'agrupado',
         match_aplicado_em = now(),
         match_aplicado_por = p_operador_id
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'conciliado', true,
    'qtd_baixados', v_qtd,
    'valor', v_mov.valor
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric) TO authenticated;
