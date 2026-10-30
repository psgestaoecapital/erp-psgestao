-- Produtividade da Indústria — PR A2 · BANCO do custo do posto e do rateio (CEO 28/10, Frioeste/Cleverton).
-- Alimenta a TELA 2 (Postos). NÚCLEO GENÉRICO: nada de bovino/frigorífico no código. Aditiva.
-- LGPD (regra do CEO 28/10): posto com MENOS DE 3 pessoas NÃO devolve mão de obra (nem a soma, nem dentro do custo/hora):
-- devolve o custo/hora sem mão de obra e mao_obra_protegida=true. Com 3+ pessoas, só o TOTAL agregado do posto.
-- Tabela de custo sem acesso direto (RLS ligada, sem policy, REVOKE de anon e authenticated): só as RPCs.
-- check-fn-guards: toda SECURITY DEFINER tem REVOKE anon; escrita confere empresa e grava autoria por auth.uid().

-- 1. Custo do posto com vigência (digitado pela empresa)
CREATE TABLE IF NOT EXISTS public.prod_posto_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,
  posto_id uuid NOT NULL REFERENCES public.prod_posto(id),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  mao_obra_mes numeric CHECK (mao_obra_mes IS NULL OR mao_obra_mes >= 0), -- manual; vazio = calcula do cargo/salário base
  encargos_pct numeric NOT NULL DEFAULT 0 CHECK (encargos_pct >= 0),
  energia_mes numeric CHECK (energia_mes IS NULL OR energia_mes >= 0),    -- R$/mês direto, ou kWh × tarifa
  energia_kwh_mes numeric CHECK (energia_kwh_mes IS NULL OR energia_kwh_mes >= 0),
  energia_tarifa_kwh numeric CHECK (energia_tarifa_kwh IS NULL OR energia_tarifa_kwh >= 0),
  agua_mes numeric CHECK (agua_mes IS NULL OR agua_mes >= 0),
  vapor_mes numeric CHECK (vapor_mes IS NULL OR vapor_mes >= 0),
  frio_mes numeric CHECK (frio_mes IS NULL OR frio_mes >= 0),
  ar_comprimido_mes numeric CHECK (ar_comprimido_mes IS NULL OR ar_comprimido_mes >= 0),
  outros_mes numeric CHECK (outros_mes IS NULL OR outros_mes >= 0),
  horas_operacao_mes numeric CHECK (horas_operacao_mes IS NULL OR horas_operacao_mes > 0),
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS ix_prod_posto_custo_posto ON public.prod_posto_custo(company_id, posto_id, vigencia_inicio DESC) WHERE deleted_at IS NULL;
ALTER TABLE public.prod_posto_custo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prod_posto_custo FROM anon, authenticated;

-- 2. Critério de rateio por empresa (padrão: peso)
CREATE TABLE IF NOT EXISTS public.prod_rateio_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,
  criterio text NOT NULL DEFAULT 'peso' CHECK (criterio IN ('peso','valor','subproduto_sem_custo')),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_prod_rateio_config ON public.prod_rateio_config(company_id, vigencia_inicio DESC);
ALTER TABLE public.prod_rateio_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prod_rateio_config FROM anon, authenticated;

-- 3. Preço de referência do produto (usado só no rateio por valor e no abatimento do subproduto)
ALTER TABLE public.prod_produto ADD COLUMN IF NOT EXISTS preco_venda_ref numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prod_produto_preco_ref_chk') THEN
    ALTER TABLE public.prod_produto ADD CONSTRAINT prod_produto_preco_ref_chk CHECK (preco_venda_ref IS NULL OR preco_venda_ref >= 0);
  END IF;
END $$;

-- 4. Custo/hora do posto vigente (função auxiliar interna, chamada só por posto — nunca por linha em volume)
CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_hora_interno(p_posto_id uuid, p_ref date DEFAULT current_date)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE c prod_posto_custo%ROWTYPE; v_mo numeric; v_mo_origem text; v_energia numeric; v_total numeric; v_horas numeric; v_falta text[] := '{}';
        v_nom int; v_tur int; v_n int; v_prot boolean;
BEGIN
  SELECT * INTO c FROM prod_posto_custo
   WHERE posto_id = p_posto_id AND deleted_at IS NULL AND vigencia_inicio <= p_ref AND (vigencia_fim IS NULL OR vigencia_fim >= p_ref)
   ORDER BY vigencia_inicio DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tem_custo', false, 'falta', jsonb_build_array('custo do posto não cadastrado'));
  END IF;
  IF c.mao_obra_mes IS NOT NULL THEN
    v_mo := c.mao_obra_mes * (1 + c.encargos_pct/100.0); v_mo_origem := 'manual';
  ELSE
    SELECT sum(sb.valor) INTO v_mo FROM prod_posto_pessoa pp
      JOIN LATERAL (SELECT valor FROM prod_salario_base s WHERE s.funcionario_id = pp.funcionario_id
                    AND s.vigencia_inicio <= p_ref AND (s.vigencia_fim IS NULL OR s.vigencia_fim >= p_ref)
                    ORDER BY s.vigencia_inicio DESC LIMIT 1) sb ON true
     WHERE pp.posto_id = p_posto_id AND pp.vigencia_inicio <= p_ref AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= p_ref);
    IF v_mo IS NOT NULL THEN v_mo := v_mo * (1 + c.encargos_pct/100.0); v_mo_origem := 'cargo_salario_base'; END IF;
  END IF;
  -- nº de pessoas do posto (nominal vigente e quadro por turno); o menor valor conhecido decide — na dúvida, protege
  SELECT count(*) INTO v_nom FROM prod_posto_pessoa pp
   WHERE pp.posto_id = p_posto_id AND pp.vigencia_inicio <= p_ref AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= p_ref);
  SELECT sum(t.pessoas)::int INTO v_tur FROM prod_posto_turno t
   WHERE t.posto_id = p_posto_id AND t.vigencia_inicio <= p_ref AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= p_ref);
  v_n := LEAST(COALESCE(NULLIF(v_nom,0), 2147483647), COALESCE(NULLIF(v_tur,0), 2147483647));
  v_prot := (v_n = 2147483647 OR v_n < 3);
  IF v_prot THEN
    v_mo := NULL; v_mo_origem := NULL;
  ELSIF v_mo IS NULL THEN
    v_falta := v_falta || 'mão de obra sem salário base ou valor informado';
  END IF;
  v_energia := coalesce(c.energia_mes, c.energia_kwh_mes * c.energia_tarifa_kwh);
  v_total := coalesce(v_mo,0) + coalesce(v_energia,0) + coalesce(c.agua_mes,0) + coalesce(c.vapor_mes,0)
           + coalesce(c.frio_mes,0) + coalesce(c.ar_comprimido_mes,0) + coalesce(c.outros_mes,0);
  v_horas := c.horas_operacao_mes;
  IF v_horas IS NULL THEN v_falta := v_falta || 'horas de operação por mês não informadas'; END IF;
  RETURN jsonb_build_object('tem_custo', true, 'vigencia_inicio', c.vigencia_inicio,
    'mao_obra_protegida', v_prot, 'mao_obra_mes', v_mo, 'mao_obra_origem', v_mo_origem, 'energia_mes', v_energia,
    'utilidades_mes', coalesce(c.agua_mes,0)+coalesce(c.vapor_mes,0)+coalesce(c.frio_mes,0)+coalesce(c.ar_comprimido_mes,0),
    'outros_mes', c.outros_mes, 'total_mes', v_total, 'horas_operacao_mes', v_horas,
    'custo_hora', CASE WHEN v_horas > 0 THEN round(v_total / v_horas, 4) END, 'falta', to_jsonb(v_falta));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_hora_interno(uuid, date) FROM PUBLIC, anon, authenticated;

-- 5. Postos VIVOS: o mesmo dado do mapa, visto por posto (atividades/raias, pessoas, tempo, capacidade, custo/hora)
CREATE OR REPLACE FUNCTION public.fn_prod_posto_vivo_listar(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = p_plant_id AND ip.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'numero_ord', x->>'atividade'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'numero_ord', lpad(coalesce(p.numero,''), 6, '0'), 'atividade', p.atividade,
      'setor_id', p.setor_id, 'setor_nome', s.nome,
      'aparece_em', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('etapa_id', e.id, 'atividade', coalesce(e.nome, p.atividade),
                 'raia_id', f.id, 'raia', f.nome, 'tipo', e.tipo, 'unidade', e.unidade,
                 'tempo_ciclo_seg', e.tempo_ciclo_seg, 'pessoas', e.pessoas) ORDER BY f.ordem, e.ordem)
        FROM prod_fluxo_etapa e JOIN prod_fluxo f ON f.id = e.fluxo_id AND f.deleted_at IS NULL
        WHERE e.posto_id = p.id AND e.deleted_at IS NULL), '[]'::jsonb),
      'produz', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('codigo', pd.codigo, 'nome', pd.nome, 'tipo_saida', es.tipo_saida))
        FROM prod_fluxo_etapa e JOIN prod_estrutura es ON es.fluxo_id = e.fluxo_id AND es.ativo
        JOIN prod_produto pd ON pd.id = es.produto_id
        WHERE e.posto_id = p.id AND e.deleted_at IS NULL), '[]'::jsonb),
      'pessoas_turno', (SELECT sum(t.pessoas) FROM prod_posto_turno t WHERE t.posto_id = p.id
                         AND t.vigencia_inicio <= current_date AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= current_date)),
      'capacidade_hora', p.capacidade_hora, 'capacidade_origem', p.capacidade_origem,
      'custo', fn_prod_posto_custo_hora_interno(p.id)
    ) AS x
    FROM prod_posto p LEFT JOIN prod_setor s ON s.id = p.setor_id AND s.company_id = p.company_id
    WHERE p.company_id = p_company_id AND p.plant_id = p_plant_id AND p.ativo IS NOT FALSE
  ) t;
  RETURN jsonb_build_object('ok', true, 'postos', v,
    'criterio_rateio', (SELECT criterio FROM prod_rateio_config WHERE company_id = p_company_id ORDER BY vigencia_inicio DESC, created_at DESC LIMIT 1));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_posto_vivo_listar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_vivo_listar(uuid, uuid) TO authenticated;

-- 6. Editar o posto (mesma fonte do mapa): nome da atividade, tempo de ciclo, pessoas e capacidade
CREATE OR REPLACE FUNCTION public.fn_prod_posto_editar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'posto_id','')::uuid; v_comp uuid; v_atv text := NULLIF(btrim(coalesce(p_dados->>'atividade','')),'');
        v_cap numeric := NULLIF(p_dados->>'capacidade_hora','')::numeric; v_orig text := NULLIF(p_dados->>'capacidade_origem','');
BEGIN
  SELECT company_id INTO v_comp FROM prod_posto WHERE id = v_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_cap IS NOT NULL AND v_cap <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'capacidade_invalida'); END IF;
  UPDATE prod_posto SET atividade = coalesce(v_atv, atividade), capacidade_hora = coalesce(v_cap, capacidade_hora),
    capacidade_origem = coalesce(v_orig, capacidade_origem), updated_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_posto_editar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_editar(jsonb) TO authenticated;

-- 7. Salvar o custo do posto (nova vigência encerra a anterior; nunca apaga histórico)
CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_posto uuid := NULLIF(p_dados->>'posto_id','')::uuid; v_comp uuid; v_plant uuid; v_ini date := coalesce(NULLIF(p_dados->>'vigencia_inicio','')::date, current_date); v_id uuid;
BEGIN
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_posto WHERE id = v_posto;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE prod_posto_custo SET vigencia_fim = v_ini - 1
   WHERE posto_id = v_posto AND deleted_at IS NULL AND vigencia_fim IS NULL AND vigencia_inicio < v_ini;
  UPDATE prod_posto_custo SET deleted_at = now(), deleted_by = auth.uid()
   WHERE posto_id = v_posto AND deleted_at IS NULL AND vigencia_inicio = v_ini;
  INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct, energia_mes, energia_kwh_mes,
      energia_tarifa_kwh, agua_mes, vapor_mes, frio_mes, ar_comprimido_mes, outros_mes, horas_operacao_mes, criado_por)
  VALUES (v_comp, v_plant, v_posto, v_ini, NULLIF(p_dados->>'mao_obra_mes','')::numeric, coalesce(NULLIF(p_dados->>'encargos_pct','')::numeric, 0),
      NULLIF(p_dados->>'energia_mes','')::numeric, NULLIF(p_dados->>'energia_kwh_mes','')::numeric, NULLIF(p_dados->>'energia_tarifa_kwh','')::numeric,
      NULLIF(p_dados->>'agua_mes','')::numeric, NULLIF(p_dados->>'vapor_mes','')::numeric, NULLIF(p_dados->>'frio_mes','')::numeric,
      NULLIF(p_dados->>'ar_comprimido_mes','')::numeric, NULLIF(p_dados->>'outros_mes','')::numeric,
      NULLIF(p_dados->>'horas_operacao_mes','')::numeric, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_salvar(jsonb) TO authenticated;

-- 8. Critério de rateio da empresa
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_criterio_salvar(p_company_id uuid, p_plant_id uuid, p_criterio text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_criterio NOT IN ('peso','valor','subproduto_sem_custo') THEN RETURN jsonb_build_object('ok', false, 'erro', 'criterio_invalido'); END IF;
  IF p_plant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = p_plant_id AND ip.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  INSERT INTO prod_rateio_config (company_id, plant_id, criterio, criado_por) VALUES (p_company_id, p_plant_id, p_criterio, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_rateio_criterio_salvar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_criterio_salvar(uuid, uuid, text) TO authenticated;

-- 9. Rateio de uma RAIA (posto compartilhado): parte do custo de cada saída conforme o critério ativo
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_raia(p_fluxo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_crit text; v_saidas jsonb; v_den numeric; v_abate numeric := 0;
BEGIN
  SELECT company_id INTO v_comp FROM prod_fluxo WHERE id = p_fluxo_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT criterio INTO v_crit FROM prod_rateio_config WHERE company_id = v_comp ORDER BY vigencia_inicio DESC, created_at DESC LIMIT 1;
  v_crit := coalesce(v_crit, 'peso');

  WITH r AS (
    SELECT es.produto_id, pd.codigo, pd.nome, es.tipo_saida, coalesce(es.rendimento_padrao_pct,0) AS rend, pd.preco_venda_ref AS preco,
      CASE WHEN v_crit = 'valor' THEN coalesce(es.rendimento_padrao_pct,0) * coalesce(pd.preco_venda_ref,0)
           WHEN v_crit = 'subproduto_sem_custo' AND es.tipo_saida = 'subproduto' THEN 0
           ELSE coalesce(es.rendimento_padrao_pct,0) END AS peso_base
      FROM prod_estrutura es JOIN prod_produto pd ON pd.id = es.produto_id
     WHERE es.fluxo_id = p_fluxo_id AND es.company_id = v_comp AND es.ativo
  ), tot AS (SELECT sum(peso_base) AS den FROM r)
  SELECT (SELECT den FROM tot),
         COALESCE((SELECT sum(rend/100.0 * preco) FROM r WHERE v_crit = 'subproduto_sem_custo' AND tipo_saida = 'subproduto' AND preco IS NOT NULL), 0),
         COALESCE(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'codigo', codigo, 'nome', nome, 'tipo_saida', tipo_saida,
           'rendimento_pct', rend, 'preco_venda_ref', preco,
           'parte_custo_pct', CASE WHEN coalesce((SELECT den FROM tot),0) > 0 THEN round(100.0 * peso_base / (SELECT den FROM tot), 2) END,
           'aviso', CASE WHEN v_crit = 'valor' AND preco IS NULL THEN 'sem preço de referência' END) ORDER BY rend DESC), '[]'::jsonb)
    INTO v_den, v_abate, v_saidas FROM r;
  RETURN jsonb_build_object('ok', true, 'criterio', v_crit, 'saidas', v_saidas, 'abatimento_rs_por_kg_entrada', v_abate,
    'aviso', CASE WHEN coalesce(v_den,0) = 0 THEN 'raia sem saídas cadastradas com rendimento' END);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_rateio_raia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_raia(uuid) TO authenticated;
