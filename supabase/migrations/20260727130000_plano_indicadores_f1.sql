-- =====================================================================
-- PLANO DE INDICADORES · F1  (módulo genérico, editável, estratificado)
-- =====================================================================
-- Diretriz do CEO (refinamentos A-D):
--  A) area_indicadores_mestres é a FONTE DE SEMEADURA (template global). A F1 LÊ dela para
--     semear ind_indicador_catalogo por-empresa; NÃO grava edições da empresa de volta nela.
--  B) regra_agregacao (`soma`|`media`|`media_ponderada`|`taxa_recalculada`) vive no catálogo;
--     cada indicador semeado NASCE com a sua. Guardamos a regra no PRÓPRIO template (mestres)
--     para a semeadura ser 100% genérica (a função copia a coluna — zero nome hardcoded).
--  C) Realizado lê DIRETO v_ind_producao_abate (não espera ind_kpis_diarios).
--  D) Setores sujos do ponto → normalização é dependência da F4 (não bloqueia F1).
--  P3) Nada travado: tudo editável/soft-delete; coluna `editavel` existe, ninguém nasce travado.
--  P4) DUAS permissões (ver / editar) via RBAC EXISTENTE. Ninguém vê por padrão.
-- RD-52 (uma fonte de verdade), RD-55 (aditivo), RD-30 (soft-delete), RD-51 (NULL honesto), RD-38 (prova).

-- ---------------------------------------------------------------------
-- 1) TEMPLATE GLOBAL — enriquece area_indicadores_mestres (aditivo)
--    Acrescenta a regra de agregação e a fonte de cálculo em cada indicador-mestre,
--    para a semeadura genérica só copiar colunas (sem CASE por sigla na função).
-- ---------------------------------------------------------------------
ALTER TABLE public.area_indicadores_mestres
  ADD COLUMN IF NOT EXISTS regra_agregacao text
    CHECK (regra_agregacao IS NULL OR regra_agregacao IN ('soma','media','media_ponderada','taxa_recalculada')),
  ADD COLUMN IF NOT EXISTS fonte_calculo text;   -- código neutro que a view de realizado reconhece (NULL = ainda sem fonte)

-- Classificação da regra de agregação (revisada indicador a indicador; é DADO de template, não lógica de runtime).
UPDATE public.area_indicadores_mestres SET regra_agregacao='soma'
  WHERE sigla IN ('V30','AES','ATR','HEC','INF') AND regra_agregacao IS NULL;
UPDATE public.area_indicadores_mestres SET regra_agregacao='media'
  WHERE sigla IN ('CBE','EPO','IMP','TMC','LGS','TME','HDC','HSC','TRI','VUCB') AND regra_agregacao IS NULL;
UPDATE public.area_indicadores_mestres SET regra_agregacao='media_ponderada'
  WHERE sigla IN ('RBH','RHT') AND regra_agregacao IS NULL;
UPDATE public.area_indicadores_mestres SET regra_agregacao='taxa_recalculada'
  WHERE sigla IN ('TAC','CNR','EED','TNR','ABS','TRN','MRA','OTDR') AND regra_agregacao IS NULL;

-- Indicadores de PRODUÇÃO (abate) como parte do template GLOBAL — genéricos para qualquer frigorífico
-- bovino, com fonte_calculo amarrando à camada neutra v_ind_producao_abate. (Não são nomes de empresa.)
INSERT INTO public.area_indicadores_mestres
  (id, area_id, tema, sigla, nome, o_que_mede, por_que_exclusivo, meta_numerica, meta_unidade, direcao_boa, regra_agregacao, fonte_calculo)
VALUES
  ('prod_cab', 'producao','producao','CAB','Cabeças Abatidas','Total de cabeças abatidas no período','Lido direto da camada neutra de abate (v_ind_producao_abate), sem depender de KPI diário', NULL,'cabeças','maior','soma','abate_cabecas'),
  ('prod_pmc', 'producao','producao','PMC','Peso Médio de Carcaça','Peso médio da carcaça por cabeça','Média ponderada por cabeça sobre o peso real de carcaça da origem', NULL,'kg','maior','media_ponderada','abate_peso_medio_kg'),
  ('prod_ptc', 'producao','producao','PTC','Peso Total de Carcaça','Quilos de carcaça produzidos no período','Soma do peso de carcaça direto da produção', NULL,'kg','maior','soma','abate_peso_total_kg'),
  ('prod_arb', 'producao','producao','ARB','Arrobas Produzidas','Arrobas de carcaça produzidas no período','Arrobas somadas da produção de abate', NULL,'@','maior','soma','abate_arrobas'),
  ('prod_ras', 'producao','producao','RAS','Rastreabilidade','Percentual de cabeças com identificação/SISBOV','Taxa recalculada de rastreio (cabeças com SISBOV / total), não média de médias', 100,'%','maior','taxa_recalculada','abate_rastreio_pct')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1b) HELPER de permissão — resolve as DUAS permissões pelo RBAC EXISTENTE.
--     ver=read / editar=update em module_id='industrial_indicadores'. Cobre os dois ramos do
--     v_user_permissions_resolved: system_role (company_id NULL = global, ex. PS_ADMIN) e
--     tenant_user_role (company_id da empresa). is_admin() como backstop de plataforma.
--     Isto é o que torna "concedido login a login" real: quem tem a permissão edita, master ou não.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ind_tem_permissao(p_company_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM public.v_user_permissions_resolved v
    WHERE v.user_id = auth.uid()
      AND v.module_id = 'industrial_indicadores'
      AND v.action = p_action
      AND v.is_allowed
      AND (v.company_id = p_company_id OR v.company_id IS NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_ind_tem_permissao(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_ind_tem_permissao(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) ind_indicador_catalogo — árvore de indicadores POR EMPRESA (tipo plano de contas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ind_indicador_catalogo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo          text NOT NULL,                       -- ex.: 'gente' (pai) / 'gente.ABS' (folha)
  pai_codigo      text,                                -- self-ref por codigo (NULL = raiz)
  nivel           integer NOT NULL DEFAULT 1,
  is_totalizador  boolean NOT NULL DEFAULT false,      -- nó que agrega filhos (não medido diretamente)
  nome            text NOT NULL,
  sigla           text,
  ambito          text,                                -- domínio (area_id do template): producao, gente, bpo...
  o_que_mede      text,
  unidade_medida  text,
  direcao_boa     text CHECK (direcao_boa IS NULL OR direcao_boa IN ('maior','menor','neutro')),
  fonte_calculo   text,                                -- liga ao realizado (NULL = ainda sem fonte, honesto)
  regra_agregacao text CHECK (regra_agregacao IS NULL OR regra_agregacao IN ('soma','media','media_ponderada','taxa_recalculada')),
  meta_padrao     numeric,                             -- meta sugerida pelo template (informativa)
  sugerido_global boolean NOT NULL DEFAULT false,      -- veio da semeadura (vs criado à mão pela empresa)
  mestre_id       text,                                -- proveniência: area_indicadores_mestres.id
  ordem           integer NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,       -- soft-delete (RD-30)
  editavel        boolean NOT NULL DEFAULT true,       -- P3: ninguém nasce travado
  criado_por      uuid DEFAULT auth.uid(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz,
  CONSTRAINT uq_ind_cat_company_codigo UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_ind_cat_company ON public.ind_indicador_catalogo(company_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_ind_cat_pai ON public.ind_indicador_catalogo(company_id, pai_codigo);

ALTER TABLE public.ind_indicador_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ind_cat_sel ON public.ind_indicador_catalogo;
CREATE POLICY p_ind_cat_sel ON public.ind_indicador_catalogo FOR SELECT
  USING (fn_ind_tem_permissao(company_id, 'read'));   -- ver: ninguém por padrão
DROP POLICY IF EXISTS p_ind_cat_wri ON public.ind_indicador_catalogo;
CREATE POLICY p_ind_cat_wri ON public.ind_indicador_catalogo FOR ALL
  USING (fn_ind_tem_permissao(company_id, 'update'))
  WITH CHECK (fn_ind_tem_permissao(company_id, 'update'));   -- editar: concedido login a login

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ind_indicador_catalogo TO authenticated;

-- ---------------------------------------------------------------------
-- 3) ind_indicador_meta — meta por indicador × recorte × período
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ind_indicador_meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  indicador_id  uuid NOT NULL REFERENCES public.ind_indicador_catalogo(id) ON DELETE CASCADE,
  recorte_tipo  text NOT NULL DEFAULT 'empresa',       -- empresa | planta | setor | ... (estratificação)
  recorte_ref   text,                                  -- id/código do recorte (NULL = empresa inteira)
  periodo_ano   integer NOT NULL,
  periodo_mes   integer CHECK (periodo_mes IS NULL OR periodo_mes BETWEEN 1 AND 12),  -- NULL = meta anual
  meta_valor    numeric NOT NULL,
  definido_por  uuid DEFAULT auth.uid(),
  definido_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz,
  ativo         boolean NOT NULL DEFAULT true
);
-- Uma meta por indicador/recorte/período (coalesce nos nuláveis → índice único de expressão).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_meta_chave ON public.ind_indicador_meta
  (company_id, indicador_id, recorte_tipo, COALESCE(recorte_ref,''), periodo_ano, COALESCE(periodo_mes,0))
  WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_ind_meta_indicador ON public.ind_indicador_meta(indicador_id);

ALTER TABLE public.ind_indicador_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ind_meta_sel ON public.ind_indicador_meta;
CREATE POLICY p_ind_meta_sel ON public.ind_indicador_meta FOR SELECT
  USING (fn_ind_tem_permissao(company_id, 'read'));
DROP POLICY IF EXISTS p_ind_meta_wri ON public.ind_indicador_meta;
CREATE POLICY p_ind_meta_wri ON public.ind_indicador_meta FOR ALL
  USING (fn_ind_tem_permissao(company_id, 'update'))
  WITH CHECK (fn_ind_tem_permissao(company_id, 'update'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ind_indicador_meta TO authenticated;

-- ---------------------------------------------------------------------
-- 4) v_ind_indicador_realizado — REALIZADO lendo DIRETO v_ind_producao_abate (decisão C)
--    Expõe o valor realizado por (empresa, ano, mês) chaveado por fonte_calculo, que casa
--    com ind_indicador_catalogo.fonte_calculo. F3 estende para gente/ponto; aqui só produção
--    (dado REAL e provável — RD-38). Não-produção fica sem linha aqui = realizado NULL honesto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ind_indicador_realizado
WITH (security_invoker = on) AS
WITH base AS (
  SELECT
    company_id,
    (date_part('year',  data_abate))::int  AS periodo_ano,
    (date_part('month', data_abate))::int  AS periodo_mes,
    count(*)::numeric                                   AS cabecas,
    sum(peso_carcaca_kg)                                AS peso_total,
    avg(peso_carcaca_kg)                                AS peso_medio,
    sum(arrobas)                                        AS arrobas,
    round(avg((tem_rastreio)::int::numeric) * 100, 1)   AS rastreio_pct
  FROM public.v_ind_producao_abate
  WHERE data_abate IS NOT NULL
  GROUP BY company_id, date_part('year', data_abate), date_part('month', data_abate)
)
SELECT company_id, periodo_ano, periodo_mes, 'abate_cabecas'::text      AS fonte_calculo, cabecas     AS valor_realizado FROM base
UNION ALL
SELECT company_id, periodo_ano, periodo_mes, 'abate_peso_medio_kg'::text, round(peso_medio,2)          FROM base
UNION ALL
SELECT company_id, periodo_ano, periodo_mes, 'abate_peso_total_kg'::text, round(peso_total,2)          FROM base
UNION ALL
SELECT company_id, periodo_ano, periodo_mes, 'abate_arrobas'::text,       round(arrobas,2)             FROM base
UNION ALL
SELECT company_id, periodo_ano, periodo_mes, 'abate_rastreio_pct'::text,  rastreio_pct                 FROM base;

GRANT SELECT ON public.v_ind_indicador_realizado TO authenticated;

-- ---------------------------------------------------------------------
-- 5) fn_ind_semear_catalogo — SEMEADURA GENÉRICA lendo area_indicadores_mestres
--    Zero nome de empresa; zero lista de indicador hardcoded (lê o template). Idempotente.
--    Cria o totalizador de cada área (nível 1) e as folhas (nível 2). Só o gestor master
--    da empresa (ou admin) semeia. Soft-friendly: ON CONFLICT DO NOTHING preserva edições.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ind_semear_catalogo(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridos integer := 0;
  v_tmp       integer;
BEGIN
  IF NOT fn_ind_tem_permissao(p_company_id, 'update') THEN
    RAISE EXCEPTION 'Sem permissão para semear indicadores desta empresa (requer indicadores_editar).';
  END IF;

  -- 5a) Totalizadores de área (nível 1). Rótulo do domínio (genérico, não é empresa).
  INSERT INTO public.ind_indicador_catalogo
    (company_id, codigo, pai_codigo, nivel, is_totalizador, nome, ambito, ordem, sugerido_global, editavel)
  SELECT DISTINCT p_company_id, m.area_id, NULL, 1, true,
         CASE m.area_id
           WHEN 'producao'   THEN 'Produção · Abate'
           WHEN 'gente'      THEN 'Gente & Jornada'
           WHEN 'bpo'        THEN 'BPO Financeiro'
           WHEN 'compliance' THEN 'Compliance & SST'
           WHEN 'pm'         THEN 'Gestão de Projetos'
           ELSE initcap(replace(m.area_id,'_',' '))
         END,
         m.area_id, 0, true, true
  FROM public.area_indicadores_mestres m
  ON CONFLICT (company_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;  v_inseridos := v_inseridos + v_tmp;

  -- 5b) Folhas (nível 2) — copia regra_agregacao/fonte_calculo/direcao do template.
  INSERT INTO public.ind_indicador_catalogo
    (company_id, codigo, pai_codigo, nivel, is_totalizador, nome, sigla, ambito, o_que_mede,
     unidade_medida, direcao_boa, fonte_calculo, regra_agregacao, meta_padrao, sugerido_global, mestre_id, ordem, editavel)
  SELECT p_company_id, m.area_id || '.' || m.sigla, m.area_id, 2, false,
         m.nome, m.sigla, m.area_id, m.o_que_mede,
         m.meta_unidade, m.direcao_boa, m.fonte_calculo, m.regra_agregacao, m.meta_numerica,
         true, m.id, row_number() OVER (PARTITION BY m.area_id ORDER BY m.sigla), true
  FROM public.area_indicadores_mestres m
  ON CONFLICT (company_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;  v_inseridos := v_inseridos + v_tmp;

  RETURN v_inseridos;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ind_semear_catalogo(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_ind_semear_catalogo(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6) RBAC — registra o módulo + as DUAS permissões (ver=read / editar=update).
--    Ninguém vê por padrão: CLIENT_* nascem is_allowed=FALSE. PS_ADMIN (admin de plataforma)
--    recebe TRUE por consistência com todos os módulos. O gestor master concede login a login
--    via a tela de Acessos existente (tenant_user_roles + role_permissions). Não inventa mecanismo.
-- ---------------------------------------------------------------------
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('industrial_indicadores', 'Plano de Indicadores', 'industrial', 'operacao', '3_specific',
        '🎯', '/dashboard/industrial/indicadores/editor', 151, true, false,
        'Plano de indicadores editável e estratificado (catálogo tipo plano de contas + metas). Ver/Editar controlados por permissão.')
ON CONFLICT (id) DO NOTHING;

-- Duas permissões: read (ver) e update (editar). Nasce negado para todos os papéis CLIENT_*.
INSERT INTO public.role_permissions (role, module_id, action, is_allowed)
SELECT r.role, 'industrial_indicadores', a.action,
       CASE WHEN r.role = 'PS_ADMIN' THEN true ELSE false END
FROM (VALUES ('CLIENT_OWNER'),('CLIENT_MANAGER'),('CLIENT_OPERATOR'),('CLIENT_VIEWER'),('PS_ADMIN'),('PS_SUPPORT')) AS r(role)
CROSS JOIN (VALUES ('read'),('update')) AS a(action)
ON CONFLICT DO NOTHING;
