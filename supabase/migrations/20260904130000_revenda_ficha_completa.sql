-- Revenda · Onda 3B parte 1 — a ficha completa (avisar, nunca bloquear)
-- SPEC do Engenheiro Chefe 04/09/2026. Dois níveis de completude:
--   (1) margem: só valor_aquisicao;  (2) dados do veículo: chassi/cor/combustível/potência/cilindradas/ano.
-- Selo HONESTO (decisão do CEO, Opção 1): nomeia os campos que faltam, NÃO afirma "não emite" —
--   veicProd é do 0km e o pátio é usado; a exigência real fica pro contador (item 6.1). RD-58.
-- Reduz digitação: catálogo de modelos por empresa (o 2º Corolla herda do 1º) + sugestão de ano pelo
--   chassi (posição 10 do VIN) — SEMPRE sugestão, o usuário confirma; nada é preenchido sozinho (§6.4).

-- ============================================================================
-- 1) Regra de completude — UMA fonte, consumida pelo pátio (view) e pela ficha (RPC)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_fiscais_faltantes(
  p_chassi text, p_cor text, p_combustivel text,
  p_potencia numeric, p_cilindradas numeric, p_ano_fab int, p_ano_mod int
) RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN NULLIF(btrim(COALESCE(p_chassi,'')),'')      IS NULL THEN 'chassi' END,
    CASE WHEN NULLIF(btrim(COALESCE(p_cor,'')),'')         IS NULL THEN 'cor' END,
    CASE WHEN NULLIF(btrim(COALESCE(p_combustivel,'')),'') IS NULL THEN 'combustível' END,
    CASE WHEN p_potencia   IS NULL THEN 'potência' END,
    CASE WHEN p_cilindradas IS NULL THEN 'cilindradas' END,
    CASE WHEN p_ano_fab    IS NULL THEN 'ano de fabricação' END,
    CASE WHEN p_ano_mod    IS NULL THEN 'ano do modelo' END
  ], NULL);
$$;

-- ============================================================================
-- 2) Sugestão de ano pelo chassi (VIN posição 10) — best-effort, NUNCA gravado
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_ano_por_chassi(p_chassi text)
RETURNS int
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := upper(btrim(COALESCE(p_chassi,'')));
  c text;
  base int;
  ano_ref int := EXTRACT(year FROM CURRENT_DATE)::int + 1;  -- aceita o próximo ano-modelo
  v_ano int;
BEGIN
  -- VIN padronizado tem 17 caracteres; fora disso não decodifica com confiança
  IF length(v) <> 17 THEN RETURN NULL; END IF;
  c := substr(v, 10, 1);
  base := CASE c
    WHEN 'A' THEN 1980 WHEN 'B' THEN 1981 WHEN 'C' THEN 1982 WHEN 'D' THEN 1983 WHEN 'E' THEN 1984
    WHEN 'F' THEN 1985 WHEN 'G' THEN 1986 WHEN 'H' THEN 1987 WHEN 'J' THEN 1988 WHEN 'K' THEN 1989
    WHEN 'L' THEN 1990 WHEN 'M' THEN 1991 WHEN 'N' THEN 1992 WHEN 'P' THEN 1993 WHEN 'R' THEN 1994
    WHEN 'S' THEN 1995 WHEN 'T' THEN 1996 WHEN 'V' THEN 1997 WHEN 'W' THEN 1998 WHEN 'X' THEN 1999
    WHEN 'Y' THEN 2000
    WHEN '1' THEN 2001 WHEN '2' THEN 2002 WHEN '3' THEN 2003 WHEN '4' THEN 2004 WHEN '5' THEN 2005
    WHEN '6' THEN 2006 WHEN '7' THEN 2007 WHEN '8' THEN 2008 WHEN '9' THEN 2009
    ELSE NULL END;  -- I,O,Q,U,Z,0 não são usados na posição do ano
  IF base IS NULL THEN RETURN NULL; END IF;
  -- o código repete a cada 30 anos; escolhe a ocorrência mais recente que não passe do ano-modelo aceito
  v_ano := base + 30 * GREATEST(0, floor((ano_ref - base) / 30.0)::int);
  IF v_ano > ano_ref THEN v_ano := v_ano - 30; END IF;
  RETURN v_ano;
END $$;

-- ============================================================================
-- 3) Pátio: view ganha tem_custo + fiscais_faltantes + sugestao_ano_chassi
-- ============================================================================
CREATE OR REPLACE VIEW public.v_veic_patio AS
  SELECT v.id, v.company_id, v.chassi, v.placa, v.marca, v.modelo, v.versao, v.ano_modelo, v.cor,
    v.situacao, v.origem, v.data_entrada, v.foto_url, v.valor_aquisicao,
    CURRENT_DATE - v.data_entrada AS dias_patio,
    COALESCE(v.valor_aquisicao, 0::numeric) + COALESCE((
      SELECT sum(c.valor) FROM veic_custo c WHERE c.veiculo_id = v.id AND c.deleted_at IS NULL
    ), 0::numeric) AS custo_acumulado,
    COALESCE(cfg.margem_alvo_pct, 20::numeric) AS margem_alvo_pct,
    CASE
      WHEN (CURRENT_DATE - v.data_entrada) <= COALESCE(cfg.semaforo_verde_ate_dias, 30) THEN 'verde'::text
      WHEN (CURRENT_DATE - v.data_entrada) <= COALESCE(cfg.semaforo_amarelo_ate_dias, 60) THEN 'amarelo'::text
      ELSE 'vermelho'::text
    END AS semaforo,
    -- completude (nível 1: margem)
    (v.valor_aquisicao IS NOT NULL AND v.valor_aquisicao > 0) AS tem_custo,
    -- completude (nível 2: dados do veículo) — mesma regra da ficha
    fn_veic_fiscais_faltantes(v.chassi, v.cor, v.combustivel, v.potencia_cv, v.cilindradas,
                              v.ano_fabricacao, v.ano_modelo) AS fiscais_faltantes,
    fn_veic_ano_por_chassi(v.chassi) AS sugestao_ano_chassi
  FROM veic_veiculo v
  LEFT JOIN veic_config cfg ON cfg.company_id = v.company_id
  WHERE v.deleted_at IS NULL;

-- ============================================================================
-- 4) Editar dados do veículo (NÃO existia — só havia fn_veic_criar)
--    COALESCE(NULLIF(...)) → só muda o que veio; ausente/'' não zera valor humano (§6.4/aceite #8)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(
  p_veiculo_id uuid, p_dados jsonb, p_user uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE veic_veiculo SET
    marca          = COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    modelo         = COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    versao         = COALESCE(NULLIF(btrim(p_dados->>'versao'),''), versao),
    cor            = COALESCE(NULLIF(btrim(p_dados->>'cor'),''), cor),
    combustivel    = COALESCE(NULLIF(btrim(p_dados->>'combustivel'),''), combustivel),
    placa          = COALESCE(NULLIF(btrim(p_dados->>'placa'),''), placa),
    renavam        = COALESCE(NULLIF(btrim(p_dados->>'renavam'),''), renavam),
    cambio         = COALESCE(NULLIF(btrim(p_dados->>'cambio'),''), cambio),
    potencia_cv    = COALESCE(NULLIF(p_dados->>'potencia_cv','')::numeric, potencia_cv),
    cilindradas    = COALESCE(NULLIF(p_dados->>'cilindradas','')::numeric, cilindradas),
    portas         = COALESCE(NULLIF(p_dados->>'portas','')::int, portas),
    ano_fabricacao = COALESCE(NULLIF(p_dados->>'ano_fabricacao','')::int, ano_fabricacao),
    ano_modelo     = COALESCE(NULLIF(p_dados->>'ano_modelo','')::int, ano_modelo),
    km_entrada     = COALESCE(NULLIF(p_dados->>'km_entrada','')::numeric, km_entrada),
    valor_aquisicao= COALESCE(NULLIF(p_dados->>'valor_aquisicao','')::numeric, valor_aquisicao),
    updated_by = p_user, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', p_user,
          jsonb_build_object('campos', (SELECT array_agg(k) FROM jsonb_object_keys(p_dados) k)));

  RETURN jsonb_build_object('ok', true);
END $$;

-- ============================================================================
-- 5) Catálogo de modelos por empresa — o 2º Corolla herda do 1º
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.veic_modelo_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marca text NOT NULL,
  modelo text NOT NULL,
  versao text,
  combustivel text,
  potencia_cv numeric,
  cilindradas numeric,
  portas int,
  cambio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
-- um modelo por (empresa, marca, modelo, versão) — versão nula conta como ''
CREATE UNIQUE INDEX IF NOT EXISTS uq_veic_modelo_catalogo
  ON public.veic_modelo_catalogo (company_id, lower(marca), lower(modelo), lower(COALESCE(versao,'')));

ALTER TABLE public.veic_modelo_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_modelo_catalogo_rw ON public.veic_modelo_catalogo;
CREATE POLICY veic_modelo_catalogo_rw ON public.veic_modelo_catalogo
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE OR REPLACE FUNCTION public.fn_veic_modelo_salvar(
  p_company_id uuid, p_modelo jsonb, p_user uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_marca text := NULLIF(btrim(p_modelo->>'marca'),''); v_modelo text := NULLIF(btrim(p_modelo->>'modelo'),'');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_marca IS NULL OR v_modelo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'marca_e_modelo_obrigatorios'); END IF;

  INSERT INTO veic_modelo_catalogo (company_id, marca, modelo, versao, combustivel, potencia_cv, cilindradas, portas, cambio, created_by, updated_by)
  VALUES (p_company_id, v_marca, v_modelo, NULLIF(btrim(p_modelo->>'versao'),''),
          NULLIF(btrim(p_modelo->>'combustivel'),''), NULLIF(p_modelo->>'potencia_cv','')::numeric,
          NULLIF(p_modelo->>'cilindradas','')::numeric, NULLIF(p_modelo->>'portas','')::int,
          NULLIF(btrim(p_modelo->>'cambio'),''), p_user, p_user)
  ON CONFLICT (company_id, lower(marca), lower(modelo), lower(COALESCE(versao,'')))
  DO UPDATE SET combustivel = COALESCE(EXCLUDED.combustivel, veic_modelo_catalogo.combustivel),
                potencia_cv = COALESCE(EXCLUDED.potencia_cv, veic_modelo_catalogo.potencia_cv),
                cilindradas = COALESCE(EXCLUDED.cilindradas, veic_modelo_catalogo.cilindradas),
                portas      = COALESCE(EXCLUDED.portas, veic_modelo_catalogo.portas),
                cambio      = COALESCE(EXCLUDED.cambio, veic_modelo_catalogo.cambio),
                updated_by = p_user, updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_veic_modelo_listar(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.marca, m.modelo, m.versao), '[]'::jsonb)
    INTO v_out FROM veic_modelo_catalogo m WHERE m.company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'modelos', v_out);
END $$;

-- aplica um modelo a veículos: só PREENCHE campo NULO (nunca sobrescreve dado humano — §6.4).
-- p_veiculo_ids NULL → casa por marca+modelo (aceite #4: aplicar aos 3 Corollas de uma vez).
CREATE OR REPLACE FUNCTION public.fn_veic_modelo_aplicar(
  p_company_id uuid, p_modelo_id uuid, p_veiculo_ids uuid[], p_user uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE m veic_modelo_catalogo; v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO m FROM veic_modelo_catalogo WHERE id = p_modelo_id AND company_id = p_company_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'modelo_nao_encontrado'); END IF;

  WITH alvo AS (
    UPDATE veic_veiculo v SET
      combustivel = COALESCE(v.combustivel, m.combustivel),
      potencia_cv = COALESCE(v.potencia_cv, m.potencia_cv),
      cilindradas = COALESCE(v.cilindradas, m.cilindradas),
      portas      = COALESCE(v.portas, m.portas),
      cambio      = COALESCE(v.cambio, m.cambio),
      updated_by = p_user, updated_at = now()
    WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
      AND (
        (p_veiculo_ids IS NOT NULL AND v.id = ANY(p_veiculo_ids))
        OR (p_veiculo_ids IS NULL AND lower(btrim(COALESCE(v.marca,''))) = lower(m.marca)
                                  AND lower(btrim(COALESCE(v.modelo,''))) = lower(m.modelo))
      )
      -- só toca quem tem ao menos um campo vazio que o modelo preenche (evita update no-op)
      AND (v.combustivel IS NULL OR v.potencia_cv IS NULL OR v.cilindradas IS NULL OR v.portas IS NULL OR v.cambio IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM alvo;

  RETURN jsonb_build_object('ok', true, 'atualizados', v_n);
END $$;

-- ============================================================================
-- 6) grants (o front chama via RPC autenticado)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.fn_veic_atualizar_dados(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_modelo_salvar(uuid, jsonb, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_modelo_listar(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_modelo_aplicar(uuid, uuid, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_fiscais_faltantes(text, text, text, numeric, numeric, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_ano_por_chassi(text) TO authenticated;
