-- =============================================================
-- FEAT-OS-ONDA1-ITENS-SERVICO-BOM-v1 · Onda 1 da trilha OS (4 PRs)
-- =============================================================
-- ESTENDE o OTC (orcamento/pedido) sem criar documento novo · base da OS.
-- Foundational: serve todas as empresas · RLS multi-tenant.
--
-- Mudancas:
-- 1) Itens polimorficos em erp_orcamentos_itens e erp_pedidos_itens:
--    + tipo_item ('produto' | 'servico') DEFAULT 'produto' (backward compat)
--    + servico_id / servico_codigo / servico_descricao
--    + CHECK chk_*_item_tipo
--    + CHECK chk_*_item_ref_compativel:
--        tipo='produto' -> produto_id NOT NULL OU (produto_id NULL + produto_nome NOT NULL [texto livre legacy])
--        tipo='servico' -> servico_id NOT NULL
--
-- 2) BOM: erp_servicos_produtos (produtos consumidos por servico)
--    - Indice (company_id, servico_id) + UNIQUE (servico_id, produto_id)
--    - RLS pattern de erp_servicos / erp_inventarios
--    - Trigger updated_at via update_timestamp_col()
--
-- 3) converter_orcamento_pedido atualizada: copia tipo_item + servico_*
--    pra manter o documento polimorfico apos conversao em pedido.
--
-- recalc_orcamento_total / recalc_pedido_total NAO precisam de mudanca:
-- somam erp_*_itens.subtotal independente do tipo_item.
--
-- Migration aplicada via MCP em 2026-06-08.
-- =============================================================

-- 1) Itens polimorficos · orcamentos_itens
ALTER TABLE public.erp_orcamentos_itens
  ADD COLUMN IF NOT EXISTS tipo_item text NOT NULL DEFAULT 'produto',
  ADD COLUMN IF NOT EXISTS servico_id uuid,
  ADD COLUMN IF NOT EXISTS servico_codigo text,
  ADD COLUMN IF NOT EXISTS servico_descricao text;

ALTER TABLE public.erp_orcamentos_itens DROP CONSTRAINT IF EXISTS chk_orc_item_tipo;
ALTER TABLE public.erp_orcamentos_itens
  ADD CONSTRAINT chk_orc_item_tipo CHECK (tipo_item IN ('produto','servico'));

ALTER TABLE public.erp_orcamentos_itens DROP CONSTRAINT IF EXISTS chk_orc_item_ref_compativel;
ALTER TABLE public.erp_orcamentos_itens
  ADD CONSTRAINT chk_orc_item_ref_compativel CHECK (
    (tipo_item = 'produto' AND produto_id IS NOT NULL)
 OR (tipo_item = 'servico' AND servico_id IS NOT NULL)
 OR (tipo_item = 'produto' AND produto_id IS NULL AND produto_nome IS NOT NULL)
  );

-- 2) Itens polimorficos · pedidos_itens
ALTER TABLE public.erp_pedidos_itens
  ADD COLUMN IF NOT EXISTS tipo_item text NOT NULL DEFAULT 'produto',
  ADD COLUMN IF NOT EXISTS servico_id uuid,
  ADD COLUMN IF NOT EXISTS servico_codigo text,
  ADD COLUMN IF NOT EXISTS servico_descricao text;

ALTER TABLE public.erp_pedidos_itens DROP CONSTRAINT IF EXISTS chk_ped_item_tipo;
ALTER TABLE public.erp_pedidos_itens
  ADD CONSTRAINT chk_ped_item_tipo CHECK (tipo_item IN ('produto','servico'));

ALTER TABLE public.erp_pedidos_itens DROP CONSTRAINT IF EXISTS chk_ped_item_ref_compativel;
ALTER TABLE public.erp_pedidos_itens
  ADD CONSTRAINT chk_ped_item_ref_compativel CHECK (
    (tipo_item = 'produto' AND produto_id IS NOT NULL)
 OR (tipo_item = 'servico' AND servico_id IS NOT NULL)
 OR (tipo_item = 'produto' AND produto_id IS NULL AND produto_nome IS NOT NULL)
  );

-- 3) BOM · erp_servicos_produtos
CREATE TABLE IF NOT EXISTS public.erp_servicos_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  servico_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  produto_codigo text,
  produto_nome text,
  quantidade_padrao numeric NOT NULL DEFAULT 1 CHECK (quantidade_padrao > 0),
  observacoes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_servicos_produtos_company_servico
  ON public.erp_servicos_produtos (company_id, servico_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_servicos_produtos_serv_prod
  ON public.erp_servicos_produtos (servico_id, produto_id);

DROP TRIGGER IF EXISTS trg_servicos_produtos_updated ON public.erp_servicos_produtos;
CREATE TRIGGER trg_servicos_produtos_updated BEFORE UPDATE ON public.erp_servicos_produtos
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp_col();

ALTER TABLE public.erp_servicos_produtos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_servicos_produtos_all ON public.erp_servicos_produtos;
CREATE POLICY erp_servicos_produtos_all ON public.erp_servicos_produtos
  FOR ALL
  USING (
    (company_id IN (SELECT user_companies.company_id FROM user_companies WHERE user_companies.user_id = auth.uid()))
    OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = ANY (ARRAY['adm'::text,'acesso_total'::text,'adm_investimentos'::text])))
  );

-- 4) converter_orcamento_pedido · copia tipo_item + servico_*
CREATE OR REPLACE FUNCTION public.converter_orcamento_pedido(p_orcamento_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_pedido_id UUID;
  v_orc RECORD;
  v_numero VARCHAR;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orcamento nao encontrado'; END IF;
  IF v_orc.status = 'convertido' THEN RAISE EXCEPTION 'Orcamento ja foi convertido'; END IF;

  v_numero := next_pedido_numero(v_orc.company_id);

  INSERT INTO erp_pedidos (
    company_id, numero, orcamento_origem_id,
    cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    data_pedido, data_prevista_entrega,
    status, vendedor_id, vendedor_nome, comissao_percentual,
    condicao_pagamento, forma_pagamento, prazo_entrega_dias,
    frete_tipo, frete_valor,
    subtotal, desconto_percentual, desconto_valor, acrescimo_valor, total,
    observacoes, created_by
  ) VALUES (
    v_orc.company_id, v_numero, v_orc.id,
    v_orc.cliente_id, v_orc.cliente_nome, v_orc.cliente_cnpj, v_orc.cliente_email, v_orc.cliente_telefone,
    CURRENT_DATE, CURRENT_DATE + COALESCE(v_orc.prazo_entrega_dias, 0),
    'aberto', v_orc.vendedor_id, v_orc.vendedor_nome, v_orc.comissao_percentual,
    v_orc.condicao_pagamento, v_orc.forma_pagamento, v_orc.prazo_entrega_dias,
    v_orc.frete_tipo, v_orc.frete_valor,
    v_orc.subtotal, v_orc.desconto_percentual, v_orc.desconto_valor, v_orc.acrescimo_valor, v_orc.total,
    v_orc.observacoes, p_user_id
  ) RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens WHERE orcamento_id = p_orcamento_id ORDER BY ordem;

  UPDATE erp_orcamentos SET
    status = 'convertido',
    pedido_id = v_pedido_id,
    convertido_em = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id)
  VALUES (p_orcamento_id, v_orc.company_id, 'convertido_pedido', 'Convertido em pedido ' || v_numero, p_user_id);

  RETURN v_pedido_id;
END; $function$;
