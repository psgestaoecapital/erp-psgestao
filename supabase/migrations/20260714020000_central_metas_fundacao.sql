-- ============================================================
-- CENTRAL DE METAS · FUNDAÇÃO (PASSO 1 · arquitetura 🅑+ aprovada CEO 13/07)
--
-- Distinção que fecha o caso (RD-47): o reuso certo é o CATÁLOGO, não o STORE.
--   • CATÁLOGO (metadado): REUSA area_indicadores_mestres (+ direcao_boa + tema).
--   • STORE (dado): erp_meta FINA e genérica (serve TODAS as verticais/temas).
--   • Wides (ind_targets/targets): INTACTAS — a RPC pode lê-las como fallback depois.
--   • Apresentação: RPC única fn_meta_comparar → 1 tela. Nunca 6 telas de meta.
--
-- 🚨 direcao_boa (maior|menor) é o campo mais crítico: sem ele o semáforo INVERTE
--    (pintaria de verde um absenteísmo alto). RD-25: a META é decisão do gestor —
--    o sistema NÃO inventa meta (só sugere via benchmark, Fase 2).
--
-- Design de fn_meta_comparar: recebe o REALIZADO (a fonte do domínio calcula — ex.:
-- ponto via fn_ponto_*; financeiro via GE) e centraliza o JULGAMENTO (meta, desvio,
-- status ciente de direcao_boa, tendência). Assim a Central não precisa saber sourcing
-- de cada indicador de cada vertical — cada domínio entrega o número, a Central julga.
-- ============================================================

-- 1) CATÁLOGO — estende (aditivo) + popula os indicadores de Gente ---------------
ALTER TABLE public.area_indicadores_mestres ADD COLUMN IF NOT EXISTS direcao_boa text;
ALTER TABLE public.area_indicadores_mestres ADD COLUMN IF NOT EXISTS tema text;
ALTER TABLE public.area_indicadores_mestres
  DROP CONSTRAINT IF EXISTS chk_direcao_boa;
ALTER TABLE public.area_indicadores_mestres
  ADD CONSTRAINT chk_direcao_boa CHECK (direcao_boa IS NULL OR direcao_boa IN ('maior','menor','neutro'));

INSERT INTO public.area_indicadores_mestres (id, area_id, tema, nome, sigla, o_que_mede, por_que_exclusivo, meta_unidade, meta_numerica, direcao_boa)
VALUES
  ('gente.absenteismo',      'gente','gente','Absenteísmo',            'ABS','Percentual de horas de ausência sobre a jornada prevista','Poucos SMB BR medem absenteísmo por setor com meta e benchmark de ramo','%',   3.5,'menor'),
  ('gente.atraso',           'gente','gente','Atrasos (ocorrências)',  'ATR','Dias-colaborador com atraso além da tolerância CLT','Derivado do shift do provedor sem cadastro manual de jornada','ocorrências', NULL,'menor'),
  ('gente.alem_escala',      'gente','gente','Horas além da escala',   'AES','Horas trabalhadas acima da escala do turno (operacional, não HE-CLT)','Distingue excedente operacional de HE-CLT (folha)','h', NULL,'menor'),
  ('gente.infracoes_jornada','gente','gente','Infrações de jornada',   'INF','Dias com jornada acima do limite legal','Sinal precoce de risco trabalhista por setor','ocorrências', 0,'menor'),
  ('gente.horas_extras_clt', 'gente','gente','HE-CLT',                 'HEC','Horas extras legais por faixa (fechamento do provedor)','Fechamento legal do provedor, rotulado com o período real','h', NULL,'menor'),
  ('gente.turnover',         'gente','gente','Turnover',               'TRN','Rotatividade de pessoal no período','Cruza admissão (ponto) com demissão (folha) pela matrícula','%', NULL,'menor'),
  ('gente.headcount',        'gente','gente','Headcount',              'HDC','Pessoas com registro no período','Base para produtividade homem-hora por setor/turno','pessoas', NULL,'neutro')
ON CONFLICT (id) DO UPDATE SET
  tema = EXCLUDED.tema, direcao_boa = EXCLUDED.direcao_boa,
  nome = EXCLUDED.nome, meta_unidade = EXCLUDED.meta_unidade, por_que_exclusivo = EXCLUDED.por_que_exclusivo;

-- 2) STORE — erp_meta (fina, genérica, multi-tenant) ---------------------------
CREATE TABLE IF NOT EXISTS public.erp_meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  indicador_id  text NOT NULL,                       -- ref area_indicadores_mestres.id
  escopo_tipo   text NOT NULL DEFAULT 'empresa',     -- empresa|setor|funcao|pessoa
  escopo_valor  text NOT NULL DEFAULT '',            -- '' = empresa toda
  periodo_tipo  text NOT NULL DEFAULT 'mes',         -- ano|trimestre|mes|semana|dia|vigente
  periodo_ref   text NOT NULL DEFAULT 'vigente',     -- ex '2026-07' | 'vigente'
  valor_meta    numeric NOT NULL,
  fonte         text NOT NULL DEFAULT 'ceo',         -- ceo|benchmark_ia|sugerida
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz,
  CONSTRAINT uq_erp_meta UNIQUE (company_id, indicador_id, escopo_tipo, escopo_valor, periodo_tipo, periodo_ref)
);
CREATE INDEX IF NOT EXISTS idx_erp_meta_company ON public.erp_meta (company_id, indicador_id) WHERE ativo;

ALTER TABLE public.erp_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_meta_rls_select ON public.erp_meta;
CREATE POLICY erp_meta_rls_select ON public.erp_meta FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS erp_meta_rls_all ON public.erp_meta;
CREATE POLICY erp_meta_rls_all ON public.erp_meta FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- 3) RPCs ----------------------------------------------------------------------
-- Define/atualiza uma meta (RD-25: gestor decide). Upsert por escopo+período.
CREATE OR REPLACE FUNCTION public.fn_meta_definir(
  p_company_id uuid, p_indicador_id text, p_valor_meta numeric,
  p_escopo_tipo text DEFAULT 'empresa', p_escopo_valor text DEFAULT '',
  p_periodo_tipo text DEFAULT 'mes', p_periodo_ref text DEFAULT 'vigente',
  p_fonte text DEFAULT 'ceo')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  INSERT INTO erp_meta (company_id, indicador_id, escopo_tipo, escopo_valor, periodo_tipo, periodo_ref, valor_meta, fonte, criado_por)
  VALUES (p_company_id, p_indicador_id, COALESCE(p_escopo_tipo,'empresa'), COALESCE(p_escopo_valor,''),
          COALESCE(p_periodo_tipo,'mes'), COALESCE(p_periodo_ref,'vigente'), p_valor_meta, COALESCE(p_fonte,'ceo'), auth.uid())
  ON CONFLICT (company_id, indicador_id, escopo_tipo, escopo_valor, periodo_tipo, periodo_ref)
  DO UPDATE SET valor_meta = EXCLUDED.valor_meta, fonte = EXCLUDED.fonte, ativo = true, atualizado_em = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

-- Lista o catálogo de um tema + a meta vigente da empresa (pra tela de cadastro).
CREATE OR REPLACE FUNCTION public.fn_meta_listar(p_company_id uuid, p_tema text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'indicador_id', c.id, 'nome', c.nome, 'sigla', c.sigla, 'unidade', c.meta_unidade,
    'direcao_boa', c.direcao_boa, 'tema', c.tema, 'o_que_mede', c.o_que_mede,
    'meta', m.valor_meta, 'meta_fonte', m.fonte, 'tem_meta', (m.valor_meta IS NOT NULL),
    'sugestao', c.meta_numerica
  ) ORDER BY c.nome), '[]'::jsonb)
  INTO v
  FROM area_indicadores_mestres c
  LEFT JOIN erp_meta m ON m.company_id = p_company_id AND m.indicador_id = c.id
       AND m.escopo_tipo='empresa' AND m.escopo_valor='' AND m.periodo_ref='vigente' AND m.ativo
  WHERE (p_tema IS NULL OR c.tema = p_tema);
  RETURN jsonb_build_object('ok', true, 'tema', p_tema, 'indicadores', v);
END; $function$;

-- ★ O CORAÇÃO: recebe o REALIZADO (o domínio calcula) e devolve o JULGAMENTO.
CREATE OR REPLACE FUNCTION public.fn_meta_comparar(
  p_company_id uuid, p_indicador_id text, p_realizado numeric,
  p_realizado_anterior numeric DEFAULT NULL,
  p_escopo_tipo text DEFAULT 'empresa', p_escopo_valor text DEFAULT '',
  p_periodo_tipo text DEFAULT 'mes', p_periodo_ref text DEFAULT 'vigente')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c record; v_meta numeric; v_fonte text; v_dir text;
  v_desvio numeric; v_status text; v_tend text;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT id, nome, meta_unidade, direcao_boa INTO c FROM area_indicadores_mestres WHERE id = p_indicador_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Indicador não catalogado'); END IF;
  v_dir := COALESCE(c.direcao_boa, 'neutro');

  -- meta: escopo pedido → fallback empresa/vigente
  SELECT valor_meta, fonte INTO v_meta, v_fonte FROM erp_meta
   WHERE company_id=p_company_id AND indicador_id=p_indicador_id AND ativo
     AND escopo_tipo=COALESCE(p_escopo_tipo,'empresa') AND escopo_valor=COALESCE(p_escopo_valor,'')
     AND periodo_tipo=COALESCE(p_periodo_tipo,'mes') AND periodo_ref=COALESCE(p_periodo_ref,'vigente')
   LIMIT 1;
  IF v_meta IS NULL THEN
    SELECT valor_meta, fonte INTO v_meta, v_fonte FROM erp_meta
     WHERE company_id=p_company_id AND indicador_id=p_indicador_id AND ativo
       AND escopo_tipo='empresa' AND escopo_valor='' AND periodo_ref='vigente' LIMIT 1;
  END IF;

  IF v_meta IS NOT NULL AND v_meta <> 0 THEN
    v_desvio := round((p_realizado - v_meta) / abs(v_meta) * 100, 0);
  END IF;

  -- status ciente de direcao_boa (🚨 sem isso o semáforo inverte)
  IF v_meta IS NULL THEN
    v_status := 'sem_meta';
  ELSIF v_dir = 'menor' THEN
    v_status := CASE WHEN p_realizado <= v_meta THEN 'ok'
                     WHEN p_realizado <= v_meta*1.2 THEN 'atencao' ELSE 'critico' END;
  ELSIF v_dir = 'maior' THEN
    v_status := CASE WHEN p_realizado >= v_meta THEN 'ok'
                     WHEN p_realizado >= v_meta*0.8 THEN 'atencao' ELSE 'critico' END;
  ELSE
    v_status := 'neutro';
  END IF;

  -- tendência vs período anterior (ciente de direção)
  IF p_realizado_anterior IS NOT NULL THEN
    v_tend := CASE
      WHEN p_realizado = p_realizado_anterior THEN 'estavel'
      WHEN v_dir='menor' THEN CASE WHEN p_realizado < p_realizado_anterior THEN 'melhorando' ELSE 'piorando' END
      WHEN v_dir='maior' THEN CASE WHEN p_realizado > p_realizado_anterior THEN 'melhorando' ELSE 'piorando' END
      ELSE (CASE WHEN p_realizado > p_realizado_anterior THEN 'subindo' ELSE 'caindo' END) END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'indicador', c.id, 'nome', c.nome, 'unidade', c.meta_unidade, 'direcao_boa', v_dir,
    'realizado', p_realizado, 'meta', v_meta, 'meta_fonte', v_fonte, 'tem_meta', (v_meta IS NOT NULL),
    'desvio_pct', v_desvio, 'status', v_status,
    'periodo_anterior', p_realizado_anterior, 'tendencia', v_tend,
    'benchmark', NULL   -- Fase 2 (erp_benchmark_setor + fn_benchmark_gerar_ia)
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_meta_definir(uuid, text, numeric, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_meta_listar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_meta_comparar(uuid, text, numeric, numeric, text, text, text, text) TO authenticated;
