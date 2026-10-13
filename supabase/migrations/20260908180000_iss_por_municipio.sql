-- ============================================================
-- #32 · ISS pelo municipio de execucao do servico
-- LC 116/2003 art. 3o: construcao civil (7.02, 7.04, 7.05, 7.17 e outros) tem ISS devido no
-- municipio da OBRA, nao no da sede. Aliquota deixa de ser campo fixo do servico e passa a ser
-- funcao de (municipio, item da LC 116, data). Regra que nao se quebra: sem aliquota conhecida,
-- NAO emite — nada de 2%, 5% ou a aliquota da sede. Chutar aliquota e erro fiscal com o CNPJ do
-- cliente. A fonte do numero viaja junto (RD-51): numero fiscal sem procedencia ninguem defende.
-- ============================================================

-- 3.1 aliquota por municipio x item da LC 116, com vigencia e fonte
CREATE TABLE IF NOT EXISTS public.fiscal_iss_municipio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo_ibge    text NOT NULL,
  codigo_lc116   text NOT NULL,
  aliquota       numeric NOT NULL,
  retido_na_fonte boolean,
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim   date,
  fonte          text NOT NULL,
  informado_por  text,
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  CONSTRAINT fiscal_iss_fonte_chk CHECK (fonte IN
    ('api_nacional','cadastro_empresa','acordo_coletivo','contador')),
  CONSTRAINT fiscal_iss_aliquota_chk CHECK (aliquota >= 0 AND aliquota <= 10)
);
CREATE INDEX IF NOT EXISTS ix_fiscal_iss_vigente
  ON public.fiscal_iss_municipio (codigo_ibge, codigo_lc116)
  WHERE vigencia_fim IS NULL;
COMMENT ON TABLE public.fiscal_iss_municipio IS
  'Aliquota de ISS por municipio x item da LC116, com vigencia. company_id NULL = valor '
  'global do produto (ex: vindo da API nacional); preenchido = cadastro da empresa, que '
  'tem precedencia sobre o global.';
COMMENT ON COLUMN public.fiscal_iss_municipio.fonte IS
  'De onde veio o numero. SEMPRE exibida na tela junto da aliquota (RD-51). '
  'Numero fiscal sem procedencia ninguem defende numa fiscalizacao.';

-- RLS: catalogo global (company_id IS NULL) e legivel por qualquer autenticado; linhas com
-- company_id seguem o multi-tenant do modulo (user_companies + papeis adm). Escrita so em linhas
-- da empresa (a UI nao mexe no catalogo global) ou por admin.
ALTER TABLE public.fiscal_iss_municipio ENABLE ROW LEVEL SECURITY;
CREATE POLICY fiscal_iss_sel ON public.fiscal_iss_municipio FOR SELECT
  USING (
    company_id IS NULL
    OR company_id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
                AND u.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  );
CREATE POLICY fiscal_iss_mod ON public.fiscal_iss_municipio FOR ALL
  USING (
    company_id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
                AND u.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  )
  WITH CHECK (
    company_id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
                AND u.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  );

-- 3.2 o local da prestacao na nota
ALTER TABLE public.erp_nfse_emitidas
  ADD COLUMN IF NOT EXISTS municipio_prestacao_ibge text,
  ADD COLUMN IF NOT EXISTS municipio_prestacao_nome text,
  ADD COLUMN IF NOT EXISTS municipio_prestacao_uf   text,
  ADD COLUMN IF NOT EXISTS iss_fonte_aliquota       text;
COMMENT ON COLUMN public.erp_nfse_emitidas.municipio_prestacao_ibge IS
  'Municipio onde o servico foi executado — define o ISS devido (LC 116/2003 art. 3o). '
  'Quando ha obra_id, vem da obra. NULL = mesmo municipio do prestador.';

-- 3.3 o servico declara SE o ISS e no local da prestacao
ALTER TABLE public.erp_servicos
  ADD COLUMN IF NOT EXISTS iss_no_local_prestacao boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_servicos.iss_no_local_prestacao IS
  'true = ISS devido no municipio da execucao (LC 116 art. 3o: construcao civil, limpeza, '
  'vigilancia e outros). false = devido no municipio do prestador. '
  'A aliquota_iss fixa do servico so vale quando false.';

-- 4 · RPC que resolve — devolve SEMPRE um dos tres estados, NUNCA um numero solto.
--   a) nunca devolve aliquota padrao (nao existe fallback numerico); nao sabe -> ok:false.
--   b) vigencia respeitada pela data do fato gerador (p_data), nao por now().
--   c) a fonte viaja junto (para gravar em erp_nfse_emitidas.iss_fonte_aliquota).
--   d) guard de tenant no padrao do modulo.
--   Precedencia: cadastro da empresa (company_id preenchido) VENCE o catalogo global (NULL).
CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_resolver(
  p_company_id uuid, p_codigo_ibge text, p_codigo_lc116 text, p_data date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lc   text := btrim(COALESCE(p_codigo_lc116, ''));
  v_ibge text := btrim(COALESCE(p_codigo_ibge, ''));
  v_data date := COALESCE(p_data, CURRENT_DATE);
  v_mun text; v_uf text; v_label text; r record;
BEGIN
  -- d) guard de tenant
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;

  -- servico sem LC116 nao tem como resolver
  IF v_lc = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'servico_sem_lc116',
      'acao', 'Cadastre o codigo da LC 116 no servico antes de emitir.');
  END IF;

  SELECT nome_municipio, uf INTO v_mun, v_uf
    FROM erp_gov_nfse_municipios WHERE codigo_ibge = v_ibge;
  v_label := COALESCE(NULLIF(v_mun, '') || '/' || v_uf, NULLIF(v_ibge, ''), '—');

  -- b) vigencia pela data do fato gerador · precedencia empresa > global
  SELECT * INTO r
    FROM fiscal_iss_municipio m
   WHERE m.codigo_ibge = v_ibge AND m.codigo_lc116 = v_lc
     AND m.vigencia_inicio <= v_data
     AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= v_data)
     AND (m.company_id = p_company_id OR m.company_id IS NULL)
   ORDER BY (m.company_id = p_company_id) DESC NULLS LAST, m.vigencia_inicio DESC
   LIMIT 1;

  -- a) sem cadastro conhecido -> ok:false (nunca um numero padrao)
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'aliquota_nao_cadastrada',
      'municipio', v_label, 'codigo_lc116', v_lc,
      'acao', 'Informe a aliquota deste municipio ou consulte o contador.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'aliquota', r.aliquota, 'fonte', r.fonte,
    'retido_na_fonte', r.retido_na_fonte, 'vigencia_inicio', r.vigencia_inicio,
    'municipio', v_label, 'codigo_lc116', v_lc, 'informado_por', r.informado_por);
END $function$;

-- 4-bis · cadastrar aliquota da empresa (o "informar aliquota" da tela §5.2/§5.3). Fecha a vigencia
--   aberta anterior do mesmo (empresa, municipio, LC116) antes de abrir a nova — nunca deixa duas
--   vigentes ao mesmo tempo, e preserva o historico (nota retroativa acha a aliquota da epoca).
CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_cadastrar(
  p_company_id uuid, p_codigo_ibge text, p_codigo_lc116 text, p_aliquota numeric,
  p_fonte text DEFAULT 'contador', p_retido_na_fonte boolean DEFAULT NULL,
  p_informado_por text DEFAULT NULL, p_vigencia_inicio date DEFAULT CURRENT_DATE,
  p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lc   text := btrim(COALESCE(p_codigo_lc116, ''));
  v_ibge text := btrim(COALESCE(p_codigo_ibge, ''));
  v_ini  date := COALESCE(p_vigencia_inicio, CURRENT_DATE);
  v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_ibge = '' OR v_lc = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'municipio e codigo da LC 116 sao obrigatorios');
  END IF;
  IF p_aliquota IS NULL OR p_aliquota < 0 OR p_aliquota > 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aliquota fora da faixa (0 a 10%)');
  END IF;
  IF p_fonte NOT IN ('api_nacional','cadastro_empresa','acordo_coletivo','contador') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fonte invalida');
  END IF;

  -- fecha a vigencia aberta anterior da EMPRESA (nao toca no catalogo global)
  UPDATE fiscal_iss_municipio
     SET vigencia_fim = v_ini - 1
   WHERE company_id = p_company_id AND codigo_ibge = v_ibge AND codigo_lc116 = v_lc
     AND vigencia_fim IS NULL AND vigencia_inicio < v_ini;

  INSERT INTO fiscal_iss_municipio (
    company_id, codigo_ibge, codigo_lc116, aliquota, retido_na_fonte,
    vigencia_inicio, fonte, informado_por, observacao, criado_por)
  VALUES (p_company_id, v_ibge, v_lc, round(p_aliquota, 4), p_retido_na_fonte,
    v_ini, p_fonte, p_informado_por, p_observacao, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id,
    'aliquota', round(p_aliquota, 4), 'fonte', p_fonte, 'vigencia_inicio', v_ini);
END $function$;
