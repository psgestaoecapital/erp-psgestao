-- ===== ONDA 3.1: DE-PARA PRODUTO x FORNECEDOR + CLASSIFICACAO CFOP =====

-- 1) Regras CFOP (parametrizavel; company_id NULL = default global)
CREATE TABLE IF NOT EXISTS erp_estoque_cfop_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  cfop text NOT NULL,
  entra_estoque boolean NOT NULL,
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfop_regra_company
  ON erp_estoque_cfop_regra (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), cfop)
  WHERE ativo;

INSERT INTO erp_estoque_cfop_regra (company_id, cfop, entra_estoque, observacao)
SELECT NULL, x.cfop, x.entra, x.obs FROM (VALUES
  ('1102', true,  'Compra p/ comercializacao (interno)'),
  ('2102', true,  'Compra p/ comercializacao (interestadual)'),
  ('1101', true,  'Compra p/ industrializacao (interno)'),
  ('2101', true,  'Compra p/ industrializacao (interestadual)'),
  ('1556', false, 'Material uso/consumo (interno)'),
  ('2556', false, 'Material uso/consumo (interestadual)'),
  ('1551', false, 'Ativo imobilizado (interno)'),
  ('2551', false, 'Ativo imobilizado (interestadual)')
) AS x(cfop, entra, obs)
WHERE NOT EXISTS (SELECT 1 FROM erp_estoque_cfop_regra r WHERE r.company_id IS NULL AND r.cfop = x.cfop);

ALTER TABLE erp_estoque_cfop_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_cfop_regra_sel ON erp_estoque_cfop_regra;
CREATE POLICY p_cfop_regra_sel ON erp_estoque_cfop_regra FOR SELECT
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS p_cfop_regra_all ON erp_estoque_cfop_regra;
CREATE POLICY p_cfop_regra_all ON erp_estoque_cfop_regra FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2) De-para produto x codigo do fornecedor
CREATE TABLE IF NOT EXISTS erp_produto_depara_fornecedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fornecedor_cnpj text NOT NULL,
  codigo_fornecedor text NOT NULL,
  produto_id uuid NOT NULL REFERENCES erp_produtos(id) ON DELETE CASCADE,
  ncm text,
  descricao_fornecedor text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  CONSTRAINT uq_depara UNIQUE (company_id, fornecedor_cnpj, codigo_fornecedor)
);
CREATE INDEX IF NOT EXISTS ix_depara_produto ON erp_produto_depara_fornecedor (produto_id);

ALTER TABLE erp_produto_depara_fornecedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_depara_all ON erp_produto_depara_fornecedor;
CREATE POLICY p_depara_all ON erp_produto_depara_fornecedor FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3) Vinculo nos itens da NF-e recebida
ALTER TABLE erp_nfe_recebidas_itens
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES erp_produtos(id),
  ADD COLUMN IF NOT EXISTS entra_estoque boolean,
  ADD COLUMN IF NOT EXISTS estoque_movimentado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS movimentacao_id uuid,
  ADD COLUMN IF NOT EXISTS vinculo_origem text;

-- 4) Controle de estoque na nota
ALTER TABLE erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS estoque_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS estoque_dado_em timestamptz;

-- 5) Helper: CFOP entra no estoque? (regra da empresa sobrepoe a global; NULL = nao classificado)
CREATE OR REPLACE FUNCTION fn_estoque_cfop_entra(p_company_id uuid, p_cfop text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT entra_estoque FROM erp_estoque_cfop_regra
   WHERE ativo AND cfop = p_cfop AND (company_id = p_company_id OR company_id IS NULL)
   ORDER BY (company_id IS NOT NULL) DESC LIMIT 1;
$$;

-- 6) Helper: local principal (cria se nao existir)
CREATE OR REPLACE FUNCTION fn_estoque_local_principal(p_company_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM erp_estoque_locais
   WHERE company_id=p_company_id AND ativo AND COALESCE(principal,false) ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM erp_estoque_locais WHERE company_id=p_company_id AND ativo ORDER BY created_at LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (p_company_id, 'Estoque Principal', true, true) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- 7) Sugerir de-para dos itens de uma nota
CREATE OR REPLACE FUNCTION fn_nfe_item_depara_sugerir(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_cnpj text; r record; v_out jsonb := '[]'::jsonb;
  v_pid uuid; v_origem text; v_entra boolean; v_pnome text;
BEGIN
  SELECT company_id, regexp_replace(COALESCE(emitente_cnpj,''),'\D','','g')
    INTO v_company, v_cnpj FROM erp_nfe_recebidas WHERE id=p_nfe_recebida_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;

  FOR r IN SELECT * FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=p_nfe_recebida_id ORDER BY numero_item LOOP
    v_pid := r.produto_id; v_origem := r.vinculo_origem; v_pnome := NULL;
    IF v_pid IS NULL THEN
      SELECT produto_id INTO v_pid FROM erp_produto_depara_fornecedor
       WHERE company_id=v_company AND fornecedor_cnpj=v_cnpj AND codigo_fornecedor=r.codigo_produto LIMIT 1;
      IF v_pid IS NOT NULL THEN v_origem := 'depara'; END IF;
    END IF;
    IF v_pid IS NULL AND r.ncm IS NOT NULL THEN
      SELECT id INTO v_pid FROM erp_produtos
       WHERE company_id=v_company AND ativo AND ncm=r.ncm
         AND (r.descricao IS NULL OR nome ILIKE '%'||split_part(r.descricao,' ',1)||'%')
       ORDER BY updated_at DESC LIMIT 1;
      IF v_pid IS NOT NULL THEN v_origem := 'sugerido'; END IF;
    END IF;
    IF v_pid IS NOT NULL THEN SELECT nome INTO v_pnome FROM erp_produtos WHERE id=v_pid; END IF;
    v_entra := fn_estoque_cfop_entra(v_company, r.cfop);
    v_out := v_out || jsonb_build_object(
      'item_id', r.id, 'numero_item', r.numero_item, 'codigo_produto', r.codigo_produto,
      'descricao', r.descricao, 'ncm', r.ncm, 'cfop', r.cfop,
      'quantidade', r.quantidade, 'valor_unitario', r.valor_unitario,
      'produto_id', v_pid, 'produto_nome', v_pnome, 'vinculo_origem', v_origem, 'entra_estoque', v_entra
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'itens', v_out);
END $$;

-- 8) Vincular item a produto (e opcionalmente fixar de-para p/ futuras notas)
CREATE OR REPLACE FUNCTION fn_nfe_item_vincular(p_item_id uuid, p_produto_id uuid, p_fixar_depara boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_cnpj text; v_company uuid; v_entra boolean;
BEGIN
  SELECT i.*, n.company_id AS n_company, regexp_replace(COALESCE(n.emitente_cnpj,''),'\D','','g') AS cnpj
    INTO r FROM erp_nfe_recebidas_itens i JOIN erp_nfe_recebidas n ON n.id=i.nfe_recebida_id
   WHERE i.id=p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','item nao encontrado'); END IF;
  IF NOT (r.n_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;
  v_company := r.n_company; v_cnpj := r.cnpj;
  v_entra := fn_estoque_cfop_entra(v_company, r.cfop);

  UPDATE erp_nfe_recebidas_itens
     SET produto_id=p_produto_id, entra_estoque=v_entra, vinculo_origem='manual' WHERE id=p_item_id;

  IF p_fixar_depara AND v_cnpj <> '' THEN
    INSERT INTO erp_produto_depara_fornecedor
      (company_id, fornecedor_cnpj, codigo_fornecedor, produto_id, ncm, descricao_fornecedor, criado_por)
    VALUES (v_company, v_cnpj, r.codigo_produto, p_produto_id, r.ncm, r.descricao, auth.uid())
    ON CONFLICT (company_id, fornecedor_cnpj, codigo_fornecedor)
    DO UPDATE SET produto_id=EXCLUDED.produto_id, ncm=EXCLUDED.ncm, descricao_fornecedor=EXCLUDED.descricao_fornecedor;
  END IF;

  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'produto_id',p_produto_id,'entra_estoque',v_entra,'depara_fixado',p_fixar_depara);
END $$;

GRANT EXECUTE ON FUNCTION fn_estoque_cfop_entra(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_estoque_local_principal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_nfe_item_depara_sugerir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_nfe_item_vincular(uuid,uuid,boolean) TO authenticated;
