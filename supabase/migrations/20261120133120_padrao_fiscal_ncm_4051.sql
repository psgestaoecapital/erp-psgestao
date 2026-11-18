-- Chamado #4051 (Gean Auto · Cadastros › Produtos; vale para todas as empresas) — "Padrão fiscal por NCM".
--
-- Pedido do cliente (proposta da PS aprovada no chamado em 26/10): cadastrar UMA vez "todo item com NCM X
-- entra com CST/CSOSN do ICMS, CST do PIS e da COFINS e CFOP de venda Y", e o sistema aplicar isso sozinho
-- quando o produto é criado a partir da nota de entrada. O NCM pode ser completo (8 dígitos) ou só o início
-- (ex.: 8708 = todas as autopeças do capítulo); vale sempre o MAIS ESPECÍFICO. Produtos que já existem NÃO
-- mudam sozinhos — para eles continua a "Edição fiscal em massa".
--
-- Esta é a FATIA 1 (backend): tabela + funções. A tela (Cadastros › Produtos, perto da Edição fiscal em massa)
-- e o preenchimento na entrada da NF são fatias seguintes.
--
-- ADITIVA e segura: tabela NOVA, company-scoped (RLS por empresa, REVOKE anon), funções NOVAS só-leitura/CRUD.
-- Nenhuma função, view ou dado de cliente existente é alterado. Os campos fiscais são EXATAMENTE os mesmos da
-- "Edição fiscal em massa" (src/lib/produtos/fiscalMassa.ts): tipo_item_sped, cst_icms (CSOSN no Simples),
-- cst_pis, cst_cofins, cfop_venda e cfop_venda_interestadual. RD-26 (reuso), RD-38 (lógica provada no dado).

-- 1) Catálogo de padrão fiscal por NCM, por empresa ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_padrao_fiscal_ncm (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ncm                       text NOT NULL,
  tipo_item_sped            varchar,
  cst_icms                  varchar,   -- CST do ICMS (regime normal) ou CSOSN (Simples), igual ao cadastro do produto
  cst_pis                   varchar,
  cst_cofins                varchar,
  cfop_venda                varchar,   -- CFOP de venda dentro do estado (5xxx)
  cfop_venda_interestadual  text,      -- CFOP de venda fora do estado (6xxx)
  observacao                text,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  criado_por                uuid,
  -- NCM: só dígitos, do capítulo (2) ao item completo (8). "Mais específico vence" no resolver.
  CONSTRAINT erp_padrao_fiscal_ncm_digitos_chk CHECK (ncm ~ '^[0-9]{2,8}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_padrao_fiscal_ncm_empresa_ncm
  ON public.erp_padrao_fiscal_ncm (company_id, ncm);
COMMENT ON TABLE public.erp_padrao_fiscal_ncm IS
  'Chamado #4051: padrão fiscal por NCM, por empresa. Ao criar produto pela entrada da NF, o sistema '
  'preenche os campos fiscais a partir do padrão mais específico cujo NCM é prefixo do NCM do produto. '
  'Produtos já existentes não mudam sozinhos.';

-- RLS: catálogo por empresa (multi-tenant do módulo). Sem linha global; sem acesso anônimo.
ALTER TABLE public.erp_padrao_fiscal_ncm ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_padrao_fiscal_ncm_sel ON public.erp_padrao_fiscal_ncm FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY erp_padrao_fiscal_ncm_mod ON public.erp_padrao_fiscal_ncm FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON TABLE public.erp_padrao_fiscal_ncm FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.erp_padrao_fiscal_ncm TO authenticated;
GRANT ALL ON TABLE public.erp_padrao_fiscal_ncm TO service_role;

-- 2) Resolver — devolve o padrão MAIS ESPECÍFICO cujo NCM é prefixo do NCM do produto ---------------------
--    a) nunca inventa número: sem padrão -> ok:false (o fluxo de criação deixa os campos como estão).
--    b) guard de tenant no padrão do módulo.
CREATE OR REPLACE FUNCTION public.fn_padrao_fiscal_ncm_resolver(p_company_id uuid, p_ncm text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ncm text := regexp_replace(COALESCE(p_ncm, ''), '[^0-9]', '', 'g');
  r record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;
  IF v_ncm = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'produto_sem_ncm');
  END IF;
  -- mais específico vence: o NCM do padrão é prefixo do NCM do produto; maior prefixo primeiro
  SELECT * INTO r FROM erp_padrao_fiscal_ncm p
   WHERE p.company_id = p_company_id
     AND left(v_ncm, length(p.ncm)) = p.ncm
   ORDER BY length(p.ncm) DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_padrao_para_ncm', 'ncm', v_ncm);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'ncm', r.ncm,
    'tipo_item_sped', r.tipo_item_sped, 'cst_icms', r.cst_icms, 'cst_pis', r.cst_pis,
    'cst_cofins', r.cst_cofins, 'cfop_venda', r.cfop_venda,
    'cfop_venda_interestadual', r.cfop_venda_interestadual);
END $function$;

-- 3) Salvar (criar/editar) um padrão -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_padrao_fiscal_ncm_salvar(
  p_company_id uuid, p_ncm text,
  p_tipo_item_sped text DEFAULT NULL, p_cst_icms text DEFAULT NULL,
  p_cst_pis text DEFAULT NULL, p_cst_cofins text DEFAULT NULL,
  p_cfop_venda text DEFAULT NULL, p_cfop_venda_interestadual text DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ncm text := regexp_replace(COALESCE(p_ncm, ''), '[^0-9]', '', 'g');
  v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_ncm !~ '^[0-9]{2,8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ncm_invalido',
      'detalhe', 'Informe o NCM com 2 a 8 dígitos — o início (ex.: 8708) ou completo (ex.: 87081000).');
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE erp_padrao_fiscal_ncm SET ncm = v_ncm, tipo_item_sped = p_tipo_item_sped,
      cst_icms = p_cst_icms, cst_pis = p_cst_pis, cst_cofins = p_cst_cofins,
      cfop_venda = p_cfop_venda, cfop_venda_interestadual = p_cfop_venda_interestadual,
      observacao = p_observacao, atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  ELSE
    INSERT INTO erp_padrao_fiscal_ncm (company_id, ncm, tipo_item_sped, cst_icms, cst_pis,
      cst_cofins, cfop_venda, cfop_venda_interestadual, observacao, criado_por)
    VALUES (p_company_id, v_ncm, p_tipo_item_sped, p_cst_icms, p_cst_pis, p_cst_cofins,
      p_cfop_venda, p_cfop_venda_interestadual, p_observacao, auth.uid())
    ON CONFLICT (company_id, ncm) DO UPDATE SET tipo_item_sped = EXCLUDED.tipo_item_sped,
      cst_icms = EXCLUDED.cst_icms, cst_pis = EXCLUDED.cst_pis, cst_cofins = EXCLUDED.cst_cofins,
      cfop_venda = EXCLUDED.cfop_venda, cfop_venda_interestadual = EXCLUDED.cfop_venda_interestadual,
      observacao = EXCLUDED.observacao, atualizado_em = now()
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ncm', v_ncm);
END $function$;

-- 4) Remover um padrão -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_padrao_fiscal_ncm_remover(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  DELETE FROM erp_padrao_fiscal_ncm WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0, 'removidos', v_n);
END $function$;

-- 5) Listar os padrões da empresa (mais específico primeiro) -----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_padrao_fiscal_ncm_listar(p_company_id uuid)
 RETURNS SETOF public.erp_padrao_fiscal_ncm
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT * FROM erp_padrao_fiscal_ncm
   WHERE company_id = p_company_id
     AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
   ORDER BY length(ncm) DESC, ncm;
$function$;

-- ACL explícita (Regra 1 do check_fn_guards): REVOKE anon/PUBLIC em função SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.fn_padrao_fiscal_ncm_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_padrao_fiscal_ncm_resolver(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_padrao_fiscal_ncm_salvar(uuid, text, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_padrao_fiscal_ncm_salvar(uuid, text, text, text, text, text, text, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_padrao_fiscal_ncm_remover(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_padrao_fiscal_ncm_remover(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_padrao_fiscal_ncm_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_padrao_fiscal_ncm_listar(uuid) TO authenticated, service_role;
