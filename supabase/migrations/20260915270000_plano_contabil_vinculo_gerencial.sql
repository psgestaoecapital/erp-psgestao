-- ============================================================
-- Plano de contas · dois níveis (GERENCIAL × CONTÁBIL) — desenho do CEO
-- ============================================================
-- O usuário classifica no GERENCIAL (erp_plano_contas, padrão comum a todas as empresas).
-- Quem precisa de contabilidade VINCULA o gerencial a uma conta CONTÁBIL (a do contador).
-- Quem não precisa, deixa em branco. O DRE segue lendo o gerencial (por grupo) — a conta
-- contábil NÃO toca o DRE; serve à exportação/conciliação do contador.
--
-- REGRAS (confirmadas pelo CEO):
--  1. N gerenciais → 1 contábil. NUNCA o contrário (1 gerencial nunca aponta p/ várias contábeis).
--  2. Vínculo OPCIONAL — sem vínculo é escolha, não erro.
--  3. VIGÊNCIA no vínculo (vinculo_desde/vinculo_ate). O relatório usa o vínculo VIGENTE NA
--     DATA DO LANÇAMENTO — sem isso, a reclassificação do contador (ex.: despesa→custo) reescreve
--     retroativamente o resultado dos meses anteriores.
--
-- OBS: já existia public.contabil_conta_depara (vazio, nunca usado). Ele guarda a contábil como
-- TEXTO plano (codigo_externo) e é chaveado pela contábil (permitia 1 gerencial → N contábil, o
-- "contrário" que a Regra 1 proíbe), além de não ter vigência. Por isso este modelo é dedicado e
-- estruturado; o legado fica intacto (não removo para não quebrar nada que dependa dele).

-- ------------------------------------------------------------
-- (②a) Plano CONTÁBIL — a árvore do contador (ex.: FC, 144 contas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_conta_contabil (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  escritorio_id uuid REFERENCES public.escritorios_contabeis(id),
  codigo        text NOT NULL,                 -- código estruturado do contador (ex 5.01.01.01.03.03.001)
  descricao     text NOT NULL,
  -- analítica recebe vínculo/lançamento · sintética é totalizadora (não vinculável)
  analitica     boolean NOT NULL DEFAULT true,
  pai_codigo    text,                          -- derivado pelo PREFIXO mais longo existente (não por contagem de pontos)
  nivel         int,
  codigo_antigo text,                          -- COLUNA 3: código do sistema anterior (312, 313, 322…) p/ o contador conciliar histórico
  observacoes   text,                          -- COLUNA 4: decisões documentadas do contador ("reclassificadas p/ custo", "tem que ser sintética"…)
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conta_contabil_codigo UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_conta_contabil_company ON public.erp_conta_contabil (company_id, ativo);
CREATE INDEX IF NOT EXISTS ix_conta_contabil_pai     ON public.erp_conta_contabil (company_id, pai_codigo);

-- ------------------------------------------------------------
-- (②b) VÍNCULO gerencial → contábil, com VIGÊNCIA (N gerenciais → 1 contábil)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_conta_contabil_vinculo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  plano_conta_id    uuid NOT NULL REFERENCES public.erp_plano_contas(id) ON DELETE CASCADE,     -- GERENCIAL
  conta_contabil_id uuid NOT NULL REFERENCES public.erp_conta_contabil(id) ON DELETE RESTRICT,  -- CONTÁBIL (deve ser analítica)
  vinculo_desde     date NOT NULL DEFAULT current_date,
  vinculo_ate       date,                       -- NULL = vínculo vigente (aberto)
  observacao        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT chk_vinculo_periodo CHECK (vinculo_ate IS NULL OR vinculo_ate >= vinculo_desde)
);
-- Regra 1 (N gerenciais → 1 contábil): no máximo 1 vínculo VIGENTE (aberto) por gerencial.
-- Muitas gerenciais PODEM apontar p/ a mesma contábil (o N→1); o que não pode é uma gerencial ter
-- dois vínculos abertos ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vinculo_gerencial_vigente
  ON public.erp_conta_contabil_vinculo (company_id, plano_conta_id)
  WHERE vinculo_ate IS NULL;
CREATE INDEX IF NOT EXISTS ix_vinculo_contabil ON public.erp_conta_contabil_vinculo (conta_contabil_id);
CREATE INDEX IF NOT EXISTS ix_vinculo_plano    ON public.erp_conta_contabil_vinculo (plano_conta_id, vinculo_desde, vinculo_ate);

-- ------------------------------------------------------------
-- RLS — leitura/escrita por empresa do usuário (as escritas “de verdade” passam pelas fns SECURITY DEFINER)
-- ------------------------------------------------------------
ALTER TABLE public.erp_conta_contabil          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_conta_contabil_vinculo  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_conta_contabil_rw ON public.erp_conta_contabil;
CREATE POLICY erp_conta_contabil_rw ON public.erp_conta_contabil
  FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS erp_conta_contabil_vinculo_rw ON public.erp_conta_contabil_vinculo;
CREATE POLICY erp_conta_contabil_vinculo_rw ON public.erp_conta_contabil_vinculo
  FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ============================================================
-- (③) IMPORTADOR do plano contábil (ex.: as 144 contas da FC)
-- ============================================================
-- Recebe as linhas do plano do contador e grava como CONTÁBIL, preservando TUDO:
--   codigo (estruturado), descricao, analitica×sintetica, codigo_antigo (col.3), observacoes (col.4).
-- Deriva pai_codigo pelo PREFIXO mais longo que EXISTE (trata salto de nível: 5.01.01.01 pode ter
-- filho direto 5.01.01.01.01.01). Não achata a estrutura de custo de obra.
-- p_rows: [{ codigo, descricao, analitica ('a'/'s'/true/false), codigo_antigo, observacoes }]
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_importar(
  p_company_id uuid, p_escritorio_id uuid, p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  r jsonb; v_cod text; v_desc text; v_anal boolean; v_ant text; v_obs text;
  v_import int := 0; v_anal_n int := 0; v_sint_n int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_escritorio_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM escritorios_contabeis WHERE id = p_escritorio_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'escritorio_inexistente'); END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_cod := NULLIF(regexp_replace(COALESCE(r->>'codigo',''), '\s', '', 'g'), '');
    CONTINUE WHEN v_cod IS NULL;                       -- linha sem código não entra
    v_desc := NULLIF(trim(r->>'descricao'), '');
    v_ant  := NULLIF(trim(r->>'codigo_antigo'), '');
    v_obs  := NULLIF(trim(r->>'observacoes'), '');
    -- analítica × sintética (aceita várias grafias). Default: analítica.
    v_anal := CASE
      WHEN lower(coalesce(r->>'analitica','')) IN ('false','f','s','sintetica','sintética','0','n','nao','não') THEN false
      WHEN lower(coalesce(r->>'analitica','')) IN ('true','t','a','analitica','analítica','1','sim') THEN true
      ELSE true END;

    INSERT INTO erp_conta_contabil (company_id, escritorio_id, codigo, descricao, analitica, codigo_antigo, observacoes, ativo)
    VALUES (p_company_id, p_escritorio_id, v_cod, COALESCE(v_desc, v_cod), v_anal, v_ant, v_obs, true)
    ON CONFLICT (company_id, codigo) DO UPDATE
      SET descricao     = COALESCE(EXCLUDED.descricao, erp_conta_contabil.descricao),
          analitica     = EXCLUDED.analitica,
          codigo_antigo = COALESCE(EXCLUDED.codigo_antigo, erp_conta_contabil.codigo_antigo),
          observacoes   = COALESCE(EXCLUDED.observacoes, erp_conta_contabil.observacoes),
          escritorio_id = COALESCE(EXCLUDED.escritorio_id, erp_conta_contabil.escritorio_id),
          ativo         = true,
          updated_at    = now();

    v_import := v_import + 1;
    IF v_anal THEN v_anal_n := v_anal_n + 1; ELSE v_sint_n := v_sint_n + 1; END IF;
  END LOOP;

  -- Recalcula pai_codigo (prefixo mais longo existente) e nivel para TODA a empresa.
  -- pai = a conta cujo código é o maior prefixo (com fronteira de ponto) do código atual.
  UPDATE erp_conta_contabil c SET
    pai_codigo = (
      SELECT p.codigo FROM erp_conta_contabil p
      WHERE p.company_id = c.company_id AND p.id <> c.id
        AND c.codigo LIKE p.codigo || '.%'
      ORDER BY length(p.codigo) DESC LIMIT 1
    ),
    nivel = (length(c.codigo) - length(replace(c.codigo, '.', '')) + 1),
    updated_at = now()
  WHERE c.company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'importadas', v_import, 'analiticas', v_anal_n, 'sinteticas', v_sint_n);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_importar(uuid, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- Listar plano contábil (árvore) + quantas gerenciais vinculadas (vigentes) a cada contábil
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.codigo) FROM (
        SELECT c.id, c.codigo, c.descricao, c.analitica, c.pai_codigo, c.nivel,
               c.codigo_antigo, c.observacoes, c.ativo,
               (SELECT count(*) FROM erp_conta_contabil_vinculo vv
                  WHERE vv.conta_contabil_id = c.id AND vv.vinculo_ate IS NULL) AS gerenciais_vinculadas
        FROM erp_conta_contabil c WHERE c.company_id = p_company_id
      ) t), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'total', count(*), 'analiticas', count(*) FILTER (WHERE analitica),
        'sinteticas', count(*) FILTER (WHERE NOT analitica)
      ) FROM erp_conta_contabil WHERE company_id = p_company_id)
  ) INTO v;
  RETURN v;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_listar(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Vincular gerencial → contábil (com vigência). Fecha o vínculo aberto anterior da MESMA gerencial.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vincular(
  p_company_id uuid, p_plano_conta_id uuid, p_conta_contabil_id uuid,
  p_desde date DEFAULT current_date, p_observacao text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_anal boolean; v_atual record; v_desde date := COALESCE(p_desde, current_date);
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- gerencial precisa ser desta empresa
  IF NOT EXISTS (SELECT 1 FROM erp_plano_contas WHERE id = p_plano_conta_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'gerencial_nao_encontrada'); END IF;
  -- contábil precisa ser desta empresa e ANALÍTICA (sintética é totalizadora, não vincula)
  SELECT analitica INTO v_anal FROM erp_conta_contabil
   WHERE id = p_conta_contabil_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_nao_encontrada'); END IF;
  IF NOT v_anal THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_sintetica_nao_vinculavel'); END IF;

  -- vínculo aberto atual desta gerencial
  SELECT * INTO v_atual FROM erp_conta_contabil_vinculo
   WHERE company_id = p_company_id AND plano_conta_id = p_plano_conta_id AND vinculo_ate IS NULL;

  IF FOUND THEN
    IF v_atual.conta_contabil_id = p_conta_contabil_id THEN
      RETURN jsonb_build_object('ok', true, 'inalterado', true, 'vinculo_id', v_atual.id);
    END IF;
    -- não permite fechar antes de começar
    IF v_desde <= v_atual.vinculo_desde THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'vigencia_anterior_ao_vinculo_atual',
        'vinculo_atual_desde', v_atual.vinculo_desde); END IF;
    UPDATE erp_conta_contabil_vinculo SET vinculo_ate = v_desde - 1 WHERE id = v_atual.id;
  END IF;

  INSERT INTO erp_conta_contabil_vinculo (company_id, plano_conta_id, conta_contabil_id, vinculo_desde, observacao, created_by)
  VALUES (p_company_id, p_plano_conta_id, p_conta_contabil_id, v_desde, NULLIF(trim(p_observacao),''), auth.uid());

  RETURN jsonb_build_object('ok', true, 'vinculo_desde', v_desde);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vincular(uuid, uuid, uuid, date, text) TO authenticated;

-- ------------------------------------------------------------
-- Encerrar (desvincular) — fecha a vigência do vínculo aberto de uma gerencial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_desvincular(
  p_company_id uuid, p_plano_conta_id uuid, p_ate date DEFAULT current_date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_atual record; v_ate date := COALESCE(p_ate, current_date);
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_atual FROM erp_conta_contabil_vinculo
   WHERE company_id = p_company_id AND plano_conta_id = p_plano_conta_id AND vinculo_ate IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'sem_vinculo', true); END IF;
  IF v_ate < v_atual.vinculo_desde THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ate_anterior_ao_desde'); END IF;
  UPDATE erp_conta_contabil_vinculo SET vinculo_ate = v_ate WHERE id = v_atual.id;
  RETURN jsonb_build_object('ok', true, 'encerrado_em', v_ate);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_desvincular(uuid, uuid, date) TO authenticated;

-- ------------------------------------------------------------
-- (Regra 3) Resolve a conta contábil VIGENTE de uma gerencial NA DATA DO LANÇAMENTO
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_vigente(
  p_plano_conta_id uuid, p_data date
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT conta_contabil_id FROM public.erp_conta_contabil_vinculo
  WHERE plano_conta_id = p_plano_conta_id
    AND p_data >= vinculo_desde
    AND (vinculo_ate IS NULL OR p_data <= vinculo_ate)
  ORDER BY vinculo_desde DESC LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_vigente(uuid, date) TO authenticated;

-- ------------------------------------------------------------
-- Listar vínculos vigentes de uma empresa (gerencial → contábil) — para a tela ④
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculos_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_build_object('ok', true,
    'vinculos', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.plano_codigo) FROM (
      SELECT v.id AS vinculo_id, v.plano_conta_id, g.codigo AS plano_codigo, g.descricao AS plano_descricao,
             v.conta_contabil_id, c.codigo AS contabil_codigo, c.descricao AS contabil_descricao,
             v.vinculo_desde, v.vinculo_ate, v.observacao
      FROM erp_conta_contabil_vinculo v
      JOIN erp_plano_contas g   ON g.id = v.plano_conta_id
      JOIN erp_conta_contabil c ON c.id = v.conta_contabil_id
      WHERE v.company_id = p_company_id AND v.vinculo_ate IS NULL
    ) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculos_listar(uuid) TO authenticated;
