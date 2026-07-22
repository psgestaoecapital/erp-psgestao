-- PARTE 3 — Mapeamento de centro de custo (substitui o regex do #748).
-- Regex adivinha e erra em silêncio — inaceitável em dado financeiro. Valor não mapeado
-- NÃO é adivinhado: entra como 'extra' + revisar=true e é listado pro usuário configurar.

CREATE TABLE IF NOT EXISTS public.erp_centro_custo_mapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  valor_origem text NOT NULL,                 -- como vem no lançamento: 'DIR_GADO','COMUM',...
  tipo_apropriacao text NOT NULL CHECK (tipo_apropriacao IN ('direto','comum','extra')),
  business_line_id uuid NULL REFERENCES public.business_lines(id),
  lote_id uuid NULL REFERENCES public.erp_pec_lote(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, valor_origem)
);
ALTER TABLE public.erp_centro_custo_mapa ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_cc_mapa ON public.erp_centro_custo_mapa
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- lançamento ganha flag de revisão + linha de negócio (pro importador não adivinhar)
ALTER TABLE public.erp_pec_custo_lancamento
  ADD COLUMN IF NOT EXISTS revisar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_line_id uuid NULL REFERENCES public.business_lines(id);

-- Importador REESCRITO: consulta o mapa. Sem mapa → extra + revisar (nunca adivinha).
CREATE OR REPLACE FUNCTION public.fn_pec_custo_importar_do_pagar(p_company uuid, p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ins int; v_revisar int; v_pendentes jsonb;
BEGIN
  WITH cand AS (
    SELECT p.id, p.descricao, p.valor, p.centro_custo, p.categoria,
           COALESCE(p.data_pagamento, p.data_vencimento) AS competencia,
           m.tipo_apropriacao AS m_tipo, m.lote_id AS m_lote, m.business_line_id AS m_bl,
           (m.id IS NOT NULL) AS mapeado
    FROM erp_pagar p
    LEFT JOIN erp_centro_custo_mapa m
      ON m.company_id = p.company_id AND m.ativo
     AND m.valor_origem = COALESCE(p.centro_custo, '')
    WHERE p.company_id = p_company
      AND COALESCE(p.data_pagamento, p.data_vencimento) BETWEEN p_ini AND p_fim
      AND p.centro_custo IS NOT NULL AND btrim(p.centro_custo) <> ''
  ),
  ins AS (
    INSERT INTO erp_pec_custo_lancamento
      (company_id, lote_id, business_line_id, tipo_apropriacao, categoria, descricao, valor,
       data_competencia, origem, origem_ref_id, revisar, observacao)
    SELECT p_company,
      CASE WHEN mapeado THEN m_lote ELSE NULL END,
      CASE WHEN mapeado THEN m_bl ELSE NULL END,
      CASE WHEN mapeado THEN m_tipo ELSE 'extra' END,   -- NÃO mapeado NÃO é adivinhado
      CASE WHEN categoria ~* 'nutri|ração|racao|sal|milho|silag' THEN 'nutricao'
           WHEN categoria ~* 'sanid|vacin|vermi|medic|veterin'    THEN 'sanidade'
           WHEN categoria ~* 'reprod|insemin|semen|touro'         THEN 'reproducao'
           WHEN categoria ~* 'mao|salario|folha|funcion'          THEN 'mao_obra'
           WHEN categoria ~* 'pasto|pastagem|semente|aduba'       THEN 'pastagem'
           WHEN categoria ~* 'arrend'                              THEN 'arrendamento'
           WHEN categoria ~* 'maquin|trator|combust|diesel'       THEN 'maquinas'
           WHEN categoria ~* 'admin|contab|escrit'                THEN 'administrativo'
           ELSE 'outro' END,
      COALESCE(descricao, 'Importado do financeiro'), COALESCE(valor, 0), competencia,
      'erp_pagar', id::text,
      (NOT mapeado),                                     -- revisar=true quando não mapeado
      'importado de erp_pagar · centro_custo: ' || COALESCE(centro_custo,'(vazio)')
        || CASE WHEN mapeado THEN '' ELSE ' · NÃO MAPEADO (revise)' END
    FROM cand
    ON CONFLICT (company_id, origem, origem_ref_id) WHERE origem_ref_id IS NOT NULL DO NOTHING
    RETURNING revisar
  )
  SELECT count(*), count(*) FILTER (WHERE revisar) INTO v_ins, v_revisar FROM ins;

  -- centros de custo distintos ainda SEM mapa (pro usuário configurar antes de ratear)
  SELECT COALESCE(jsonb_agg(DISTINCT p.centro_custo), '[]'::jsonb) INTO v_pendentes
  FROM erp_pagar p
  WHERE p.company_id = p_company
    AND COALESCE(p.data_pagamento, p.data_vencimento) BETWEEN p_ini AND p_fim
    AND p.centro_custo IS NOT NULL AND btrim(p.centro_custo) <> ''
    AND NOT EXISTS (SELECT 1 FROM erp_centro_custo_mapa m
                    WHERE m.company_id = p_company AND m.ativo AND m.valor_origem = p.centro_custo);

  RETURN jsonb_build_object('ok', true, 'importados', COALESCE(v_ins,0),
    'em_revisao', COALESCE(v_revisar,0),
    'centros_nao_mapeados', v_pendentes,
    'nota', 'Não mapeado NÃO é adivinhado: entra como extra+revisar. Configure o mapa antes de ratear.');
END;
$$;

-- Suporte à tela "Centros de Custo": valores distintos de erp_pagar/erp_receber + se têm mapa.
CREATE OR REPLACE FUNCTION public.fn_centro_custo_valores(p_company uuid)
RETURNS TABLE(valor_origem text, ocorrencias bigint, mapeado boolean, tipo_apropriacao text, business_line_id uuid, lote_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH vals AS (
    SELECT centro_custo AS v, count(*) AS n FROM erp_pagar
      WHERE company_id = p_company AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    SELECT centro_custo AS v, count(*) AS n FROM erp_receber
      WHERE company_id = p_company AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
  ),
  agg AS (SELECT v, SUM(n) AS n FROM vals GROUP BY v)
  SELECT agg.v, agg.n, (m.id IS NOT NULL),
         m.tipo_apropriacao, m.business_line_id, m.lote_id
  FROM agg
  LEFT JOIN erp_centro_custo_mapa m ON m.company_id = p_company AND m.ativo AND m.valor_origem = agg.v
  ORDER BY (m.id IS NOT NULL), agg.n DESC;
$$;
