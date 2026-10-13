-- Revenda · Perfil Fiscal Configurável (PF-a · banco) — Tela 11
--
-- PILAR 1 (conformidade): NENHUMA regra fiscal fixa em código. Tudo por empresa, com base legal e
-- vigência, preenchido/aprovado por gente (contador/empresa/PS). A emissão de NF-e de veículo (quando o
-- veicProd entrar em produção — D2) lê CFOP/CST daqui (fonte única, RD-65) e é FAIL-CLOSED: sem perfil
-- aprovado vigente, recusa. RDs 38·42·51·55·65·70. Idempotente e aditivo. RLS por empresa; sem anon.
--
-- Nota (RD-38, provado no dado): não existia veic_custo_categoria (as categorias de veic_custo são texto
-- livre) — criada aqui para o "entra na base fiscal" ser configurável por categoria (pergunta 7). E não há
-- emissão de NF-e de veículo no código ainda (D2/veicProd) — por isso a trava é uma função-guarda pronta
-- para a emissão chamar; ela não finge travar algo que ainda não emite.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (1) veic_perfil_fiscal — as 14 respostas + status/versão/vigência. justificativas: base legal por campo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_perfil_fiscal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  versao int NOT NULL DEFAULT 1,
  vigente_desde date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aguardando_aprovacao','aprovado','substituido')),
  preenchido_por text CHECK (preenchido_por IN ('empresa','contador','ps')),
  aprovado_por uuid, aprovado_em timestamptz,
  -- P1 regime
  regime text CHECK (regime IN ('simples','presumido','real')),
  anexo_faixa text,
  -- P2 tributação pela diferença (por tributo)
  usa_trib_diferenca_pis_cofins boolean,
  usa_trib_diferenca_irpj_csll boolean,
  -- P3 ICMS na saída do usado
  icms_saida_regra text CHECK (icms_saida_regra IN ('normal','base_reduzida','isento','outra')),
  icms_saida_pct numeric,
  icms_saida_base_legal text,
  -- P4 NF-e de entrada na compra de PF
  nfe_entrada_pf boolean,
  dados_obrigatorios_entrada jsonb,
  -- P5 veicProd obrigatório para usado
  veicprod_obrigatorio_usado boolean,
  -- P6 base de valor da troca
  troca_valor_base text CHECK (troca_valor_base IN ('avaliado','dado')),
  -- P8 consignação
  consignacao_documentos text,
  consignacao_comissao_tributacao text,
  -- P9 garantia
  garantia_provisao boolean,
  garantia_conta_id uuid,
  -- P10 RENAVE
  renave_aplica boolean,
  -- P11 reforma tributária
  reforma_tratamento text,
  -- P12 comissão
  comissao_base text CHECK (comissao_base IN ('preco','lucro')),
  encargos_pct numeric,
  -- P13/14 COAF
  coaf_responsavel text,
  coaf_limite_especie numeric,
  -- base legal / observação por campo: { campo: { base_legal, observacao } }
  justificativas jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacao text,
  criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_veic_perfil_fiscal_company ON veic_perfil_fiscal(company_id, status, vigente_desde);
-- no máximo um aprovado por (empresa, vigente_desde) — versões futuras têm datas distintas
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_perfil_fiscal_aprovado ON veic_perfil_fiscal(company_id, vigente_desde) WHERE status='aprovado';

ALTER TABLE veic_perfil_fiscal ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_perfil_fiscal'::regclass AND polname='veic_perfil_fiscal_rw') THEN
    CREATE POLICY veic_perfil_fiscal_rw ON veic_perfil_fiscal FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_perfil_fiscal TO authenticated;
GRANT ALL ON public.veic_perfil_fiscal TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (2) veic_perfil_fiscal_operacao — CFOP/CST por operação (fonte única para a NF-e).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_perfil_fiscal_operacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id uuid NOT NULL REFERENCES veic_perfil_fiscal(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  operacao text NOT NULL CHECK (operacao IN ('compra_pf','compra_pj','venda','troca_entrada','consignacao_entrada','consignacao_venda','consignacao_retorno','devolucao_venda')),
  cfop_dentro_uf text, cfop_fora_uf text, cst_ou_csosn text,
  emite_nota_entrada boolean NOT NULL DEFAULT false,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_perfil_operacao ON veic_perfil_fiscal_operacao(perfil_id, operacao);
CREATE INDEX IF NOT EXISTS ix_veic_perfil_operacao_company ON veic_perfil_fiscal_operacao(company_id);

ALTER TABLE veic_perfil_fiscal_operacao ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_perfil_fiscal_operacao'::regclass AND polname='veic_perfil_operacao_rw') THEN
    CREATE POLICY veic_perfil_operacao_rw ON veic_perfil_fiscal_operacao FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_perfil_fiscal_operacao TO authenticated;
GRANT ALL ON public.veic_perfil_fiscal_operacao TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (3) veic_custo_categoria — "entra na base fiscal" configurável por categoria (pergunta 7).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_custo_categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  categoria text NOT NULL,
  entra_base_fiscal boolean NOT NULL DEFAULT true,
  base_legal text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_custo_categoria ON veic_custo_categoria(company_id, categoria);

ALTER TABLE veic_custo_categoria ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_custo_categoria'::regclass AND polname='veic_custo_categoria_rw') THEN
    CREATE POLICY veic_custo_categoria_rw ON veic_custo_categoria FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_custo_categoria TO authenticated;
GRANT ALL ON public.veic_custo_categoria TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (4) veic_perfil_fiscal_modelo — modelos por UF×regime, mantidos pela PS, SEMPRE 'sugestao_nao_validada'
--     até um contador validar. A PS não inventa regra: sem valor conhecido, deixa vazio no conteúdo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_perfil_fiscal_modelo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uf text NOT NULL,
  regime text NOT NULL CHECK (regime IN ('simples','presumido','real')),
  versao int NOT NULL DEFAULT 1,
  vigente_desde date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'sugestao_nao_validada' CHECK (status IN ('sugestao_nao_validada','validado_contador')),
  conteudo jsonb NOT NULL DEFAULT '{}'::jsonb,
  mantido_por text NOT NULL DEFAULT 'ps',
  aviso text NOT NULL DEFAULT 'Sugestão — confirme com seu contador. A PS não valida regra fiscal.',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_perfil_modelo ON veic_perfil_fiscal_modelo(uf, regime, versao);
ALTER TABLE veic_perfil_fiscal_modelo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- leitura para qualquer autenticado (é referência); escrita só admin/service_role.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_perfil_fiscal_modelo'::regclass AND polname='veic_perfil_modelo_read') THEN
    CREATE POLICY veic_perfil_modelo_read ON veic_perfil_fiscal_modelo FOR SELECT USING (auth.role() = 'authenticated' OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_perfil_fiscal_modelo'::regclass AND polname='veic_perfil_modelo_write') THEN
    CREATE POLICY veic_perfil_modelo_write ON veic_perfil_fiscal_modelo FOR ALL USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
GRANT SELECT ON public.veic_perfil_fiscal_modelo TO authenticated;
GRANT ALL ON public.veic_perfil_fiscal_modelo TO service_role;

-- Seed dos 3 modelos de SC — TODOS 'sugestao_nao_validada', conteúdo com os campos vazios (a PS não sabe/não inventa).
INSERT INTO veic_perfil_fiscal_modelo (uf, regime, conteudo) VALUES
  ('SC','simples', jsonb_build_object('regime','simples','anexo_faixa',null,'icms_saida_regra',null,'nota','Preencher com o contador — sugestão inicial vazia (a PS não valida regra fiscal).')),
  ('SC','presumido', jsonb_build_object('regime','presumido','icms_saida_regra',null,'usa_trib_diferenca_pis_cofins',null,'nota','Preencher com o contador.')),
  ('SC','real', jsonb_build_object('regime','real','icms_saida_regra',null,'usa_trib_diferenca_irpj_csll',null,'nota','Preencher com o contador.'))
ON CONFLICT (uf, regime, versao) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (5) fn_veic_perfil_fiscal_vigente(company) — o perfil aprovado vigente hoje, ou nao_configurado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_vigente(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status = 'aprovado' AND vigente_desde <= current_date
   ORDER BY vigente_desde DESC, versao DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'nao_configurado'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'aprovado',
    'perfil_id', v.id, 'versao', v.versao, 'vigente_desde', v.vigente_desde,
    'regime', v.regime, 'aprovado_em', v.aprovado_em);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (6) fn_veic_perfil_fiscal_exigir(company) — FAIL-CLOSED. A emissão de NF-e de veículo chama antes de
--     emitir; sem perfil aprovado vigente, recusa com mensagem clara. (Pronta para o veicProd — D2.)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_exigir(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  v := fn_veic_perfil_fiscal_vigente(p_company_id);
  IF (v->>'status') = 'aprovado' THEN
    RETURN jsonb_build_object('ok', true, 'perfil_id', v->>'perfil_id'); END IF;
  RETURN jsonb_build_object('ok', false, 'erro', 'perfil_fiscal_nao_aprovado',
    'mensagem', 'Perfil fiscal da revenda não aprovado — peça ao seu contador para preencher e aprove na tela Fiscal antes de emitir a nota do veículo.');
END $function$;

-- fn_veic_perfil_operacao(company, operacao) — CFOP/CST da operação, do perfil aprovado vigente (fonte única).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_operacao(p_company_id uuid, p_operacao text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_perfil uuid; o record; v jsonb;
BEGIN
  v := fn_veic_perfil_fiscal_vigente(p_company_id);
  IF (v->>'status') <> 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'perfil_fiscal_nao_aprovado'); END IF;
  v_perfil := (v->>'perfil_id')::uuid;
  SELECT * INTO o FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_perfil AND operacao = p_operacao;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'operacao_nao_configurada', 'operacao', p_operacao,
      'mensagem', 'Esta operação não tem CFOP/CST no perfil fiscal aprovado — complete o perfil com o contador.'); END IF;
  RETURN jsonb_build_object('ok', true, 'operacao', o.operacao,
    'cfop_dentro_uf', o.cfop_dentro_uf, 'cfop_fora_uf', o.cfop_fora_uf, 'cst_ou_csosn', o.cst_ou_csosn,
    'emite_nota_entrada', o.emite_nota_entrada);
END $function$;
