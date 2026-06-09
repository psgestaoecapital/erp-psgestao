-- =============================================================
-- FEAT-OS-ONDA2-PARCELAS-v1 · Onda 2 da trilha OS
-- =============================================================
-- Parcelas editaveis do pedido com validacao server-side da soma
-- (Integridade Instrumental · Adendo 1 Regra #34).
--
-- - Tabela erp_pedidos_parcelas (1:N com erp_pedidos · CASCADE)
-- - RLS espelhando padrao company_id de erp_pedidos
-- - RPC fn_pedido_salvar_parcelas: substitui parcelas atomicamente +
--   atualiza erp_pedidos.parcelas / primeiro_vencimento
-- - Validacao: soma das parcelas deve bater com pedido.total (arredondado a 2 dp)
--
-- Migration aplicada via MCP em 2026-06-09.
-- =============================================================

CREATE TABLE IF NOT EXISTS erp_pedidos_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pedido_id uuid NOT NULL REFERENCES erp_pedidos(id) ON DELETE CASCADE,
  numero int NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  vencimento date NOT NULL,
  forma_pagamento text,
  gerar_boleto boolean NOT NULL DEFAULT false,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_parcelas_company_pedido
  ON erp_pedidos_parcelas (company_id, pedido_id);

ALTER TABLE erp_pedidos_parcelas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_pedidos_parcelas_all ON erp_pedidos_parcelas;
CREATE POLICY erp_pedidos_parcelas_all ON erp_pedidos_parcelas
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
               AND LOWER(COALESCE(u.role,'')) IN ('adm','acesso_total','adm_investimentos'))
  );

CREATE OR REPLACE FUNCTION fn_pedido_salvar_parcelas(p_pedido_id uuid, p_parcelas jsonb)
RETURNS SETOF erp_pedidos_parcelas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_company uuid; v_total numeric(14,2); v_soma numeric(14,2);
BEGIN
  SELECT company_id, total INTO v_company, v_total FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  SELECT COALESCE(SUM((x->>'valor')::numeric),0) INTO v_soma FROM jsonb_array_elements(p_parcelas) x;
  IF ROUND(v_soma,2) <> ROUND(v_total,2) THEN
    RAISE EXCEPTION 'Soma das parcelas (R$ %) difere do total do pedido (R$ %)', v_soma, v_total;
  END IF;
  DELETE FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;
  INSERT INTO erp_pedidos_parcelas (company_id,pedido_id,numero,valor,vencimento,forma_pagamento,gerar_boleto,observacoes)
  SELECT v_company, p_pedido_id, (x->>'numero')::int, (x->>'valor')::numeric, (x->>'vencimento')::date,
         x->>'forma_pagamento', COALESCE((x->>'gerar_boleto')::boolean,false), x->>'observacoes'
  FROM jsonb_array_elements(p_parcelas) x;
  UPDATE erp_pedidos SET
    parcelas = (SELECT COUNT(*) FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id),
    primeiro_vencimento = (SELECT MIN(vencimento) FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id),
    updated_at = now()
  WHERE id = p_pedido_id;
  RETURN QUERY SELECT * FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id ORDER BY numero;
END $$;

GRANT EXECUTE ON FUNCTION fn_pedido_salvar_parcelas(uuid, jsonb) TO authenticated;
