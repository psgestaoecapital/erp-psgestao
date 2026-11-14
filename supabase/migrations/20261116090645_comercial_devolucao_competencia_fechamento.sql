-- Faturamento líquido — devolução casada pela COMPETÊNCIA do fechamento (EMERGÊNCIA CEO 12/11, caixa d31f1966).
--
-- PROBLEMA (prova RD-38 no dado da Frioeste, 975365cc): o painel abate as devoluções pela DATA_MOVTO (data de
-- lançamento). Há 45 devoluções T582 lançadas em NOV/2026 (R$ 224.118,52, todas nos dias 03–10) que se referem ao
-- fechamento de OUT/2026 e hoje não entram no líquido de outubro — aproximando o líquido do relatório de mercado.
--
-- NÃO EXISTE referência à nota de origem no raw (auditado, RD-38): `CHAVE_FATO_ORIG_UN` está VAZIA em todas as 45 e
-- `DATA_V1`/`DATA_V2` vêm no mesmo mês da DATA_MOVTO (= novembro), então NÃO dá para "casar pela data da venda
-- original". Resta a regra de COMPETÊNCIA configurável que o Eng. Chefe autorizou como fallback: a devolução
-- considerada no fechamento de um mês = as lançadas DENTRO do mês + as lançadas no INÍCIO do mês seguinte referentes
-- a este (até o dia X, padrão 10 — captura as 45). Semântica exatamente como pede o "?" do card:
-- "devolução considerada: lançadas no mês + do mês seguinte referentes a este".
--
-- Aditiva (RD-97): só adiciona a tabela de config e troca a JANELA da devolução dentro de fn_bi_comercial_kpis
-- (SÓ LEITURA do BI; nenhum dado de cliente alterado). REVOKE/GRANT no arquivo (RD-52). Faixa 45 (desenvolvedor_5_g).

-- ── Config por empresa: dias do mês seguinte que entram no fechamento do mês anterior. ───────────────────────────
-- Ausência de linha = padrão 10 dias, ativo. ativo=false desliga a regra (volta ao comportamento por DATA_MOVTO puro).
CREATE TABLE IF NOT EXISTS public.com_fechamento_devolucao_cfg (
  company_id        uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  dias_mes_seguinte int NOT NULL DEFAULT 10 CHECK (dias_mes_seguinte BETWEEN 0 AND 28),
  ativo             boolean NOT NULL DEFAULT true,
  motivo            text,
  atualizado_por    uuid,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.com_fechamento_devolucao_cfg IS 'Comercial: quantos dias do início do mês seguinte contam como devolução do fechamento do mês anterior (faturamento líquido). Sem linha = 10 dias, ativo. Só config; nunca altera dado de cliente nem o ATAK.';

ALTER TABLE public.com_fechamento_devolucao_cfg ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.com_fechamento_devolucao_cfg FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS com_fechamento_devolucao_cfg_sel ON public.com_fechamento_devolucao_cfg;
CREATE POLICY com_fechamento_devolucao_cfg_sel ON public.com_fechamento_devolucao_cfg FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.com_fechamento_devolucao_cfg TO authenticated;
GRANT ALL ON public.com_fechamento_devolucao_cfg TO service_role;

-- ── fn_bi_comercial_kpis: devolução pela competência do fechamento (único trecho alterado: a JANELA da devolução). ─
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_vend text; r RECORD;
  v_tipos_dev  text[];
  v_tipos_desc text[];
  v_dev_grace_dias int;              -- NOVO: dias do mês seguinte que entram no fechamento deste mês (config; padrão 10)
  v_dev_valor  numeric := 0;
  v_dev_kg     numeric := 0;
  v_dev_tipos  jsonb   := '[]'::jsonb;
  v_desc_valor numeric := 0;
  v_desc_kg    numeric := 0;
  v_desc_linhas int    := 0;
  v_desc_prod  jsonb   := '[]'::jsonb;
  v_desc_vend  jsonb   := '[]'::jsonb;
  v_desc_linha jsonb   := '[]'::jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;

  -- Venda (BRUTO) — fonte e filtros inalterados.
  SELECT COALESCE(SUM(m.kg), 0) AS volume_kg,
         COALESCE(SUM(m.valor), 0) AS faturamento,
         COUNT(DISTINCT m.cliente_cod) AS clientes,
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE m.carne), 0) AS faturamento_sem_despojo,
         COALESCE(SUM(m.kg) FILTER (WHERE m.carne), 0) AS volume_kg_sem_despojo
    INTO r
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend);

  -- Tipos configurados (por empresa com fallback global).
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_desc
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'descarte');

  -- NOVO: dias de competência do mês seguinte (config por empresa; sem linha = 10; ativo=false desliga).
  SELECT CASE WHEN cfg.ativo THEN cfg.dias_mes_seguinte ELSE 0 END
    INTO v_dev_grace_dias
    FROM public.com_fechamento_devolucao_cfg cfg
   WHERE cfg.company_id = p_company_id;
  IF NOT FOUND THEN v_dev_grace_dias := 10; END IF;

  -- DEVOLUÇÕES que abatem (domínio comercial_devolucao). Mesmos filtros do BI + MESMO escopo de vendedor:
  -- STATUS<>'C', valor = VALOR_LIQUIDO_ITEM, kg = QTDE_PRI quando KG. JANELA = COMPETÊNCIA do fechamento:
  -- lançadas DENTRO do período + as lançadas no início do mês seguinte ao fim do período (até o dia v_dev_grace_dias),
  -- que se referem a este fechamento (a devolução que chega poucos dias depois entra no mês certo).
  IF v_tipos_dev IS NOT NULL AND cardinality(v_tipos_dev) > 0 THEN
    WITH d AS (
      SELECT f.raw->>'COD_TIPO_MV' AS cod,
             (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric AS valor,
             CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG'
                  THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END AS kg
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend)
        AND (
          -- lançadas dentro do período
          ( left(f.raw->>'DATA_MOVTO', 10) >= to_char(p_dt_ini, 'YYYY-MM-DD')
            AND left(f.raw->>'DATA_MOVTO', 10) <= to_char(p_dt_fim, 'YYYY-MM-DD') )
          OR
          -- lançadas no início do mês SEGUINTE ao fim do período, referentes a este fechamento
          ( v_dev_grace_dias > 0
            AND (left(f.raw->>'DATA_MOVTO', 10))::date > p_dt_fim
            AND date_trunc('month', (left(f.raw->>'DATA_MOVTO', 10))::date)
                = date_trunc('month', (p_dt_fim + 1))
            AND extract(day FROM (left(f.raw->>'DATA_MOVTO', 10))::date) <= v_dev_grace_dias )
        )
    )
    SELECT round(COALESCE(sum(valor), 0), 2),
           round(COALESCE(sum(kg), 0), 3),
           COALESCE(jsonb_agg(jsonb_build_object('cod', cod, 'valor', valor, 'kg', kg) ORDER BY cod), '[]'::jsonb)
      INTO v_dev_valor, v_dev_kg, v_dev_tipos
      FROM (SELECT cod, round(sum(valor), 2) valor, round(sum(kg), 3) kg FROM d GROUP BY cod) z;
  END IF;

  -- DESCARTE / PERDA (indicador separado — NÃO abate do faturamento). Hoje T131 ainda não vem.
  IF v_tipos_desc IS NOT NULL AND cardinality(v_tipos_desc) > 0 THEN
    SELECT COALESCE(round(sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric), 2), 0),
           COALESCE(round(sum(CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END), 3), 0),
           count(*)
      INTO v_desc_valor, v_desc_kg, v_desc_linhas
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend);

    IF v_desc_linhas > 0 THEN
      -- quebras por produto / vendedor / linha (só quando houver descarte coletado)
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_prod FROM (
        SELECT jsonb_build_object('produto', produto, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_PRODUTO_NF'),60) produto,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY produto ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_vend FROM (
        SELECT jsonb_build_object('vendedor', vendedor_nome, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT COALESCE(NULLIF(left(trim(f.raw->>'NOME_COMP'),60),''),'s/v') vendedor_nome,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY vendedor_nome ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_linha FROM (
        SELECT jsonb_build_object('linha', linha, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_DIVISAO'),60) linha,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY linha ) q;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'faturamento_sem_despojo', r.faturamento_sem_despojo,
    'volume_kg_sem_despojo', r.volume_kg_sem_despojo,
    'ticket_kg_sem_despojo', ROUND(r.faturamento_sem_despojo / NULLIF(r.volume_kg_sem_despojo, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_aceite',
    -- faturamento líquido + descarte. O card "Faturamento total" segue sendo o BRUTO (r.faturamento).
    'devolucoes_valor',    v_dev_valor,
    'devolucoes_kg',       v_dev_kg,
    'devolucoes_por_tipo', v_dev_tipos,
    'devolucoes_competencia_dias', v_dev_grace_dias,   -- NOVO: transparência da regra de competência aplicada
    'tipos_devolucao',     COALESCE(to_jsonb(v_tipos_dev), '[]'::jsonb),
    'faturamento_liquido', round(COALESCE(r.faturamento, 0) - v_dev_valor, 2),
    'volume_kg_liquido',   round(COALESCE(r.volume_kg, 0) - v_dev_kg, 3),
    'descarte', jsonb_build_object(
       'status',       CASE WHEN v_desc_linhas > 0 THEN 'ok' ELSE 'aguardando_integracao' END,
       'tipos',        COALESCE(to_jsonb(v_tipos_desc), '[]'::jsonb),
       'total_valor',  v_desc_valor,
       'total_kg',     v_desc_kg,
       'por_produto',  v_desc_prod,
       'por_vendedor', v_desc_vend,
       'por_linha',    v_desc_linha));
END
$function$;

-- ── Ajuda RD-95: deixar explícito no "?" do card a regra de competência da devolução. ────────────────────────────
UPDATE public.erp_ajuda_campo
   SET para_que_serve = 'É o faturamento bruto menos as devoluções reais (tipos T582 e T583) do período. É o número que bate com o relatório do seu sistema de origem — o que de fato entrou, depois de tirar o que voltou. A devolução considerada é a lançada no mês + a do início do mês seguinte referente a este (até o dia 10, configurável por empresa), para que a devolução que chega poucos dias depois entre no fechamento do mês certo. O card "Faturamento" ao lado continua mostrando o bruto (antes das devoluções).',
       atualizado_em = now()
 WHERE chave = 'com.painel.faturado_liquido';
