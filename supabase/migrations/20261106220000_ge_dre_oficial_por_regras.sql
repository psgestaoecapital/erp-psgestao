-- GE · DRE oficial (DRE Consolidado "Por linha de negócio", DRE Divisional, rateio) passa a usar as REGRAS DE RATEIO
-- (CEO 06/11/2026 — atendimento da fazenda: "precisamos garantir que o sistema esteja calculando corretamente").
--
-- Problema: o recálculo do DRE (fn_psgc_recalcular_dre_mes) grava a despesa direta SEM negócio e a receita TODA na 1ª
-- linha ativa — ignora o centro de custo, a linha de negócio da receita e as regras por conta/texto (#4001). A tela
-- "DRE Consolidado › Por linha de negócio" mostrava "Geral" com a receita inteira e a despesa toda em "Comum".
--
-- Correção ADITIVA, sem reescrever o recálculo existente:
--   * fn_ge_dre_aplicar_regras_mes(empresa, ano, mes): depois do recálculo, refaz SÓ as linhas de pagar/receber
--     direto e caixa do mês (fontes etl_pagar_direto, etl_receber_direto, etl_pagar_caixa, etl_receber_caixa), agora
--     com o negócio de cada lançamento pela mesma ordem da tela Resultado por negócio:
--       linha de negócio da receita > centro de custo > texto > conta (a mais específica) > sem regra.
--     Despesa sem regra fica sem negócio (o motor de rateio distribui); receita sem regra fica sem negócio ("Comum").
--   * TRAVA DE CONFERÊNCIA: a conta de cada fonte é refeita lançamento a lançamento com o MESMO de-para do recálculo;
--     se o total por conta do DRE não bater com o que já estava gravado (diferença > R$ 0,05), aquela fonte NÃO é
--     tocada (fica como estava) e o motivo volta no resultado. Nunca muda o total do DRE, só a coluna do negócio.
--   * Só age em empresa que TEM regra por conta ou por texto ativa (opt-in implícito). As demais: nada muda (RD-97).
--   * Ganchos: (1) ao concluir um job de recálculo do DRE na fila, aplica as regras ao mês (reprocessar_empresa: aos 12
--     meses); erro aqui vira aviso e nunca derruba a fila; (2) ao gravar/alterar/tirar regra ou centro, enfileira o
--     recálculo dos meses que a empresa já tem no DRE (últimos 36), para a tela oficial acompanhar a regra.

-- 1) o negócio de cada lançamento do mês, por fonte do DRE (interno)
CREATE OR REPLACE FUNCTION public.fn_ge_dre_lancamentos_negocio(p_company_id uuid, p_ini date, p_fim date)
RETURNS TABLE (fonte text, lanc_id uuid, categoria text, valor numeric, bl_id uuid, pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
WITH bl AS (
  SELECT b.id, b.name FROM public.business_lines b WHERE b.company_id = p_company_id AND b.is_active
),
lanc AS (
  SELECT 'etl_pagar_direto'::text AS fonte, 'pagar'::text AS origem, p.id, p.categoria::text AS categoria, p.valor::numeric AS valor,
         p.centro_custo::text AS centro, NULL::text AS ln_txt,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,'')) AS texto
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND coalesce(p.data_competencia, p.data_emissao) BETWEEN p_ini AND p_fim
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
  UNION ALL
  SELECT 'etl_pagar_caixa', 'pagar', p.id, p.categoria::text, p.valor::numeric, p.centro_custo::text, NULL,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,''))
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND p.data_pagamento BETWEEN p_ini AND p_fim
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
  UNION ALL
  SELECT 'etl_receber_direto', 'receber', r.id, r.categoria::text, r.valor::numeric, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,''))
  FROM public.erp_receber r
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND NOT coalesce(r.eh_repasse_cartao, false)
    AND coalesce(r.data_competencia, r.data_emissao)::date BETWEEN p_ini AND p_fim
    AND (r.status IS NULL OR r.status <> 'cancelado')
  UNION ALL
  SELECT 'etl_receber_caixa', 'receber', r.id, r.categoria::text, r.valor::numeric, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,''))
  FROM public.erp_receber r
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND coalesce(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
    AND r.data_pagamento::date BETWEEN p_ini AND p_fim
    AND (r.status IS NULL OR r.status <> 'cancelado')
),
regras AS (
  SELECT m.source_type, lower(trim(m.source_key)) AS chave, m.business_line_id,
         coalesce(m.allocation_pct, 100) / 100.0 AS pct, coalesce(m.tipo_apropriacao, 'direto') AS tp
  FROM public.cost_center_map m
  WHERE m.company_id = p_company_id AND m.ativo AND m.source_type IN ('centro_custo','texto','conta')
),
cand AS (
  SELECT l.fonte, l.id, b.id AS bl_id, 1.0::numeric AS pct, 1 AS nivel, 0 AS len
  FROM lanc l JOIN bl b ON l.ln_txt IS NOT NULL AND lower(trim(b.name)) = lower(l.ln_txt)
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 2, 0
  FROM lanc l JOIN regras g ON g.source_type = 'centro_custo' AND l.centro IS NOT NULL AND g.chave = lower(trim(l.centro))
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 3, length(g.chave)
  FROM lanc l JOIN regras g ON g.source_type = 'texto' AND g.chave <> '' AND position(g.chave IN l.texto) > 0
  UNION ALL
  SELECT l.fonte, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 4, length(g.chave)
  FROM lanc l JOIN regras g ON g.source_type = 'conta' AND l.categoria IS NOT NULL
                          AND (lower(l.categoria) = g.chave OR lower(l.categoria) LIKE g.chave || '.%')
),
melhor AS (
  SELECT DISTINCT ON (fonte, id, nivel) fonte, id, nivel, len FROM cand ORDER BY fonte, id, nivel, len DESC
),
venc AS (
  SELECT DISTINCT ON (fonte, id) fonte, id, nivel, len FROM melhor ORDER BY fonte, id, nivel
),
reparte AS (
  SELECT c.fonte, c.id, c.bl_id, c.pct
  FROM cand c JOIN venc w ON w.fonte = c.fonte AND w.id = c.id AND w.nivel = c.nivel AND w.len = c.len
),
reparte_total AS (
  SELECT r.fonte, r.id, r.bl_id, r.pct FROM reparte r
  UNION ALL
  SELECT l.fonte, l.id, NULL::uuid, 1 - coalesce(s.soma, 0)
  FROM lanc l LEFT JOIN (SELECT fonte, id, sum(pct) AS soma FROM reparte GROUP BY fonte, id) s ON s.fonte = l.fonte AND s.id = l.id
  WHERE coalesce(s.soma, 0) < 0.9999
)
SELECT l.fonte, l.id, l.categoria, l.valor, t.bl_id, t.pct
FROM lanc l JOIN reparte_total t ON t.fonte = l.fonte AND t.id = l.id;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_dre_lancamentos_negocio(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 2) aplica as regras ao DRE do mês (interno; chamado pelos ganchos e pela carga inicial)
CREATE OR REPLACE FUNCTION public.fn_ge_dre_aplicar_regras_mes(p_company_id uuid, p_ano integer, p_mes integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_fonte text;
  v_regime text;
  v_dif numeric;
  v_res jsonb := '{}'::jsonb;
BEGIN
  -- guarda da empresa: com usuário logado, só a empresa dele; no worker da fila (serviço, sem usuário) passa
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.cost_center_map
                 WHERE company_id = p_company_id AND ativo AND source_type IN ('conta','texto')) THEN
    RETURN jsonb_build_object('status', 'sem_regras');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _ge_dre_novo (fonte text, psgc_codigo text, ln_id uuid, valor numeric, qtd integer) ON COMMIT DROP;
  TRUNCATE _ge_dre_novo;

  -- a conta do DRE de cada lançamento: o MESMO de-para do recálculo (pagar: neutro/destinação > operacional > herdado >
  -- tipo da conta; receber: o de-para de maior confiança, senão 1.4)
  INSERT INTO _ge_dre_novo (fonte, psgc_codigo, ln_id, valor, qtd)
  WITH l AS (SELECT * FROM public.fn_ge_dre_lancamentos_negocio(p_company_id, v_ini, v_fim)),
  her AS (SELECT * FROM public.fn_psgc_depara_herdado(p_company_id)),
  cat_pagar AS (
    SELECT c.categoria,
      coalesce(
        (SELECT pd.psgc_codigo FROM public.psgc_depara pd JOIN public.psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
          WHERE pd.company_id = p_company_id AND pd.origem_codigo = c.categoria AND pd.ativo AND pcx.dre_grupo IN ('NEUTRO','DESTINACAO')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1),
        (SELECT pd.psgc_codigo FROM public.psgc_depara pd JOIN public.psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
          WHERE pd.company_id = p_company_id AND pd.origem_codigo = c.categoria AND pd.ativo
            AND pcx.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP','NEUTRO','DESTINACAO')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1),
        (SELECT h.psgc_codigo FROM her h WHERE h.origem_codigo = c.categoria LIMIT 1),
        CASE WHEN epc.tipo = 'investimento' THEN coalesce(
               (SELECT pd.psgc_codigo FROM public.psgc_depara pd JOIN public.psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
                 WHERE pd.company_id = p_company_id AND pd.origem_codigo = c.categoria AND pd.ativo AND pcx.dre_grupo = 'NAO_OPER'
                 ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1), '9.3')
             WHEN epc.tipo = 'custo' THEN '4.1' ELSE '6.11' END
      ) AS psgc_codigo
    FROM (SELECT DISTINCT categoria FROM l WHERE fonte LIKE 'etl_pagar%') c
    LEFT JOIN public.erp_plano_contas epc ON epc.company_id = p_company_id AND epc.codigo = c.categoria
  ),
  cat_receber AS (
    SELECT c.categoria,
      coalesce((SELECT pd.psgc_codigo FROM public.psgc_depara pd JOIN public.psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
                 WHERE pd.company_id = p_company_id AND pd.origem_codigo = c.categoria AND pd.ativo
                 ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1), '1.4') AS psgc_codigo
    FROM (SELECT DISTINCT categoria FROM l WHERE fonte LIKE 'etl_receber%') c
  )
  SELECT l.fonte, coalesce(cp.psgc_codigo, cr.psgc_codigo), l.bl_id, sum(l.valor * l.pct), count(*)::integer
  FROM l
  LEFT JOIN cat_pagar cp ON l.fonte LIKE 'etl_pagar%' AND cp.categoria IS NOT DISTINCT FROM l.categoria
  LEFT JOIN cat_receber cr ON l.fonte LIKE 'etl_receber%' AND cr.categoria IS NOT DISTINCT FROM l.categoria
  GROUP BY l.fonte, coalesce(cp.psgc_codigo, cr.psgc_codigo), l.bl_id;

  FOREACH v_fonte IN ARRAY ARRAY['etl_pagar_direto','etl_receber_direto','etl_pagar_caixa','etl_receber_caixa'] LOOP
    v_regime := CASE WHEN v_fonte LIKE '%caixa' THEN 'caixa' ELSE 'competencia' END;
    IF NOT EXISTS (SELECT 1 FROM public.psgc_dre d WHERE d.company_id = p_company_id AND d.ano = p_ano AND d.mes = p_mes AND d.source = v_fonte) THEN
      v_res := v_res || jsonb_build_object(v_fonte, 'ausente');
      CONTINUE;
    END IF;

    -- trava de conferência: mesma conta, mesmo total (a regra só muda a coluna do negócio)
    SELECT coalesce(max(abs(coalesce(a.v, 0) - coalesce(b.v, 0))), 0) INTO v_dif
    FROM (SELECT d.psgc_codigo, sum(d.valor) AS v FROM public.psgc_dre d
           WHERE d.company_id = p_company_id AND d.ano = p_ano AND d.mes = p_mes AND d.source = v_fonte GROUP BY d.psgc_codigo) a
    FULL JOIN (SELECT n.psgc_codigo, sum(n.valor) AS v FROM _ge_dre_novo n WHERE n.fonte = v_fonte GROUP BY n.psgc_codigo) b
      ON b.psgc_codigo = a.psgc_codigo;
    IF v_dif > 0.05 THEN
      v_res := v_res || jsonb_build_object(v_fonte, 'divergente: ' || round(v_dif, 2) || ' — mantido como estava');
      CONTINUE;
    END IF;

    DELETE FROM public.psgc_dre d WHERE d.company_id = p_company_id AND d.ano = p_ano AND d.mes = p_mes AND d.source = v_fonte;
    INSERT INTO public.psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, n.ln_id, b.name, n.psgc_codigo, round(sum(n.valor), 2), sum(n.qtd)::integer, v_fonte, v_regime
    FROM _ge_dre_novo n LEFT JOIN public.business_lines b ON b.id = n.ln_id
    WHERE n.fonte = v_fonte
    GROUP BY n.ln_id, b.name, n.psgc_codigo
    HAVING sum(n.qtd) > 0;
    v_res := v_res || jsonb_build_object(v_fonte, 'aplicado');
  END LOOP;

  -- o rateio do comum (motor oficial) acompanha a nova divisão
  PERFORM public.fn_rateio_calcular_mes(p_company_id, p_ano, p_mes);
  RETURN jsonb_build_object('status', 'ok', 'ano', p_ano, 'mes', p_mes, 'fontes', v_res);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_dre_aplicar_regras_mes(uuid, integer, integer) FROM PUBLIC, anon, authenticated;

-- 3) gancho na fila do DRE: job de recálculo concluído → aplica as regras (nunca derruba a fila)
CREATE OR REPLACE FUNCTION public.fn_ge_trg_dre_job_aplicar_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  i integer;
  v_d date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cost_center_map
                 WHERE company_id = NEW.company_id AND ativo AND source_type IN ('conta','texto')) THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF NEW.tipo = 'recalcular_dre_mes' AND NEW.ano IS NOT NULL AND NEW.mes IS NOT NULL THEN
      PERFORM public.fn_ge_dre_aplicar_regras_mes(NEW.company_id, NEW.ano, NEW.mes);
    ELSIF NEW.tipo = 'reprocessar_empresa' THEN
      FOR i IN 0..11 LOOP
        v_d := (CURRENT_DATE - (i || ' month')::interval)::date;
        PERFORM public.fn_ge_dre_aplicar_regras_mes(NEW.company_id, EXTRACT(YEAR FROM v_d)::int, EXTRACT(MONTH FROM v_d)::int);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_ge_dre_aplicar_regras_mes falhou (empresa %, %/%): %', NEW.company_id, NEW.mes, NEW.ano, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_trg_dre_job_aplicar_regras() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ge_dre_job_aplicar_regras ON public.psgc_job_queue;
CREATE TRIGGER trg_ge_dre_job_aplicar_regras
  AFTER UPDATE OF status ON public.psgc_job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' AND NEW.tipo IN ('recalcular_dre_mes','reprocessar_empresa'))
  EXECUTE FUNCTION public.fn_ge_trg_dre_job_aplicar_regras();

-- 4) gancho nas regras: gravou/alterou/tirou regra ou centro → enfileira o recálculo dos meses que a empresa tem no DRE
CREATE OR REPLACE FUNCTION public.fn_ge_trg_regra_enfileirar_dre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_company uuid := coalesce(NEW.company_id, OLD.company_id);
  v_tipo text := coalesce(NEW.source_type, OLD.source_type);
  r record;
BEGIN
  IF v_tipo NOT IN ('conta','texto','centro_custo') THEN RETURN NULL; END IF;
  -- empresa sem regra por conta/texto (nem a que acabou de sair) não usa este caminho
  IF v_tipo = 'centro_custo' AND NOT EXISTS (SELECT 1 FROM public.cost_center_map
       WHERE company_id = v_company AND ativo AND source_type IN ('conta','texto')) THEN
    RETURN NULL;
  END IF;
  BEGIN
    FOR r IN SELECT DISTINCT d.ano, d.mes FROM public.psgc_dre d
             WHERE d.company_id = v_company AND make_date(d.ano, d.mes, 1) >= (date_trunc('month', CURRENT_DATE) - interval '36 months')
    LOOP
      PERFORM public.fn_psgc_enfileirar(v_company, 'recalcular_dre_mes', r.ano, r.mes, 3, 'regra_rateio', NULL::text, NULL::jsonb);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enfileirar recálculo do DRE após regra falhou (empresa %): %', v_company, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_trg_regra_enfileirar_dre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ge_regra_enfileirar_dre ON public.cost_center_map;
CREATE TRIGGER trg_ge_regra_enfileirar_dre
  AFTER INSERT OR UPDATE OR DELETE ON public.cost_center_map
  FOR EACH ROW EXECUTE FUNCTION public.fn_ge_trg_regra_enfileirar_dre();

-- 5) carga inicial: empresas que já têm regra → enfileira o recálculo dos meses que têm no DRE (o worker processa e o
--    gancho da fila aplica as regras). Nada roda para empresa sem regra.
SELECT public.fn_psgc_enfileirar(x.company_id, 'recalcular_dre_mes', x.ano, x.mes, 2, 'regra_rateio_carga', NULL::text, NULL::jsonb)
FROM (SELECT DISTINCT d.company_id, d.ano, d.mes FROM public.psgc_dre d
      WHERE make_date(d.ano, d.mes, 1) >= (date_trunc('month', CURRENT_DATE) - interval '36 months')
        AND EXISTS (SELECT 1 FROM public.cost_center_map m WHERE m.company_id = d.company_id AND m.ativo AND m.source_type IN ('conta','texto'))) x;
