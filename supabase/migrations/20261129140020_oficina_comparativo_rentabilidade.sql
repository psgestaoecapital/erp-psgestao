-- Tela "Comparativo da OS" (rentabilidade) — módulo oficina. Pedido da Jordana (planilha da Mecânica Gean),
-- serve TODAS as empresas com oficina. Mostra por OS e geral: Compra, Venda, Diferença, Tributos (produtos e
-- serviços), Taxa de cartão (real do repasse ou estimada) e SOBRA LÍQUIDA (valor e %).
--
-- NATUREZA: só LEITURA + 2 escritas pequenas (tempo manual de mão de obra e parâmetros). NÃO toca
-- fn_os_snapshot_custo_lucro nem os cálculos existentes. Dado sensível (custo/margem): só dono/Master (CLIENT_OWNER),
-- gestor (CLIENT_MANAGER) e PS_ADMIN — operador/viewer/mecânico NÃO veem.
--
-- ADITIVA e idempotente: colunas novas em erp_oficina_parametros (impostos de produtos/serviços e reserva de taxa de
-- cartão), tabela nova erp_os_mao_obra_manual (RLS por empresa, soft-delete), e funções NOVAS. Mantém intactos
-- imposto_venda_pct / pis_cofins_venda_pct (compatibilidade).
--
-- Prioridade do custo de peça (RD-38, provado no dado da Gean): 1) custo real da saída de estoque ligada ao item
-- (erp_os_diagnostico_item.estoque_saida_mov_id → erp_estoque_movimentacoes.custo_unitario); 2) custo_unitario do
-- item; 3) custo médio do produto (erp_produtos.preco_custo_medio, senão preco_custo). Sem nenhum → "custo incompleto".
-- Taxa de cartão (provado): repasses ligados por erp_receber.origem_recebivel_id (eh_repasse_cartao) somando valor_taxa.

-- ============================ PARÂMETROS (colunas novas, aditivas) ============================
ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS imposto_produtos_pct numeric,
  ADD COLUMN IF NOT EXISTS imposto_servicos_pct numeric,
  ADD COLUMN IF NOT EXISTS reserva_taxa_cartao_pct numeric;

COMMENT ON COLUMN public.erp_oficina_parametros.imposto_produtos_pct IS 'Alíquota (%) de tributos sobre a VENDA de peças/produtos na OS (Comparativo da OS). NULL = não configurado.';
COMMENT ON COLUMN public.erp_oficina_parametros.imposto_servicos_pct IS 'Alíquota (%) de tributos sobre a VENDA de serviços/mão de obra na OS (Comparativo da OS). NULL = não configurado.';
COMMENT ON COLUMN public.erp_oficina_parametros.reserva_taxa_cartao_pct IS 'Reserva (%) para estimar a taxa de cartão quando o repasse ainda não foi registrado (fallback do Comparativo da OS).';

-- ============================ TEMPO MANUAL DE MÃO DE OBRA (tabela nova) ============================
CREATE TABLE IF NOT EXISTS public.erp_os_mao_obra_manual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL,
  horas numeric NOT NULL CHECK (horas >= 0 AND horas <= 1000),
  observacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  editado_por uuid,
  editado_em timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_os_mao_obra_manual_os
  ON public.erp_os_mao_obra_manual (company_id, os_id) WHERE deleted_at IS NULL;

ALTER TABLE public.erp_os_mao_obra_manual ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_os_mao_obra_manual' AND policyname='os_mao_obra_manual_sel') THEN
    CREATE POLICY os_mao_obra_manual_sel ON public.erp_os_mao_obra_manual FOR SELECT TO authenticated
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
REVOKE ALL ON public.erp_os_mao_obra_manual FROM anon;
GRANT SELECT ON public.erp_os_mao_obra_manual TO authenticated;
GRANT ALL ON public.erp_os_mao_obra_manual TO service_role;

-- ============================ PERMISSÃO (dado sensível de custo/margem) ============================
CREATE OR REPLACE FUNCTION public.fn_oficina_pode_ver_custo(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  -- Dono/Master (CLIENT_OWNER), gestor/financeiro (CLIENT_MANAGER) e PS_ADMIN. Operador/viewer/mecânico não.
  SELECT public.is_admin()
      OR EXISTS (SELECT 1 FROM tenant_user_roles tur
                  WHERE tur.user_id = auth.uid() AND tur.company_id = p_company_id
                    AND tur.is_active = true AND tur.role IN ('CLIENT_OWNER','CLIENT_MANAGER'));
$function$;
REVOKE ALL ON FUNCTION public.fn_oficina_pode_ver_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_pode_ver_custo(uuid) TO authenticated, service_role;

-- ============================ PARÂMETROS: get / salvar ============================
CREATE OR REPLACE FUNCTION public.fn_oficina_comparativo_params_get(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_ch jsonb;
BEGIN
  IF NOT public.fn_oficina_pode_ver_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil não vê custos/margens da oficina.');
  END IF;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  SELECT jsonb_build_object(
    'ok', true,
    'imposto_produtos_pct', imposto_produtos_pct,
    'imposto_servicos_pct', imposto_servicos_pct,
    'reserva_taxa_cartao_pct', reserva_taxa_cartao_pct,
    'custo_hora_manual', custo_hora_manual,
    'custo_hora_efetivo', (v_ch->>'custo_hora')::numeric,
    'custo_hora_origem', v_ch->>'origem'
  ) INTO v FROM erp_oficina_parametros WHERE company_id = p_company_id;
  RETURN COALESCE(v, jsonb_build_object('ok', true, 'imposto_produtos_pct', NULL, 'imposto_servicos_pct', NULL,
    'reserva_taxa_cartao_pct', NULL, 'custo_hora_manual', NULL,
    'custo_hora_efetivo', (v_ch->>'custo_hora')::numeric, 'custo_hora_origem', v_ch->>'origem'));
END; $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_comparativo_params_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comparativo_params_get(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_oficina_comparativo_params_salvar(
  p_company_id uuid, p_imposto_produtos_pct numeric, p_imposto_servicos_pct numeric,
  p_reserva_taxa_cartao_pct numeric, p_custo_hora_manual numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pct numeric;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só o dono/Master pode mudar os parâmetros.');
  END IF;
  FOREACH v_pct IN ARRAY ARRAY[p_imposto_produtos_pct, p_imposto_servicos_pct, p_reserva_taxa_cartao_pct] LOOP
    IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Percentual deve ficar entre 0 e 100.');
    END IF;
  END LOOP;
  IF p_custo_hora_manual IS NOT NULL AND p_custo_hora_manual < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Custo-hora não pode ser negativo.');
  END IF;
  INSERT INTO erp_oficina_parametros (company_id, imposto_produtos_pct, imposto_servicos_pct, reserva_taxa_cartao_pct, custo_hora_manual, criado_em, alterado_em)
  VALUES (p_company_id, p_imposto_produtos_pct, p_imposto_servicos_pct, p_reserva_taxa_cartao_pct, p_custo_hora_manual, now(), now())
  ON CONFLICT (company_id) DO UPDATE SET
    imposto_produtos_pct = EXCLUDED.imposto_produtos_pct,
    imposto_servicos_pct = EXCLUDED.imposto_servicos_pct,
    reserva_taxa_cartao_pct = EXCLUDED.reserva_taxa_cartao_pct,
    custo_hora_manual = COALESCE(EXCLUDED.custo_hora_manual, erp_oficina_parametros.custo_hora_manual),
    alterado_em = now();
  RETURN public.fn_oficina_comparativo_params_get(p_company_id);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_comparativo_params_salvar(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comparativo_params_salvar(uuid, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- ============================ TEMPO MANUAL: salvar / excluir (RD-98) ============================
CREATE OR REPLACE FUNCTION public.fn_os_mao_obra_manual_salvar(p_company_id uuid, p_os_id uuid, p_horas numeric, p_observacao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.fn_oficina_pode_ver_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil não edita a mão de obra da oficina.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada nesta empresa.');
  END IF;
  IF p_horas IS NULL OR p_horas < 0 OR p_horas > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe as horas (0 a 1000).');
  END IF;
  INSERT INTO erp_os_mao_obra_manual (company_id, os_id, horas, observacao, criado_por, criado_em)
  VALUES (p_company_id, p_os_id, p_horas, NULLIF(btrim(p_observacao),''), auth.uid(), now())
  ON CONFLICT (company_id, os_id) WHERE deleted_at IS NULL
  DO UPDATE SET horas = EXCLUDED.horas, observacao = EXCLUDED.observacao, editado_por = auth.uid(), editado_em = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'horas', p_horas);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_os_mao_obra_manual_salvar(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_mao_obra_manual_salvar(uuid, uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_os_mao_obra_manual_excluir(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_oficina_pode_ver_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil não edita a mão de obra da oficina.');
  END IF;
  UPDATE erp_os_mao_obra_manual SET deleted_at = now(), deleted_by = auth.uid()
   WHERE company_id = p_company_id AND os_id = p_os_id AND deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_os_mao_obra_manual_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_mao_obra_manual_excluir(uuid, uuid) TO authenticated, service_role;

-- ============================ NÚCLEO DO CÁLCULO (set-based, reusável) ============================
-- Calcula os agregados por OS para um conjunto de os_ids. SEM varrer tabela grande (sempre filtrado por company_id
-- e por os_ids) e SEM chamar função por linha (custo-hora e alíquotas vêm por parâmetro). p_modo: 'auto' usa
-- COALESCE(manual, pátio, 0); 'patio'/'manual'/'branco' forçam a origem da mão de obra.
CREATE OR REPLACE FUNCTION public.fn__oficina_comparativo_calc(
  p_company_id uuid, p_os_ids uuid[], p_custo_hora numeric, p_imp_prod numeric, p_imp_serv numeric,
  p_reserva_taxa numeric, p_modo text)
 RETURNS TABLE(
   os_id uuid, numero text, cliente_nome text, placa text, modelo text, status text, data_ref date, forma_pagamento text,
   venda_pecas numeric, venda_servicos numeric, venda_bruta numeric, desconto numeric, venda_liq numeric,
   compra_pecas numeric, compra_avulso numeric, mo_horas numeric, mo_origem text, compra_mo numeric, compra_total numeric,
   diferenca numeric, tributos_produtos numeric, tributos_servicos numeric, tributos numeric,
   taxa_cartao numeric, taxa_origem text, sobra_liq numeric, margem_liq_pct numeric,
   pecas_sem_custo integer, custo_incompleto boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH os AS (
    SELECT o.id, o.numero::text AS numero, o.cliente_nome::text AS cliente_nome, o.placa::text AS placa,
           COALESCE(o.modelo, o.marca)::text AS modelo, o.status::text AS status,
           COALESCE(o.entregue_em::date, o.data_conclusao, o.data_abertura) AS data_ref,
           COALESCE(o.desconto_valor, 0) AS desconto
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.id = ANY(p_os_ids) AND o.excluida = false AND o.cancelada_em IS NULL
  ),
  itens AS (
    SELECT di.os_id, di.tipo,
           COALESCE(di.preco,0) * COALESCE(di.quantidade,0) AS venda_item,
           CASE WHEN di.tipo = 'peca' THEN
             COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) * COALESCE(di.quantidade,0)
           ELSE 0 END AS compra_item,
           CASE WHEN di.tipo = 'peca'
                 AND COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NULL
                THEN 1 ELSE 0 END AS sem_custo
    FROM erp_os_diagnostico_item di
    LEFT JOIN erp_estoque_movimentacoes mv ON mv.id = di.estoque_saida_mov_id
    LEFT JOIN erp_produtos pr ON pr.id = di.produto_id
    WHERE di.company_id = p_company_id AND di.os_id IN (SELECT id FROM os) AND di.aprovado = true
  ),
  item_agg AS (
    SELECT os_id,
      SUM(venda_item) FILTER (WHERE tipo='peca') AS venda_pecas,
      SUM(venda_item) FILTER (WHERE tipo='servico') AS venda_servicos,
      SUM(compra_item) AS compra_pecas,
      SUM(sem_custo)::int AS pecas_sem_custo
    FROM itens GROUP BY os_id
  ),
  avulso AS (
    SELECT ca.os_id, SUM(COALESCE(ca.valor,0)) AS compra_avulso
    FROM erp_os_custo_avulso ca WHERE ca.company_id = p_company_id AND ca.os_id IN (SELECT id FROM os)
    GROUP BY ca.os_id
  ),
  patio AS (
    SELECT ap.os_id, SUM(COALESCE(ap.tempo_real_h, ap.tempo_cronometro_h, 0)) AS horas
    FROM erp_os_apontamento ap WHERE ap.company_id = p_company_id AND ap.os_id IN (SELECT id FROM os)
    GROUP BY ap.os_id
  ),
  manual AS (
    SELECT mm.os_id, mm.horas FROM erp_os_mao_obra_manual mm
    WHERE mm.company_id = p_company_id AND mm.os_id IN (SELECT id FROM os) AND mm.deleted_at IS NULL
  ),
  rec AS (  -- recebíveis principais da OS (não-repasse)
    SELECT r.id, (r.ref_externa_id)::uuid AS os_id, r.forma_pagamento, COALESCE(NULLIF(r.valor_pago,0), r.valor) AS valor_cartao
    FROM erp_receber r
    WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND COALESCE(r.eh_repasse_cartao,false) = false
      AND r.ref_externa_sistema IN ('os','oficina_os')
      AND r.ref_externa_id IN (SELECT id::text FROM os)
  ),
  taxa AS (
    SELECT rc.os_id,
      SUM(CASE WHEN rc.forma_pagamento IN ('cartao_credito','cartao_debito') THEN 1 ELSE 0 END) AS cartoes,
      SUM(COALESCE(rp.taxa_real,0)) AS taxa_real,
      SUM(CASE WHEN rc.forma_pagamento IN ('cartao_credito','cartao_debito') AND COALESCE(rp.taxa_real,0)=0
               THEN COALESCE(rc.valor_cartao,0) * COALESCE(p_reserva_taxa,0)/100.0 ELSE 0 END) AS taxa_estimada
    FROM rec rc
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(rr.valor_taxa,0)) AS taxa_real
      FROM erp_receber rr WHERE rr.origem_recebivel_id = rc.id AND COALESCE(rr.eh_repasse_cartao,false) = true
    ) rp ON true
    GROUP BY rc.os_id
  ),
  calc AS (
    SELECT os.id AS os_id, os.numero, os.cliente_nome, os.placa, os.modelo, os.status, os.data_ref, os.desconto,
      (SELECT string_agg(DISTINCT rc.forma_pagamento, ', ') FROM rec rc WHERE rc.os_id = os.id) AS forma_pagamento,
      COALESCE(ia.venda_pecas,0) AS venda_pecas, COALESCE(ia.venda_servicos,0) AS venda_servicos,
      COALESCE(ia.compra_pecas,0) AS compra_pecas, COALESCE(ia.pecas_sem_custo,0) AS pecas_sem_custo,
      COALESCE(av.compra_avulso,0) AS compra_avulso,
      CASE p_modo
        WHEN 'branco' THEN 0
        WHEN 'patio'  THEN COALESCE(pt.horas,0)
        WHEN 'manual' THEN COALESCE(mn.horas,0)
        ELSE COALESCE(mn.horas, pt.horas, 0)  -- auto
      END AS mo_horas,
      CASE p_modo
        WHEN 'branco' THEN 'branco'
        WHEN 'patio'  THEN 'patio'
        WHEN 'manual' THEN 'manual'
        ELSE CASE WHEN mn.horas IS NOT NULL THEN 'manual' WHEN pt.horas IS NOT NULL THEN 'patio' ELSE 'branco' END
      END AS mo_origem,
      COALESCE(tx.cartoes,0) AS cartoes, COALESCE(tx.taxa_real,0) AS taxa_real, COALESCE(tx.taxa_estimada,0) AS taxa_estimada
    FROM os
    LEFT JOIN item_agg ia ON ia.os_id = os.id
    LEFT JOIN avulso av ON av.os_id = os.id
    LEFT JOIN patio pt ON pt.os_id = os.id
    LEFT JOIN manual mn ON mn.os_id = os.id
    LEFT JOIN taxa tx ON tx.os_id = os.id
  ),
  fim AS (
    SELECT c.*,
      (c.venda_pecas + c.venda_servicos) AS venda_bruta,
      c.mo_horas * COALESCE(p_custo_hora,0) AS compra_mo
    FROM calc c
  ),
  fim2 AS (
    SELECT f.*,
      GREATEST(f.venda_bruta - f.desconto, 0) AS venda_liq,
      (f.compra_pecas + f.compra_avulso + f.compra_mo) AS compra_total,
      -- venda líquida rateada entre peças e serviços (desconto proporcional ao bruto)
      CASE WHEN f.venda_bruta > 0 THEN f.venda_pecas - f.desconto * f.venda_pecas / f.venda_bruta ELSE 0 END AS venda_pecas_liq,
      CASE WHEN f.venda_bruta > 0 THEN f.venda_servicos - f.desconto * f.venda_servicos / f.venda_bruta ELSE f.venda_servicos END AS venda_serv_liq
    FROM fim f
  )
  SELECT
    f.os_id, f.numero, f.cliente_nome, f.placa, f.modelo, f.status, f.data_ref, f.forma_pagamento,
    ROUND(f.venda_pecas,2), ROUND(f.venda_servicos,2), ROUND(f.venda_bruta,2), ROUND(f.desconto,2), ROUND(f.venda_liq,2),
    ROUND(f.compra_pecas,2), ROUND(f.compra_avulso,2), ROUND(f.mo_horas,2), f.mo_origem, ROUND(f.compra_mo,2),
    ROUND(f.compra_total,2),
    ROUND(f.venda_liq - f.compra_total,2) AS diferenca,
    ROUND(f.venda_pecas_liq * COALESCE(p_imp_prod,0)/100.0, 2) AS tributos_produtos,
    ROUND(f.venda_serv_liq * COALESCE(p_imp_serv,0)/100.0, 2) AS tributos_servicos,
    ROUND(f.venda_pecas_liq * COALESCE(p_imp_prod,0)/100.0 + f.venda_serv_liq * COALESCE(p_imp_serv,0)/100.0, 2) AS tributos,
    ROUND(f.taxa_real + f.taxa_estimada, 2) AS taxa_cartao,
    CASE WHEN f.cartoes = 0 THEN 'sem_cartao' WHEN f.taxa_estimada > 0 AND f.taxa_real = 0 THEN 'estimada'
         WHEN f.taxa_estimada > 0 THEN 'parcial' ELSE 'real' END AS taxa_origem,
    ROUND((f.venda_liq - f.compra_total) - (f.venda_pecas_liq * COALESCE(p_imp_prod,0)/100.0 + f.venda_serv_liq * COALESCE(p_imp_serv,0)/100.0) - (f.taxa_real + f.taxa_estimada), 2) AS sobra_liq,
    CASE WHEN f.venda_liq > 0 THEN ROUND(((f.venda_liq - f.compra_total) - (f.venda_pecas_liq * COALESCE(p_imp_prod,0)/100.0 + f.venda_serv_liq * COALESCE(p_imp_serv,0)/100.0) - (f.taxa_real + f.taxa_estimada)) / f.venda_liq * 100, 1) ELSE NULL END AS margem_liq_pct,
    f.pecas_sem_custo,
    (f.pecas_sem_custo > 0) AS custo_incompleto
  FROM fim2 f;
$function$;
REVOKE ALL ON FUNCTION public.fn__oficina_comparativo_calc(uuid, uuid[], numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__oficina_comparativo_calc(uuid, uuid[], numeric, numeric, numeric, numeric, text) TO authenticated, service_role;

-- ============================ ANÁLISE POR OS (detalhe + linhas de item) ============================
CREATE OR REPLACE FUNCTION public.fn_oficina_comparativo_os(p_company_id uuid, p_os_id uuid, p_modo_mao_obra text DEFAULT 'auto')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_params erp_oficina_parametros%rowtype;
  v_ch jsonb; v_custo_hora numeric; v_modo text := lower(coalesce(p_modo_mao_obra,'auto'));
  v_tot record; v_linhas jsonb; v_prev numeric; v_cab jsonb;
BEGIN
  IF NOT public.fn_oficina_pode_ver_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil não vê custos/margens da oficina.');
  END IF;
  IF v_modo NOT IN ('auto','patio','manual','branco') THEN v_modo := 'auto'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada nesta empresa.');
  END IF;
  SELECT * INTO v_params FROM erp_oficina_parametros WHERE company_id = p_company_id;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := (v_ch->>'custo_hora')::numeric;

  SELECT * INTO v_tot FROM public.fn__oficina_comparativo_calc(
    p_company_id, ARRAY[p_os_id]::uuid[], v_custo_hora,
    v_params.imposto_produtos_pct, v_params.imposto_servicos_pct, v_params.reserva_taxa_cartao_pct, v_modo);

  -- previsto da peça (matriz ou margem alvo) para o indicador abaixo/dentro/acima
  v_prev := CASE WHEN COALESCE(v_params.usar_matriz_peca,false) THEN NULL ELSE v_params.margem_alvo_peca_pct END;

  -- linhas (uma por item aprovado), com origem do custo e conferência da planilha
  SELECT jsonb_agg(jsonb_build_object(
    'tipo', t.tipo, 'descricao', t.descricao, 'fornecedor', t.fornecedor, 'codigo', t.codigo,
    'nfe_entrada', t.nfe_entrada, 'quantidade', t.quantidade,
    'compra_unit', t.compra_unit, 'compra', t.compra, 'venda', t.venda, 'diferenca', t.diferenca,
    'pct_planilha', t.pct_planilha, 'margem_venda_pct', t.margem_venda_pct, 'markup_compra_pct', t.markup_compra_pct,
    'origem_custo', t.origem_custo, 'sem_custo', t.sem_custo
  ) ORDER BY t.tipo, t.ord) INTO v_linhas
  FROM (
    SELECT di.ordem AS ord, di.tipo, di.descricao,
      CASE WHEN di.tipo='peca' THEN COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) ELSE NULL END AS compra_unit_raw,
      pr.codigo AS codigo,
      ne.fornecedor AS fornecedor, ne.numero_nf AS nfe_entrada,
      COALESCE(di.quantidade,0) AS quantidade,
      ROUND(CASE WHEN di.tipo='peca' THEN COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) ELSE NULL END,2) AS compra_unit,
      ROUND(CASE WHEN di.tipo='peca' THEN COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) * COALESCE(di.quantidade,0) ELSE 0 END,2) AS compra,
      ROUND(COALESCE(di.preco,0)*COALESCE(di.quantidade,0),2) AS venda,
      ROUND(COALESCE(di.preco,0)*COALESCE(di.quantidade,0) - CASE WHEN di.tipo='peca' THEN COALESCE(COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo),0) * COALESCE(di.quantidade,0) ELSE 0 END,2) AS diferenca,
      CASE WHEN di.tipo='peca' AND COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NOT NULL
            AND (COALESCE(di.preco,0)+COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo))>0
           THEN ROUND( (COALESCE(di.preco,0) - COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo))
             / ((COALESCE(di.preco,0)+COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo))/2.0) * 100,1) ELSE NULL END AS pct_planilha,
      CASE WHEN COALESCE(di.preco,0)>0 AND di.tipo='peca' AND COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NOT NULL
           THEN ROUND((COALESCE(di.preco,0)-COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo))/COALESCE(di.preco,0)*100,1) ELSE NULL END AS margem_venda_pct,
      CASE WHEN di.tipo='peca' AND COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) > 0
           THEN ROUND((COALESCE(di.preco,0)-COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo))/COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo)*100,1) ELSE NULL END AS markup_compra_pct,
      CASE WHEN di.tipo<>'peca' THEN 'servico'
           WHEN mv.custo_unitario IS NOT NULL THEN 'estoque_saida'
           WHEN di.custo_unitario IS NOT NULL THEN 'item'
           WHEN pr.preco_custo_medio IS NOT NULL OR pr.preco_custo IS NOT NULL THEN 'produto_medio'
           ELSE 'sem_custo' END AS origem_custo,
      (di.tipo='peca' AND COALESCE(mv.custo_unitario, di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NULL) AS sem_custo
    FROM erp_os_diagnostico_item di
    LEFT JOIN erp_estoque_movimentacoes mv ON mv.id = di.estoque_saida_mov_id
    LEFT JOIN erp_produtos pr ON pr.id = di.produto_id
    LEFT JOIN LATERAL (
      SELECT ni.custo_unitario_real, nr.emitente_razao AS fornecedor, nr.numero AS numero_nf
      FROM erp_nfe_recebidas_itens ni JOIN erp_nfe_recebidas nr ON nr.id = ni.nfe_recebida_id
      WHERE ni.company_id = p_company_id AND ni.produto_id = di.produto_id
      ORDER BY nr.data_emissao DESC NULLS LAST LIMIT 1
    ) ne ON di.tipo='peca'
    WHERE di.company_id = p_company_id AND di.os_id = p_os_id AND di.aprovado = true
  ) t;

  SELECT jsonb_build_object('os_id', o.id, 'numero', o.numero, 'cliente_nome', o.cliente_nome,
    'placa', o.placa, 'modelo', COALESCE(o.modelo,o.marca), 'status', o.status,
    'data', COALESCE(o.entregue_em::date, o.data_conclusao, o.data_abertura), 'forma_pagamento', v_tot.forma_pagamento)
  INTO v_cab FROM erp_os o WHERE o.id = p_os_id;

  RETURN jsonb_build_object('ok', true,
    'cabecalho', v_cab,
    'modo_mao_obra', v_modo, 'mo_horas', v_tot.mo_horas, 'mo_origem', v_tot.mo_origem,
    'custo_hora', v_custo_hora, 'custo_hora_origem', v_ch->>'origem', 'custo_hora_alerta', v_ch->>'alerta',
    'imposto_produtos_pct', v_params.imposto_produtos_pct, 'imposto_servicos_pct', v_params.imposto_servicos_pct,
    'margem_prevista_peca_pct', v_prev, 'usa_matriz_peca', COALESCE(v_params.usar_matriz_peca,false),
    'linhas', COALESCE(v_linhas,'[]'::jsonb),
    'totais', jsonb_build_object(
      'venda_pecas', v_tot.venda_pecas, 'venda_servicos', v_tot.venda_servicos, 'venda_bruta', v_tot.venda_bruta,
      'desconto', v_tot.desconto, 'venda_liq', v_tot.venda_liq,
      'compra_pecas', v_tot.compra_pecas, 'compra_avulso', v_tot.compra_avulso, 'compra_mo', v_tot.compra_mo, 'compra_total', v_tot.compra_total,
      'diferenca', v_tot.diferenca, 'tributos_produtos', v_tot.tributos_produtos, 'tributos_servicos', v_tot.tributos_servicos, 'tributos', v_tot.tributos,
      'taxa_cartao', v_tot.taxa_cartao, 'taxa_origem', v_tot.taxa_origem,
      'sobra_liq', v_tot.sobra_liq, 'margem_liq_pct', v_tot.margem_liq_pct),
    'alertas', (SELECT jsonb_strip_nulls(jsonb_build_object(
      'tributo_produtos', CASE WHEN v_params.imposto_produtos_pct IS NULL AND v_tot.venda_pecas>0 THEN 'Configure a alíquota de produtos nos parâmetros.' END,
      'tributo_servicos', CASE WHEN v_params.imposto_servicos_pct IS NULL AND v_tot.venda_servicos>0 THEN 'Configure a alíquota de serviços nos parâmetros.' END,
      'custo_hora', CASE WHEN v_custo_hora IS NULL AND v_tot.mo_horas>0 THEN 'Custo-hora não configurado — a mão de obra ficou sem custo.' END,
      'custo_incompleto', CASE WHEN v_tot.pecas_sem_custo>0 THEN (v_tot.pecas_sem_custo || ' peça(s) sem custo conhecido — a margem pode estar inflada.') END)))
  );
END; $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_comparativo_os(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comparativo_os(uuid, uuid, text) TO authenticated, service_role;

-- ============================ ANÁLISE GERAL (paginada) ============================
CREATE OR REPLACE FUNCTION public.fn_oficina_comparativo_geral(
  p_company_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_cliente_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL, p_forma_pagamento text DEFAULT NULL, p_mecanico_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_params erp_oficina_parametros%rowtype; v_ch jsonb; v_custo_hora numeric;
  v_ids uuid[]; v_total int; v_limit int := GREATEST(1, LEAST(COALESCE(p_limit,50), 200)); v_offset int := GREATEST(0, COALESCE(p_offset,0));
  v_linhas jsonb; v_resumo jsonb;
BEGIN
  IF NOT public.fn_oficina_pode_ver_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil não vê custos/margens da oficina.');
  END IF;
  IF p_de IS NOT NULL AND p_ate IS NOT NULL AND p_ate < p_de THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Período inválido.');
  END IF;
  SELECT * INTO v_params FROM erp_oficina_parametros WHERE company_id = p_company_id;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := (v_ch->>'custo_hora')::numeric;

  WITH base AS (
    SELECT o.id, COALESCE(o.entregue_em::date, o.data_conclusao, o.data_abertura) AS data_ref
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.excluida = false AND o.cancelada_em IS NULL
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_cliente_id IS NULL OR o.cliente_id = p_cliente_id)
      AND (p_mecanico_id IS NULL OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.os_id = o.id AND ap.mecanico_id = p_mecanico_id))
      AND (p_forma_pagamento IS NULL OR EXISTS (
            SELECT 1 FROM erp_receber r WHERE r.company_id=p_company_id AND r.deleted_at IS NULL
              AND COALESCE(r.eh_repasse_cartao,false)=false AND r.ref_externa_sistema IN ('os','oficina_os')
              AND r.ref_externa_id = o.id::text AND r.forma_pagamento = p_forma_pagamento))
  ), filtrado AS (
    SELECT id FROM base
    WHERE (p_de IS NULL OR data_ref >= p_de) AND (p_ate IS NULL OR data_ref <= p_ate)
  )
  SELECT array_agg(id), count(*) INTO v_ids, v_total FROM filtrado;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'total', 0, 'limit', v_limit, 'offset', v_offset,
      'custo_hora', v_custo_hora, 'linhas', '[]'::jsonb,
      'resumo', jsonb_build_object('venda_liq',0,'compra_total',0,'diferenca',0,'tributos',0,'taxa_cartao',0,'sobra_liq',0,'margem_liq_pct',NULL,'os_incompletas',0));
  END IF;

  -- resumo sobre TODAS as OS filtradas (set-based, uma passada)
  SELECT jsonb_build_object(
    'venda_liq', ROUND(SUM(venda_liq),2), 'compra_total', ROUND(SUM(compra_total),2), 'diferenca', ROUND(SUM(diferenca),2),
    'tributos', ROUND(SUM(tributos),2), 'taxa_cartao', ROUND(SUM(taxa_cartao),2), 'sobra_liq', ROUND(SUM(sobra_liq),2),
    'margem_liq_pct', CASE WHEN SUM(venda_liq)>0 THEN ROUND(SUM(sobra_liq)/SUM(venda_liq)*100,1) ELSE NULL END,
    'os_incompletas', COUNT(*) FILTER (WHERE custo_incompleto))
  INTO v_resumo
  FROM public.fn__oficina_comparativo_calc(p_company_id, v_ids, v_custo_hora,
    v_params.imposto_produtos_pct, v_params.imposto_servicos_pct, v_params.reserva_taxa_cartao_pct, 'auto');

  -- página ordenada por sobra desc
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sobra_liq DESC NULLS LAST) INTO v_linhas FROM (
    SELECT * FROM public.fn__oficina_comparativo_calc(p_company_id, v_ids, v_custo_hora,
      v_params.imposto_produtos_pct, v_params.imposto_servicos_pct, v_params.reserva_taxa_cartao_pct, 'auto')
    ORDER BY sobra_liq DESC NULLS LAST OFFSET v_offset LIMIT v_limit
  ) p;

  RETURN jsonb_build_object('ok', true, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'custo_hora', v_custo_hora, 'custo_hora_origem', v_ch->>'origem',
    'imposto_produtos_pct', v_params.imposto_produtos_pct, 'imposto_servicos_pct', v_params.imposto_servicos_pct,
    'resumo', v_resumo, 'linhas', COALESCE(v_linhas,'[]'::jsonb));
END; $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_comparativo_geral(uuid, date, date, uuid, text, text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comparativo_geral(uuid, date, date, uuid, text, text, uuid, integer, integer) TO authenticated, service_role;

-- ============================ MENU + CATÁLOGO DE TELA ============================
INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, diferencial)
VALUES ('oficina_comparativo', 'Comparativo da OS', 'oficina', '📊', '/dashboard/oficina/comparativo', 24, true,
        '2_svc', ARRAY['oficina']::text[], false, ARRAY[]::text[], 'oficina_operacao', ARRAY[]::text[], false)
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, icone=EXCLUDED.icone,
  rota=EXCLUDED.rota, ordem=EXCLUDED.ordem, ativo=true, layer=EXCLUDED.layer, subgrupo=EXCLUDED.subgrupo,
  vertical_specific=EXCLUDED.vertical_specific;

INSERT INTO public.system_screens
  (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
   rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('oficina_comparativo', '/dashboard/oficina/comparativo', 'oficina', 'oficina_comparativo', 'Comparativo da OS',
  'Rentabilidade por OS e visão geral: compra, venda, diferença, tributos (produtos e serviços), taxa de cartão (real do repasse ou estimada) e sobra líquida (valor e %). Só leitura; dado sensível só para dono/Master/gestor.',
  'pronto', 'media',
  ARRAY['fn_oficina_comparativo_os','fn_oficina_comparativo_geral','fn_oficina_comparativo_params_get','fn_oficina_comparativo_params_salvar','fn_os_mao_obra_manual_salvar','fn_os_mao_obra_manual_excluir']::text[],
  ARRAY['ComparativoOSPage']::text[],
  ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET rota=EXCLUDED.rota, area=EXCLUDED.area, modulo=EXCLUDED.modulo, titulo=EXCLUDED.titulo,
  descricao_funcional=EXCLUDED.descricao_funcional, estado_real=EXCLUDED.estado_real,
  prioridade_monitoramento=EXCLUDED.prioridade_monitoramento, rpcs_chamadas=EXCLUDED.rpcs_chamadas,
  componentes_principais=EXCLUDED.componentes_principais, features_relacionadas=EXCLUDED.features_relacionadas, atualizado_em=now();

-- ============================ AJUDA "?" RD-95 (todos os campos, filtros, colunas, indicadores, ações) ============================
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Comparativo da OS', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/oficina/comparativo', 'oficina', 'publicado'
FROM (VALUES
 ('oficina.comparativo.busca_os','Buscar OS','Número da OS ou parte dele.','Abre a análise detalhada daquela ordem de serviço.','"0401" ou "OS-2026-0401".','Digitar o ano todo não é preciso — o número basta.',1),
 ('oficina.comparativo.modo_mao_obra','Mão de obra','Como contar o tempo de serviço: Pátio (apontamento), Manual (você digita) ou Em branco (sem custo).','Define o custo de mão de obra que entra na Compra da OS.','Pátio quando há cronômetro; Manual quando você sabe as horas; Em branco para serviço próprio sem custo.','Deixar em "Pátio" sem apontamento zera a mão de obra — use Manual para informar.',2),
 ('oficina.comparativo.mo_horas_manual','Horas de serviço (manual)','As horas gastas no serviço desta OS.','Multiplicadas pelo custo-hora da empresa, viram o custo de mão de obra.','1,5 (uma hora e meia).','Informar minutos — use horas com vírgula (0,5 = 30 min).',3),
 ('oficina.comparativo.filtro_periodo','Período','As datas de início e fim (pela entrega da OS).','Limita a análise geral ao intervalo escolhido.','01/11/2026 a 30/11/2026.','Fim antes do início — a busca não roda.',4),
 ('oficina.comparativo.filtro_cliente','Cliente','O cliente para filtrar as OS.','Mostra só as OS daquele cliente.','"Mecânica do João".','—',5),
 ('oficina.comparativo.filtro_status','Status da OS','A situação da OS (entregue, em execução, etc.).','Separa, por exemplo, só as já entregues.','Entregue.','—',6),
 ('oficina.comparativo.filtro_forma_pagamento','Forma de pagamento','Como a OS foi paga (PIX, cartão, boleto…).','Isola as OS pagas no cartão para conferir a taxa.','cartao_credito.','—',7),
 ('oficina.comparativo.filtro_mecanico','Mecânico','O mecânico que apontou serviço na OS.','Mostra as OS em que aquele mecânico trabalhou.','"Carlos".','—',8),
 ('oficina.comparativo.col_compra','Compra','Custo total da OS: peças + custos de terceiros + mão de obra.','É quanto a OS custou para a oficina.','R$ 519,20.','Custo de peça em branco infla a margem — veja "custo incompleto".',9),
 ('oficina.comparativo.col_venda','Venda','Valor cobrado do cliente (peças + serviços aprovados, menos desconto).','É a receita da OS.','R$ 1.594,00.','—',10),
 ('oficina.comparativo.col_diferenca','Diferença','Venda menos Compra (antes de tributos e taxa de cartão).','Quanto sobrou antes dos descontos de imposto e cartão.','R$ 1.074,80.','Confundir com a sobra líquida (que já tira tributos e taxa).',11),
 ('oficina.comparativo.col_pct_planilha','% (planilha)','Diferença dividida pela média entre Compra e Venda.','Confere a porcentagem aplicada sobre o custo da peça, igual à planilha.','53,5%.','—',12),
 ('oficina.comparativo.col_pct_previsto','% previsto','Margem prevista para a peça (matriz ou margem-alvo dos parâmetros).','Mostra se a peça saiu abaixo, dentro ou acima do previsto.','40%.','—',13),
 ('oficina.comparativo.ind_tributos','Tributos','Venda de peças × imposto de produtos + venda de serviços × imposto de serviços.','Desconta os impostos da sobra.','R$ 159,40.','Alíquota não configurada aparece como "incompleto" — ajuste nos parâmetros.',14),
 ('oficina.comparativo.ind_taxa_cartao','Taxa de cartão','A taxa do repasse do cartão (real) ou uma estimativa quando o repasse ainda não chegou.','Desconta o custo do cartão da sobra, sem aplicar sobre a venda inteira.','R$ 62,01 (real).','—',15),
 ('oficina.comparativo.ind_sobra_liquida','Sobra líquida','Diferença menos Tributos menos Taxa de cartão (valor e % sobre a venda).','É o que realmente sobrou da OS.','R$ 853,39 (53,5%).','—',16),
 ('oficina.comparativo.param_imposto_produtos','Imposto de produtos (%)','A alíquota de tributos sobre a venda de peças.','Entra no cálculo dos tributos das peças.','10.','Deixar em branco deixa os tributos de peças incompletos.',17),
 ('oficina.comparativo.param_imposto_servicos','Imposto de serviços (%)','A alíquota de tributos sobre a venda de serviços/mão de obra.','Entra no cálculo dos tributos dos serviços.','5.','Deixar em branco deixa os tributos de serviços incompletos.',18),
 ('oficina.comparativo.param_reserva_taxa','Reserva de taxa de cartão (%)','Percentual usado para estimar a taxa quando o repasse ainda não foi registrado.','Dá uma taxa aproximada até o repasse real chegar.','2,5.','—',19),
 ('oficina.comparativo.param_custo_hora','Custo-hora','Valor da hora de mão de obra da oficina (manual sobrepõe o calculado).','Multiplica as horas de serviço para achar o custo de mão de obra.','R$ 60,00.','Sem custo-hora, a mão de obra fica sem custo.',20),
 ('oficina.comparativo.exportar','Exportar','Baixa a análise atual em Excel ou PDF.','Leva os números para fora do sistema.','—','—',21)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
