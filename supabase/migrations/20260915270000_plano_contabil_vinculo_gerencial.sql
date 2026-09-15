-- ============================================================
-- Plano de contas · dois níveis (GERENCIAL × CONTÁBIL) — desenho do CEO
-- ============================================================
-- O usuário classifica no GERENCIAL (erp_plano_contas, padrão comum a todas as empresas).
-- Quem precisa de contabilidade VINCULA o gerencial a uma conta CONTÁBIL (a do contador).
-- Quem não precisa, deixa em branco. O DRE segue lendo o gerencial — a conta contábil NÃO
-- toca o DRE; serve à exportação/conciliação do contador.
--
-- REGRAS (confirmadas pelo CEO):
--  1. N gerenciais → 1 contábil. NUNCA o contrário (1 gerencial nunca aponta p/ várias contábeis).
--  2. Vínculo OPCIONAL — sem vínculo é escolha, não erro.
--  3. VÍNCULO IMUTÁVEL — doutrina da contabilidade (registro erp_contexto_projeto bda75838…):
--     "Não se deve modificar um vínculo. Deve ser criada uma nova conta gerencial e feita a
--      vinculação da nova conta." Vale para TODAS as contabilidades e empresas, inclusive futuras.
--     → Reclassificação NÃO altera o vínculo: cria-se conta gerencial NOVA, vincula-se à contábil
--       nova e INATIVA-se a antiga (ativo=false, nunca apaga). Os lançamentos antigos seguem na
--       conta antiga → o balanço dos meses anteriores fica intacto.
--     → Por isso NÃO há vigência (vinculo_desde/ate): sem mudança de vínculo, data seria coluna
--       morta e vira armadilha. A imutabilidade resolve o histórico melhor que a vigência.
--
-- OBS: já existia public.contabil_conta_depara (vazio, nunca usado, texto plano, cardinalidade
-- invertida). Fica intacto; este modelo é dedicado e estruturado.

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
  pai_codigo    text,                          -- prefixo mais longo existente
  nivel         int,
  codigo_antigo text,                          -- COLUNA 3: código do sistema anterior (312, 313…) p/ o contador conciliar histórico
  observacoes   text,                          -- COLUNA 4: decisões documentadas do contador
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conta_contabil_codigo UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_conta_contabil_company ON public.erp_conta_contabil (company_id, ativo);
CREATE INDEX IF NOT EXISTS ix_conta_contabil_pai     ON public.erp_conta_contabil (company_id, pai_codigo);

-- ------------------------------------------------------------
-- (②b) VÍNCULO gerencial → contábil, IMUTÁVEL (N gerenciais → 1 contábil)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_conta_contabil_vinculo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  plano_conta_id    uuid NOT NULL REFERENCES public.erp_plano_contas(id) ON DELETE CASCADE,     -- GERENCIAL
  conta_contabil_id uuid NOT NULL REFERENCES public.erp_conta_contabil(id) ON DELETE RESTRICT,  -- CONTÁBIL (deve ser analítica)
  ativo             boolean NOT NULL DEFAULT true,  -- reclassificação inativa (não altera) e cria conta nova
  observacao        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);
-- Regra 1 + imutabilidade: no máximo 1 vínculo ATIVO por gerencial. Muitas gerenciais PODEM
-- apontar p/ a mesma contábil (o N→1). Para "trocar", inativa-se este e cria-se conta gerencial nova.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vinculo_gerencial_ativo
  ON public.erp_conta_contabil_vinculo (company_id, plano_conta_id)
  WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_vinculo_contabil ON public.erp_conta_contabil_vinculo (conta_contabil_id);
CREATE INDEX IF NOT EXISTS ix_vinculo_plano    ON public.erp_conta_contabil_vinculo (plano_conta_id);

-- ------------------------------------------------------------
-- RLS — leitura/escrita por empresa (as escritas “de verdade” passam pelas fns SECURITY DEFINER)
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
-- Grava as linhas do plano do contador como CONTÁBIL, preservando TUDO:
--   codigo, descricao, analitica×sintetica, codigo_antigo (col.3), observacoes (col.4).
-- Deriva pai_codigo pelo PREFIXO mais longo que EXISTE (trata salto de nível). Não achata obra.
-- p_rows: [{ codigo, descricao, analitica, codigo_antigo, observacoes, pai_codigo?, nivel? }]
--   (pai_codigo/nivel são recalculados aqui de todo jeito; aceitos como dica.)
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
    CONTINUE WHEN v_cod IS NULL;
    v_desc := NULLIF(trim(r->>'descricao'), '');
    v_ant  := NULLIF(trim(r->>'codigo_antigo'), '');
    v_obs  := NULLIF(trim(r->>'observacoes'), '');
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

  -- pai_codigo (prefixo mais longo existente) + nivel, p/ toda a empresa
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
-- Listar plano contábil (árvore) + quantas gerenciais vinculadas (ativas) a cada contábil
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
                  WHERE vv.conta_contabil_id = c.id AND vv.ativo) AS gerenciais_vinculadas
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
-- Vincular gerencial → contábil (IMUTÁVEL). Primeiro vínculo apenas; troca é via conta nova.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vincular(
  p_company_id uuid, p_plano_conta_id uuid, p_conta_contabil_id uuid, p_observacao text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_anal boolean; v_ja uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_plano_contas WHERE id = p_plano_conta_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'gerencial_nao_encontrada'); END IF;
  SELECT analitica INTO v_anal FROM erp_conta_contabil
   WHERE id = p_conta_contabil_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_nao_encontrada'); END IF;
  IF NOT v_anal THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_sintetica_nao_vinculavel'); END IF;

  -- imutável: se já há vínculo ativo p/ esta gerencial, NÃO altera (a troca é criar conta nova)
  SELECT conta_contabil_id INTO v_ja FROM erp_conta_contabil_vinculo
   WHERE company_id = p_company_id AND plano_conta_id = p_plano_conta_id AND ativo;
  IF FOUND THEN
    IF v_ja = p_conta_contabil_id THEN
      RETURN jsonb_build_object('ok', true, 'inalterado', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_imutavel',
      'mensagem', 'O vínculo contábil não pode ser alterado. Crie uma nova conta gerencial e inative a anterior — assim os relatórios anteriores continuam corretos.');
  END IF;

  INSERT INTO erp_conta_contabil_vinculo (company_id, plano_conta_id, conta_contabil_id, observacao, created_by)
  VALUES (p_company_id, p_plano_conta_id, p_conta_contabil_id, NULLIF(trim(p_observacao),''), auth.uid());
  RETURN jsonb_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vincular(uuid, uuid, uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- Inativar o vínculo ativo de uma gerencial (usado ao inativar a conta antiga na reclassificação)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_inativar_vinculo(
  p_company_id uuid, p_plano_conta_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_conta_contabil_vinculo SET ativo = false
   WHERE company_id = p_company_id AND plano_conta_id = p_plano_conta_id AND ativo;
  RETURN jsonb_build_object('ok', true, 'inativados', COALESCE((SELECT count(*) FROM erp_conta_contabil_vinculo
    WHERE company_id = p_company_id AND plano_conta_id = p_plano_conta_id AND NOT ativo), 0));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_inativar_vinculo(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- Resolve a conta contábil ATIVA de uma gerencial (o vínculo nunca muda no tempo)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_ativo(p_plano_conta_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT conta_contabil_id FROM public.erp_conta_contabil_vinculo
  WHERE plano_conta_id = p_plano_conta_id AND ativo LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_ativo(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Listar vínculos ativos de uma empresa (gerencial → contábil) — para a tela
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
             v.conta_contabil_id, c.codigo AS contabil_codigo, c.descricao AS contabil_descricao, v.observacao
      FROM erp_conta_contabil_vinculo v
      JOIN erp_plano_contas g   ON g.id = v.plano_conta_id
      JOIN erp_conta_contabil c ON c.id = v.conta_contabil_id
      WHERE v.company_id = p_company_id AND v.ativo
    ) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculos_listar(uuid) TO authenticated;
