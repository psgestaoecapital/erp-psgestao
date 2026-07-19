-- OFICINA LOTE 7 · COMISSÃO DO MECÂNICO (cálculo/relatório). Operacional — SEM folha/pagamento.
-- Base: horas reais apontadas (LOTE 4) + produção (valor dos serviços executados) × regra por mecânico.
-- 🚫 NÃO gera folha, título, pagamento ou lançamento financeiro. É um RELATÓRIO gerencial (a GE paga).
-- RD-26 reusa erp_os_apontamento + erp_os_diagnostico_item. RD-45 escopo company_id.
-- Regra por mecânico (nome, pois o mecânico nem sempre é usuário do sistema): percentual sobre a
-- mão de obra produzida OU valor por hora. Regra sem nome = padrão da empresa.

-- 1 · regras de comissão
CREATE TABLE IF NOT EXISTS public.erp_oficina_comissao_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  mecanico_nome text,                 -- NULL = regra padrão da empresa
  tipo text NOT NULL DEFAULT 'percentual_mo',  -- 'percentual_mo' | 'por_hora'
  valor numeric NOT NULL DEFAULT 0,   -- % (percentual_mo) ou R$/h (por_hora)
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ofic_comissao_regra ON public.erp_oficina_comissao_regra(company_id, ativo);

ALTER TABLE public.erp_oficina_comissao_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_ofic_comissao_regra_all ON public.erp_oficina_comissao_regra;
CREATE POLICY erp_ofic_comissao_regra_all ON public.erp_oficina_comissao_regra FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · salvar/atualizar regra (uma ativa por mecânico; regrava a anterior). DEFINER.
CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_regra_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_nome text; v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_nome := nullif(btrim(coalesce(p_dados->>'mecanico_nome','')), '');
  -- desativa a regra anterior do mesmo alvo (mesmo nome, ou a padrão)
  UPDATE erp_oficina_comissao_regra SET ativo = false
    WHERE company_id = p_company_id AND ativo = true
      AND (v_nome IS NULL AND mecanico_nome IS NULL
           OR lower(btrim(coalesce(mecanico_nome,''))) = lower(coalesce(v_nome,'')));
  INSERT INTO erp_oficina_comissao_regra (company_id, mecanico_nome, tipo, valor)
  VALUES (p_company_id, v_nome,
    coalesce(nullif(p_dados->>'tipo',''), 'percentual_mo'),
    coalesce(nullif(p_dados->>'valor','')::numeric, 0))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- 3 · listar regras ativas. INVOKER.
CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_regras(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'mecanico_nome', mecanico_nome,
           'tipo', tipo, 'valor', valor) ORDER BY mecanico_nome NULLS FIRST), '[]'::jsonb)
  FROM erp_oficina_comissao_regra
  WHERE company_id = p_company_id AND ativo = true
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$$;

-- 4 · calcular comissão por mecânico no período (relatório). INVOKER. NÃO grava nada.
CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_calcular(
  p_company_id uuid, p_data_ini date, p_data_fim date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH ap AS (
    SELECT coalesce(nullif(btrim(a.mecanico_nome),''), '(sem nome)') AS mecanico,
           coalesce(a.tempo_real_h, 0) AS horas,
           coalesce(i.preco, 0) AS producao
    FROM erp_os_apontamento a
    LEFT JOIN erp_os_diagnostico_item i ON i.id = a.diagnostico_item_id
    WHERE a.company_id = p_company_id AND a.status = 'concluido'
      AND a.finalizado_em::date BETWEEN p_data_ini AND p_data_fim
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ), agg AS (
    SELECT mecanico, count(*) AS servicos, sum(horas) AS horas, sum(producao) AS producao
    FROM ap GROUP BY mecanico
  ), comp AS (
    SELECT g.*,
      (SELECT r.tipo FROM erp_oficina_comissao_regra r
         WHERE r.company_id = p_company_id AND r.ativo
           AND (lower(btrim(coalesce(r.mecanico_nome,''))) = lower(g.mecanico) OR r.mecanico_nome IS NULL)
         ORDER BY (r.mecanico_nome IS NULL), r.created_at DESC LIMIT 1) AS regra_tipo,
      (SELECT r.valor FROM erp_oficina_comissao_regra r
         WHERE r.company_id = p_company_id AND r.ativo
           AND (lower(btrim(coalesce(r.mecanico_nome,''))) = lower(g.mecanico) OR r.mecanico_nome IS NULL)
         ORDER BY (r.mecanico_nome IS NULL), r.created_at DESC LIMIT 1) AS regra_valor
    FROM agg g
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'mecanicos', coalesce(jsonb_agg(jsonb_build_object(
        'mecanico', mecanico, 'servicos', servicos, 'horas', horas, 'producao', producao,
        'regra_tipo', regra_tipo, 'regra_valor', regra_valor,
        'comissao', CASE
          WHEN regra_tipo = 'por_hora' THEN round(coalesce(horas,0) * coalesce(regra_valor,0), 2)
          WHEN regra_tipo = 'percentual_mo' THEN round(coalesce(producao,0) * coalesce(regra_valor,0)/100.0, 2)
          ELSE 0 END)
      ORDER BY producao DESC NULLS LAST), '[]'::jsonb)
  ) FROM comp;
$$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_comissao_regra_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comissao_regras(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comissao_calcular(uuid, date, date) TO authenticated;

-- 5 · catálogo: reusa oficina_comissao (rota vazia) → tela de comissão. system_screens 'parcial'.
UPDATE public.module_catalog SET rota = '/dashboard/oficina/comissao' WHERE id = 'oficina_comissao';
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/comissao', 'oficina', 'oficina_comissao', 'Comissão Mecânico', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/comissao');
