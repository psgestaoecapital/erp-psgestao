-- R9c · Garantia da venda (Revenda / Onda 9). Garantia por venda (prazo/KM + termo), acionamento que
-- REUSA a OS de preparação (Oficina) — o custo da OS já volta ao veículo por veic_custo(os_id) e entra no
-- lucro real (fn_veic_conta_do_carro). Sinistro por modelo. Provisão OPCIONAL por empresa: se o perfil
-- vigente marca garantia_provisao, grava o valor de provisão (% da config × venda); senão 0 (há revenda
-- que não provisiona) — sem provisão, nenhum valor é lançado. Autoria por auth.uid(); SECURITY DEFINER sem anon.

-- ── tabelas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veic_garantia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  venda_id uuid NOT NULL UNIQUE,
  veiculo_id uuid NOT NULL,
  prazo_meses integer,
  km_limite numeric,
  termo_md text,
  provisao_ativa boolean NOT NULL DEFAULT false,
  provisao_valor numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativa',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.veic_garantia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_garantia_rw ON public.veic_garantia;
CREATE POLICY veic_garantia_rw ON public.veic_garantia FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.veic_garantia_acionamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  garantia_id uuid NOT NULL REFERENCES public.veic_garantia(id) ON DELETE CASCADE,
  os_id uuid,
  descricao text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.veic_garantia_acionamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_garantia_acion_rw ON public.veic_garantia_acionamento;
CREATE POLICY veic_garantia_acion_rw ON public.veic_garantia_acionamento FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ── registrar/editar a garantia de uma venda ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_garantia_registrar(p_venda_id uuid, p_prazo_meses integer DEFAULT NULL, p_km_limite numeric DEFAULT NULL, p_termo text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_valor numeric; v_prazo int; v_pct numeric; v_prov_on boolean; v_prov numeric; v_id uuid; v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, veiculo_id, valor_venda INTO v_comp, v_veic, v_valor FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_prazo := COALESCE(p_prazo_meses, (SELECT garantia_prazo_meses FROM veic_config WHERE company_id = v_comp));
  v_pct := (SELECT provisao_garantia_pct FROM veic_config WHERE company_id = v_comp);
  -- provisão OPCIONAL: liga/desliga pelo perfil fiscal vigente (aprovado). Desligada → 0 (sem lançamento).
  v_prov_on := COALESCE((SELECT garantia_provisao FROM veic_perfil_fiscal
                          WHERE company_id = v_comp AND status='aprovado' AND vigente_desde <= current_date
                          ORDER BY vigente_desde DESC, versao DESC LIMIT 1), false);
  v_prov := CASE WHEN v_prov_on AND v_valor IS NOT NULL AND v_pct IS NOT NULL THEN round(v_valor * v_pct/100.0, 2) ELSE 0 END;

  INSERT INTO veic_garantia (company_id, venda_id, veiculo_id, prazo_meses, km_limite, termo_md, provisao_ativa, provisao_valor, created_by)
  VALUES (v_comp, p_venda_id, v_veic, v_prazo, p_km_limite, NULLIF(btrim(p_termo),''), v_prov_on, v_prov, v_autor)
  ON CONFLICT (venda_id) DO UPDATE SET
    prazo_meses = COALESCE(p_prazo_meses, veic_garantia.prazo_meses),
    km_limite = COALESCE(p_km_limite, veic_garantia.km_limite),
    termo_md = COALESCE(NULLIF(btrim(p_termo),''), veic_garantia.termo_md),
    provisao_ativa = v_prov_on, provisao_valor = v_prov, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'garantia_id', v_id, 'prazo_meses', v_prazo, 'provisao_ativa', v_prov_on, 'provisao_valor', v_prov);
END $function$;

-- ── acionar a garantia → abre OS de preparação (custo volta ao veículo/lucro) ─
CREATE OR REPLACE FUNCTION public.fn_veic_garantia_acionar(p_garantia_id uuid, p_descricao text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_os jsonb; v_autor uuid := auth.uid();
BEGIN
  SELECT company_id, veiculo_id INTO v_comp, v_veic FROM veic_garantia WHERE id = p_garantia_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'garantia_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- reusa a OS da Oficina/Preparação (o custo lançado nela volta ao veículo por veic_custo.os_id)
  v_os := fn_veic_preparacao_abrir(v_veic, jsonb_build_object(
            'descricao_servico', 'Garantia — ' || COALESCE(NULLIF(btrim(p_descricao),''), 'acionamento'),
            'prioridade', 'alta'), v_autor);
  IF NOT COALESCE((v_os->>'ok')::boolean, false) THEN RETURN v_os; END IF;
  INSERT INTO veic_garantia_acionamento (company_id, garantia_id, os_id, descricao, created_by)
  VALUES (v_comp, p_garantia_id, NULLIF(v_os->>'os_id','')::uuid, NULLIF(btrim(p_descricao),''), v_autor);
  RETURN jsonb_build_object('ok', true, 'os_id', v_os->>'os_id', 'numero', v_os->>'numero');
END $function$;

-- ── listar garantias da empresa (com nº de acionamentos e custo real que caiu no veículo) ──
CREATE OR REPLACE FUNCTION public.fn_veic_garantia_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.data_venda DESC NULLS LAST), '[]'::jsonb) INTO v_rows FROM (
    SELECT g.id, g.venda_id, g.veiculo_id, g.prazo_meses, g.km_limite, g.status, g.provisao_ativa, g.provisao_valor,
           v.cliente_nome, v.data_venda, v.valor_venda, ve.marca, ve.modelo,
           (SELECT count(*) FROM veic_garantia_acionamento a WHERE a.garantia_id = g.id) AS acionamentos,
           COALESCE((SELECT sum(c.valor) FROM veic_garantia_acionamento a JOIN veic_custo c ON c.os_id = a.os_id
                      WHERE a.garantia_id = g.id AND c.deleted_at IS NULL), 0) AS custo_acionamentos
    FROM veic_garantia g
    JOIN veic_venda v ON v.id = g.venda_id
    JOIN veic_veiculo ve ON ve.id = g.veiculo_id
    WHERE g.company_id = p_company_id
  ) t;
  RETURN jsonb_build_object('ok', true, 'itens', v_rows);
END $function$;

-- ── sinistro por modelo (nº de acionamentos + custo real) no período ─────────
CREATE OR REPLACE FUNCTION public.fn_veic_garantia_sinistro_por_modelo(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.acionamentos DESC, t.modelo), '[]'::jsonb) INTO v_rows FROM (
    SELECT COALESCE(NULLIF(btrim(ve.marca || ' ' || ve.modelo), ''), '—') AS modelo,
           count(*) AS acionamentos,
           COALESCE(sum((SELECT sum(c.valor) FROM veic_custo c WHERE c.os_id = a.os_id AND c.deleted_at IS NULL)), 0) AS custo
    FROM veic_garantia_acionamento a
    JOIN veic_garantia g ON g.id = a.garantia_id
    JOIN veic_veiculo ve ON ve.id = g.veiculo_id
    WHERE a.company_id = p_company_id AND a.created_at::date BETWEEN p_de AND p_ate
    GROUP BY 1
  ) t;
  RETURN jsonb_build_object('ok', true, 'por_modelo', v_rows);
END $function$;

-- ── grants (CEO: SECURITY DEFINER sem anon) ─────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_veic_garantia_registrar(uuid,integer,numeric,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_garantia_acionar(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_garantia_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_garantia_sinistro_por_modelo(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_garantia_registrar(uuid,integer,numeric,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_garantia_acionar(uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_garantia_listar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_garantia_sinistro_por_modelo(uuid,date,date) TO authenticated, service_role;
