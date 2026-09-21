-- Revenda · Perfil Fiscal (PF-b · banco) — convite do contador (link sem login)
--
-- O dono/PS gera um link com token para o contador preencher o perfil fiscal SEM login.
-- Segurança: só o HASH do token fica no banco (o token puro é devolvido uma única vez, no criar);
-- validade 15 dias; uso restrito à empresa do convite; single-use (fecha ao "Enviar para aprovação");
-- expõe o mínimo (nome + CNPJ da empresa); registra IP/acessos (LGPD: o contador é operador). As RPCs
-- de token NÃO usam get_user_company_ids (o token é a credencial) — a rota pública as chama via service_role.
-- RDs 42·51·55·65. Idempotente/aditivo.

CREATE TABLE IF NOT EXISTS veic_perfil_convite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  perfil_id uuid REFERENCES veic_perfil_fiscal(id) ON DELETE SET NULL,
  email_contador text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','usado','revogado')),
  criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz, ip_criacao text, ip_ultimo_acesso text, acessos int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_veic_perfil_convite_company ON veic_perfil_convite(company_id, status);
ALTER TABLE veic_perfil_convite ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_perfil_convite'::regclass AND polname='veic_perfil_convite_rw') THEN
    CREATE POLICY veic_perfil_convite_rw ON veic_perfil_convite FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_perfil_convite TO authenticated;
GRANT ALL ON public.veic_perfil_convite TO service_role;

-- Helper: acha ou cria a versão rascunho editável da empresa (mesma regra do salvar da tela).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_rascunho_id(p_company_id uuid, p_por text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM veic_perfil_fiscal WHERE company_id=p_company_id AND status IN ('rascunho','aguardando_aprovacao') ORDER BY versao DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO veic_perfil_fiscal (company_id, versao, status, preenchido_por)
    VALUES (p_company_id, COALESCE((SELECT max(versao) FROM veic_perfil_fiscal WHERE company_id=p_company_id),0)+1, 'rascunho', p_por)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $function$;

-- (1) Criar convite — dono/PS (guarda de empresa). Devolve o token PURO uma única vez.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_criar(p_company_id uuid, p_email text, p_user uuid DEFAULT NULL, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_token text; v_perfil uuid; v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_perfil := fn_veic_perfil_rascunho_id(p_company_id, 'contador');
  -- revoga convites ativos anteriores desta empresa (um link válido por vez)
  UPDATE veic_perfil_convite SET status='revogado' WHERE company_id=p_company_id AND status='ativo';
  INSERT INTO veic_perfil_convite (company_id, perfil_id, email_contador, token_hash, expira_em, criado_por, ip_criacao)
  VALUES (p_company_id, v_perfil, NULLIF(btrim(p_email),''), encode(digest(v_token,'sha256'),'hex'), now() + interval '15 days', p_user, p_ip)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'convite_id', v_id, 'token', v_token,
    'url_path', '/contador/' || v_token, 'expira_em', now() + interval '15 days');
END $function$;

-- (2) Validar token — SEM login (o token é a credencial). Expõe o mínimo. Registra o acesso.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_validar(p_token text, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record; comp record; v_edit record; v_ops jsonb;
BEGIN
  SELECT * INTO c FROM veic_perfil_convite WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'token_invalido'); END IF;
  IF c.status <> 'ativo' THEN RETURN jsonb_build_object('ok', false, 'erro', 'convite_'||c.status); END IF;
  IF c.expira_em <= now() THEN
    UPDATE veic_perfil_convite SET status='revogado' WHERE id=c.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'expirado'); END IF;
  UPDATE veic_perfil_convite SET acessos = acessos + 1, ip_ultimo_acesso = COALESCE(p_ip, ip_ultimo_acesso) WHERE id = c.id;

  SELECT COALESCE(nome_fantasia, razao_social) AS nome, cnpj INTO comp FROM companies WHERE id = c.company_id;
  SELECT * INTO v_edit FROM veic_perfil_fiscal WHERE id = c.perfil_id;
  SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,'cfop_fora_uf',cfop_fora_uf,'cst_ou_csosn',cst_ou_csosn,'emite_nota_entrada',emite_nota_entrada) ORDER BY operacao)
    INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = c.perfil_id;

  RETURN jsonb_build_object('ok', true, 'expira_em', c.expira_em,
    'empresa', jsonb_build_object('nome', comp.nome, 'cnpj', comp.cnpj),
    'perfil', CASE WHEN v_edit.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_edit.status, 'regime', v_edit.regime, 'anexo_faixa', v_edit.anexo_faixa,
      'usa_trib_diferenca_pis_cofins', v_edit.usa_trib_diferenca_pis_cofins, 'usa_trib_diferenca_irpj_csll', v_edit.usa_trib_diferenca_irpj_csll,
      'icms_saida_regra', v_edit.icms_saida_regra, 'icms_saida_pct', v_edit.icms_saida_pct, 'icms_saida_base_legal', v_edit.icms_saida_base_legal,
      'nfe_entrada_pf', v_edit.nfe_entrada_pf, 'veicprod_obrigatorio_usado', v_edit.veicprod_obrigatorio_usado, 'troca_valor_base', v_edit.troca_valor_base,
      'consignacao_documentos', v_edit.consignacao_documentos, 'garantia_provisao', v_edit.garantia_provisao, 'renave_aplica', v_edit.renave_aplica,
      'reforma_tratamento', v_edit.reforma_tratamento, 'comissao_base', v_edit.comissao_base, 'encargos_pct', v_edit.encargos_pct,
      'coaf_responsavel', v_edit.coaf_responsavel, 'coaf_limite_especie', v_edit.coaf_limite_especie, 'observacao', v_edit.observacao,
      'operacoes', COALESCE(v_ops,'[]'::jsonb)) END);
END $function$;

-- (3) Salvar (rascunho) via token — preenchido_por='contador'.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_salvar(p_token text, p_dados jsonb, p_operacoes jsonb DEFAULT NULL, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record; v_op jsonb;
BEGIN
  SELECT * INTO c FROM veic_perfil_convite WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  IF NOT FOUND OR c.status <> 'ativo' OR c.expira_em <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'token_invalido_ou_expirado'); END IF;
  UPDATE veic_perfil_convite SET acessos = acessos + 1, ip_ultimo_acesso = COALESCE(p_ip, ip_ultimo_acesso) WHERE id = c.id;

  UPDATE veic_perfil_fiscal SET
    status='rascunho', preenchido_por='contador',
    regime=p_dados->>'regime', anexo_faixa=p_dados->>'anexo_faixa',
    usa_trib_diferenca_pis_cofins=(p_dados->>'usa_trib_diferenca_pis_cofins')::boolean, usa_trib_diferenca_irpj_csll=(p_dados->>'usa_trib_diferenca_irpj_csll')::boolean,
    icms_saida_regra=p_dados->>'icms_saida_regra', icms_saida_pct=NULLIF(p_dados->>'icms_saida_pct','')::numeric, icms_saida_base_legal=p_dados->>'icms_saida_base_legal',
    nfe_entrada_pf=(p_dados->>'nfe_entrada_pf')::boolean, veicprod_obrigatorio_usado=(p_dados->>'veicprod_obrigatorio_usado')::boolean, troca_valor_base=p_dados->>'troca_valor_base',
    consignacao_documentos=p_dados->>'consignacao_documentos', garantia_provisao=(p_dados->>'garantia_provisao')::boolean, renave_aplica=(p_dados->>'renave_aplica')::boolean,
    reforma_tratamento=p_dados->>'reforma_tratamento', comissao_base=p_dados->>'comissao_base', encargos_pct=NULLIF(p_dados->>'encargos_pct','')::numeric,
    coaf_responsavel=p_dados->>'coaf_responsavel', coaf_limite_especie=NULLIF(p_dados->>'coaf_limite_especie','')::numeric,
    justificativas=COALESCE(p_dados->'justificativas', justificativas), observacao=p_dados->>'observacao', updated_at=now()
  WHERE id = c.perfil_id;

  IF p_operacoes IS NOT NULL AND jsonb_typeof(p_operacoes)='array' THEN
    DELETE FROM veic_perfil_fiscal_operacao WHERE perfil_id = c.perfil_id;
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operacoes) LOOP
      IF COALESCE(v_op->>'operacao','') <> '' THEN
        INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao)
        VALUES (c.perfil_id, c.company_id, v_op->>'operacao', v_op->>'cfop_dentro_uf', v_op->>'cfop_fora_uf', v_op->>'cst_ou_csosn', COALESCE((v_op->>'emite_nota_entrada')::boolean,false), v_op->>'observacao')
        ON CONFLICT (perfil_id, operacao) DO UPDATE SET cfop_dentro_uf=EXCLUDED.cfop_dentro_uf, cfop_fora_uf=EXCLUDED.cfop_fora_uf, cst_ou_csosn=EXCLUDED.cst_ou_csosn, emite_nota_entrada=EXCLUDED.emite_nota_entrada, observacao=EXCLUDED.observacao;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'perfil_id', c.perfil_id);
END $function$;

-- (4) Enviar para aprovação via token — perfil → aguardando; token vira 'usado' (single-use).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_enviar(p_token text, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM veic_perfil_convite WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  IF NOT FOUND OR c.status <> 'ativo' OR c.expira_em <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'token_invalido_ou_expirado'); END IF;
  UPDATE veic_perfil_fiscal SET status='aguardando_aprovacao', updated_at=now() WHERE id = c.perfil_id AND status='rascunho';
  UPDATE veic_perfil_convite SET status='usado', usado_em=now(), ip_ultimo_acesso=COALESCE(p_ip, ip_ultimo_acesso) WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'status', 'aguardando_aprovacao');
END $function$;

-- A rota pública /contador/[token] (sem login) chama estas 3 pelo client anon — o TOKEN é a credencial
-- (as funções são SECURITY DEFINER e validam o token internamente). criar NÃO é liberada ao anon.
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_validar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_salvar(text, jsonb, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_enviar(text, text) TO anon;
