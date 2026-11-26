-- PDCA GE · /dashboard/financeiro/conciliacao/inbox (auditor_pdca_2 · RD-38) — NÚCLEO financeiro.
-- Gap provado: a sugestão de conciliação rotulava "perfeito" (categoria) e "exato" (qualidade) mesmo quando o VALOR
-- do movimento diferia materialmente do título (ex.: movimento R$ 750 × título R$ 1.000 → score 115 só por
-- data+documento+forma, categoria "perfeito", qualidade "exato"). Como fn_conciliacao_rodar_lote AUTO-CONCILIA quando a
-- qualidade é "exato", o selo falso virava baixa de dinheiro errado.
--
-- Correção (aditiva, sem tocar dado de cliente): o rótulo "perfeito"/"exato" passa a EXIGIR que o valor case —
-- pontos_de_valor > 0 (a mesma régua de pontuação já existente: |valor_ref - mvalor| <= R$ 10 OU < 5%). Valor
-- divergente sem explicação é rebaixado para "quase"/"revisar", mesmo com score >= 90.
-- NÃO regride o parcial legítimo: o array `vals` do título já inclui o saldo após pagamento parcial e as baixas não
-- conciliadas, então valor_ref casa com o movimento nesses casos e pontos_de_valor > 0 (continua "exato").
--
-- Mudança 1: fn_conciliacao_sugerir_match_lote expõe nova coluna match_valor_ok (pontos_de_valor > 0) e só rotula
--            "perfeito" quando ela é verdadeira.
-- Mudança 2: fn_conciliacao_sugerir_match (wrapper) repassa match_valor_ok.
-- Mudança 3: fn_conciliacao_qualidade ganha p_valor_ok (DEFAULT true) e só devolve "exato" quando o valor casa.
-- Mudança 4/5: fn_conciliacao_inbox e fn_conciliacao_rodar_lote passam o novo sinal à qualidade.

-- ============================================================================================================
-- 1) fn_conciliacao_sugerir_match_lote — nova coluna match_valor_ok + "perfeito" exige valor casando
-- ============================================================================================================
DROP FUNCTION IF EXISTS public.fn_conciliacao_sugerir_match(uuid, integer);
DROP FUNCTION IF EXISTS public.fn_conciliacao_sugerir_match_lote(uuid[], integer);

CREATE FUNCTION public.fn_conciliacao_sugerir_match_lote(p_movimento_ids uuid[], p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(movimento_id uuid, lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text, match_valor_ok boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH mv0 AS (
    SELECT m.id, m.company_id, m.valor, m.data_transacao, m.natureza, m.descricao_normalizada,
      regexp_replace(COALESCE((regexp_match(m.descricao,'(\d{14}|\d{11})'))[1],''),'\D','','g') AS doc0,
      CASE
        WHEN m.descricao ~* 'pix' THEN 'pix'
        WHEN m.descricao ~* 'boleto|cobran|liquidac|liquidaç|t[ií]tulo|\mtit\M' THEN 'boleto'
        WHEN m.descricao ~* '\mted\M|\mdoc\M|transfer' THEN 'ted'
        ELSE NULL END AS forma
    FROM public.conciliacao_movimento m
    WHERE m.id = ANY (p_movimento_ids)
  ), mv AS (
    SELECT mv0.*, CASE WHEN length(mv0.doc0) IN (11,14) THEN mv0.doc0 END AS doc FROM mv0
  ), mv_dia AS MATERIALIZED (
    -- cada movimento com os 31 vencimentos da janela de ±15 dias: o par sai por IGUALDADE de data (junção por hash)
    SELECT mv.*, d.dia, mv.data_transacao + d.dia AS venc_alvo,
      CASE mv.natureza WHEN 'debito' THEN 'erp_pagar' WHEN 'credito' THEN 'erp_receber' END AS tabela
    FROM mv CROSS JOIN generate_series(-15, 15) AS d(dia)
  ), faixa AS (
    SELECT company_id, natureza, min(data_transacao) - 15 AS dmin, max(data_transacao) + 15 AS dmax,
      bool_or(doc IS NOT NULL) AS tem_doc
    FROM mv GROUP BY 1, 2
  ),
  -- cada título preparado UMA vez: texto normalizado, documento do favorecido e os valores possíveis (valor, saldo após
  -- pagamento parcial, baixas não conciliadas — a mesma régua de fn_pagar/receber_valor_referencia, inline)
  tp AS MATERIALIZED (
    SELECT 'erp_pagar'::text tabela, p.id, p.company_id, p.data_vencimento::date venc, p.valor::numeric valor,
      COALESCE(p.descricao,p.fornecedor_nome,'')::text desc_lanc, p.fornecedor_nome::text contrap, p.status::text status_lanc,
      lower(COALESCE(p.forma_pagamento,'')) forma_pg, false AS tem_boleto,
      CASE WHEN fx.tem_doc THEN (SELECT regexp_replace(COALESCE(NULLIF(f.cnpj_cpf,''),f.cpf_cnpj,''),'\D','','g')
                                   FROM public.erp_fornecedores f WHERE f.id = p.fornecedor_id) END doc_lanc,
      public.fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')) txt,
      ARRAY(SELECT p.valor
            UNION ALL
            SELECT round(p.valor + COALESCE(p.juros,0) + COALESCE(p.multa,0) - COALESCE(p.desconto,0) - COALESCE(p.valor_pago,0), 2)
             WHERE COALESCE(p.valor_pago,0) > 0
            UNION ALL
            SELECT b.valor FROM public.erp_pagar_baixa b
             WHERE b.pagar_id = p.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL)::numeric[] vals
    FROM faixa fx
    JOIN public.erp_pagar p ON p.company_id = fx.company_id AND fx.natureza = 'debito'
     AND p.data_vencimento BETWEEN fx.dmin AND fx.dmax
    WHERE p.deleted_at IS NULL AND p.status IN ('aberto','vencido','parcial','pago')
      AND NOT EXISTS (SELECT 1 FROM public.conciliacao_movimento cm2 WHERE cm2.lancamento_id=p.id AND cm2.lancamento_tabela='erp_pagar' AND cm2.status='conciliado')
    UNION ALL
    SELECT 'erp_receber'::text, r.id, r.company_id, r.data_vencimento::date, r.valor::numeric,
      COALESCE(r.descricao,r.cliente_nome,'')::text, r.cliente_nome::text, r.status::text,
      lower(COALESCE(r.forma_pagamento,'')), (r.boleto_nosso_numero IS NOT NULL),
      CASE WHEN fx.tem_doc THEN (SELECT regexp_replace(COALESCE(NULLIF(c.cnpj_cpf,''),c.cpf_cnpj,''),'\D','','g')
                                   FROM public.erp_clientes c WHERE c.id = r.cliente_id) END,
      public.fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),
      ARRAY(SELECT r.valor
            UNION ALL
            SELECT round(r.valor + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0) - COALESCE(r.valor_pago,0), 2)
             WHERE COALESCE(r.valor_pago,0) > 0
            UNION ALL
            SELECT b.valor FROM public.erp_receber_baixa b
             WHERE b.receber_id = r.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL
            UNION ALL
            SELECT r.valor_liquido WHERE r.eh_repasse_cartao AND COALESCE(r.valor_liquido,0) > 0 AND COALESCE(r.valor_pago,0) = 0)::numeric[]
    FROM faixa fx
    JOIN public.erp_receber r ON r.company_id = fx.company_id AND fx.natureza = 'credito'
     AND r.data_vencimento BETWEEN fx.dmin AND fx.dmax
    WHERE r.deleted_at IS NULL AND r.status IN ('aberto','vencido','parcial','pago')
      AND NOT EXISTS (SELECT 1 FROM public.conciliacao_movimento cm2 WHERE cm2.lancamento_id=r.id AND cm2.lancamento_tabela='erp_receber' AND cm2.status='conciliado')
  ), pares AS (
    SELECT x.*,
      ( CASE WHEN abs(x.valor_ref-x.mvalor)<0.01 THEN 50 WHEN abs(x.valor_ref-x.mvalor)<=1 THEN 40
             WHEN abs(x.valor_ref-x.mvalor)<=10 THEN 25
             WHEN abs(x.valor_ref-x.mvalor)/NULLIF(x.mvalor,0)<0.05 THEN 15 ELSE 0 END
      + CASE WHEN abs(x.dia)<=1 THEN 30 WHEN abs(x.dia)<=3 THEN 20 WHEN abs(x.dia)<=7 THEN 10 ELSE 0 END
      + CASE WHEN x.mdoc IS NOT NULL AND x.mdoc = x.doc_lanc THEN 45 ELSE 0 END
      + CASE WHEN x.forma_conf THEN 25 WHEN x.forma_inf THEN 15 ELSE 0 END
      )::numeric AS nota_base
    FROM (
      SELECT mv.id mov_id, mv.valor mvalor, mv.data_transacao mdata, mv.dia, mv.doc mdoc, mv.forma mforma,
        mv.descricao_normalizada mdesc,
        t.tabela, t.id, t.venc, t.valor, t.desc_lanc, t.contrap, t.status_lanc, t.txt, t.doc_lanc, ref.v valor_ref,
        CASE WHEN t.tabela = 'erp_pagar'
             THEN (mv.forma IS NOT NULL AND t.forma_pg ~ mv.forma)
             ELSE ( (mv.forma='pix' AND t.forma_pg ~ 'pix')
                 OR (mv.forma='boleto' AND (t.tem_boleto OR t.forma_pg ~ 'boleto'))
                 OR (mv.forma='ted' AND t.forma_pg ~ 'ted|transf|doc') ) END AS forma_conf,
        CASE WHEN t.tabela = 'erp_pagar' THEN false
             ELSE ( mv.forma='pix' AND NOT t.tem_boleto AND COALESCE(NULLIF(trim(t.forma_pg),''),'')='' ) END AS forma_inf
      FROM mv_dia mv
      JOIN tp t ON t.company_id = mv.company_id AND t.tabela = mv.tabela AND t.venc = mv.venc_alvo
      -- valor de referência: o valor possível (> 0) mais perto do movimento; sem nenhum, o valor do título
      CROSS JOIN LATERAL (SELECT CASE WHEN cardinality(t.vals) = 1 THEN CASE WHEN t.vals[1] > 0 THEN t.vals[1] ELSE t.valor END
                                      ELSE COALESCE((SELECT v FROM unnest(t.vals) v WHERE v > 0 ORDER BY abs(v - abs(mv.valor)) LIMIT 1), t.valor)
                                 END AS v) ref
      OFFSET 0
    ) x
  ), com_corte AS (
    SELECT pr.*, nth_value(pr.nota_base, p_max_sugestoes) OVER (PARTITION BY pr.mov_id ORDER BY pr.nota_base DESC
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS kth
    FROM pares pr
    WHERE pr.nota_base > 10
  ), candidatos AS (
    SELECT c.*,
      ( c.nota_base
      + CASE WHEN ts.sim>=0.7 THEN 20 WHEN ts.sim>=0.4 THEN 10 WHEN ts.sim>=0.2 THEN 5 ELSE 0 END )::numeric AS score
    FROM com_corte c
    CROSS JOIN LATERAL (SELECT similarity(c.txt, c.mdesc) AS sim) ts
    WHERE c.kth IS NULL OR c.nota_base + 20 >= c.kth
  ), ranqueados AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.mov_id ORDER BY c.score DESC, c.venc, c.id) AS rn
      FROM candidatos c WHERE c.score > 30
  )
  SELECT k.mov_id, k.tabela, k.id, k.venc, k.valor, k.desc_lanc, k.contrap, k.status_lanc, k.score,
    -- "perfeito" EXIGE também que o valor case (pontos_de_valor > 0). Valor divergente nunca é "perfeito",
    -- mesmo com data+documento+forma somando nota alta — senão a conciliação baixa dinheiro errado.
    (CASE WHEN k.score>=90 AND k.forma_conf AND vok.ok THEN 'perfeito'
          WHEN k.score>=60 THEN 'quase'
          ELSE 'fraco' END)::text,
    ('valor_diff='||(k.valor_ref-k.mvalor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (k.venc::timestamp-k.mdata::timestamp)))::text
      ||CASE WHEN k.valor_ref <> k.valor THEN ' ref='||k.valor_ref::text||'(saldo/baixa)' ELSE '' END
      ||CASE WHEN NOT vok.ok THEN ' valor✗(divergente)' ELSE '' END
      ||CASE WHEN k.mdoc IS NOT NULL THEN ' doc✓' ELSE '' END
      ||CASE WHEN k.forma_conf THEN ' forma✓('||COALESCE(k.mforma,'?')||')'
             WHEN k.forma_inf THEN ' forma~inferida(sem boleto)'
             ELSE '' END)::text,
    vok.ok
  FROM ranqueados k
  CROSS JOIN LATERAL (SELECT (
      CASE WHEN abs(k.valor_ref-k.mvalor)<0.01 THEN 50
           WHEN abs(k.valor_ref-k.mvalor)<=1 THEN 40
           WHEN abs(k.valor_ref-k.mvalor)<=10 THEN 25
           WHEN abs(k.valor_ref-k.mvalor)/NULLIF(k.mvalor,0)<0.05 THEN 15
           ELSE 0 END ) > 0 AS ok) vok
  WHERE k.rn <= p_max_sugestoes
  ORDER BY k.mov_id, k.rn;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_sugerir_match_lote(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_sugerir_match_lote(uuid[], integer) TO authenticated, service_role;

-- ============================================================================================================
-- 2) fn_conciliacao_sugerir_match — wrapper de um movimento, repassa match_valor_ok
-- ============================================================================================================
CREATE FUNCTION public.fn_conciliacao_sugerir_match(p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text, match_valor_ok boolean)
 LANGUAGE sql
 STABLE
AS $function$
  -- a pontuação mora em fn_conciliacao_sugerir_match_lote (uma regra só, para um ou para o lote inteiro)
  SELECT s.lancamento_tabela, s.lancamento_id, s.data_lancamento, s.valor_lancamento, s.descricao_lancamento, s.contraparte,
         s.status_lancamento, s.match_score, s.match_categoria, s.motivo, s.match_valor_ok
    FROM public.fn_conciliacao_sugerir_match_lote(ARRAY[p_movimento_id], p_max_sugestoes) s
   ORDER BY s.match_score DESC, s.data_lancamento, s.lancamento_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_sugerir_match(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_sugerir_match(uuid, integer) TO authenticated, service_role;

-- ============================================================================================================
-- 3) fn_conciliacao_qualidade — "exato" exige TAMBÉM que o valor case (p_valor_ok)
-- ============================================================================================================
DROP FUNCTION IF EXISTS public.fn_conciliacao_qualidade(numeric, integer, boolean, integer);

CREATE FUNCTION public.fn_conciliacao_qualidade(p_score numeric, p_qtd_candidatos integer, p_identificado boolean, p_corte integer DEFAULT 90, p_valor_ok boolean DEFAULT true)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL
    WHEN p_score >= p_corte AND COALESCE(p_qtd_candidatos,0) > 1 THEN 'ambiguo'
    WHEN p_score >= p_corte AND NOT COALESCE(p_identificado,false) THEN 'revisar'
    -- valor divergente nunca é "exato": cai para revisão humana (não auto-concilia dinheiro errado)
    WHEN p_score >= p_corte AND NOT COALESCE(p_valor_ok,true) THEN 'revisar'
    WHEN p_score >= p_corte THEN 'exato'
    WHEN p_score >= 60 THEN 'quase_la'
    ELSE 'fraco'
  END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_qualidade(numeric, integer, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_qualidade(numeric, integer, boolean, integer, boolean) TO authenticated, service_role;

-- ============================================================================================================
-- 4) fn_conciliacao_inbox — passa match_valor_ok da sugestão à qualidade
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_conciliacao_inbox(p_lote_id uuid DEFAULT NULL::uuid, p_company_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'pendente'::text, p_limite integer DEFAULT 50)
 RETURNS TABLE(movimento_id uuid, lote_nome text, tipo_lote text, data_transacao date, valor numeric, descricao text, natureza text, status text, sugestao_lancamento_tabela text, sugestao_lancamento_id uuid, sugestao_data date, sugestao_valor numeric, sugestao_contraparte text, sugestao_score numeric, sugestao_categoria text, sugestao_qualidade text, sugestao_qtd_candidatos integer)
 LANGUAGE plpgsql
AS $function$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(m.id) INTO v_ids
    FROM conciliacao_movimento m
   WHERE (p_lote_id IS NULL OR m.lote_id = p_lote_id)
     AND (p_company_id IS NULL OR m.company_id = p_company_id)
     AND (p_status IS NULL OR m.status = p_status);
  IF v_ids IS NULL THEN RETURN; END IF;

  -- sugestão (top 1) e candidatos exatos de todos os movimentos de uma vez
  RETURN QUERY
  WITH s AS (SELECT * FROM fn_conciliacao_sugerir_match_lote(v_ids, 1)),
       qc AS (SELECT * FROM fn_conciliacao_qtd_candidatos_lote(v_ids))
  SELECT
    m.id, cl.nome, cl.tipo, m.data_transacao, m.valor, m.descricao, m.natureza, m.status,
    s.lancamento_tabela, s.lancamento_id, s.data_lancamento, s.valor_lancamento,
    s.contraparte, s.match_score, s.match_categoria,
    fn_conciliacao_qualidade(
      s.match_score, qc.qtd,
      fn_conciliacao_identificado(m.descricao, s.contraparte), 90, COALESCE(s.match_valor_ok, true)
    ) AS sugestao_qualidade,
    qc.qtd AS sugestao_qtd_candidatos
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  LEFT JOIN s ON s.movimento_id = m.id
  LEFT JOIN qc ON qc.movimento_id = m.id
  WHERE m.id = ANY (v_ids)
  ORDER BY
    CASE WHEN s.match_score >= 90 THEN 1 ELSE 2 END,
    s.match_score DESC NULLS LAST,
    m.data_transacao DESC
  LIMIT p_limite;
END;
$function$;

-- ============================================================================================================
-- 5) fn_conciliacao_rodar_lote — a auto-conciliação só dispara com valor casando (match_valor_ok)
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_conciliacao_rodar_lote(p_company_id uuid, p_lote_id uuid DEFAULT NULL::uuid, p_auto_aplicar boolean DEFAULT NULL::boolean, p_score_auto integer DEFAULT 90, p_limite integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_mov RECORD; v_best RECORD;
  v_processados int:=0; v_com_sugestao int:=0; v_perfeitos int:=0; v_quase int:=0;
  v_sem_match int:=0; v_auto_conc int:=0; v_colisao_pulada int:=0; v_auto_off int:=0;
  v_ambiguo int:=0; v_revisar int:=0;
  v_lancs_usados text[]:='{}'; v_chave text; v_deve_auto boolean; v_corte int;
  v_qtd int; v_ident boolean; v_qualidade text;
BEGIN
  FOR v_mov IN
    SELECT m.id, m.lote_id, m.descricao, m.natureza,
           COALESCE(bc.auto_conciliar, cfg.auto_conciliar_global, false) AS auto_efetivo,
           COALESCE(cfg.score_minimo, p_score_auto) AS score_efetivo
    FROM conciliacao_movimento m
    JOIN conciliacao_lote l ON l.id=m.lote_id
    LEFT JOIN erp_banco_contas bc ON bc.id=l.conta_bancaria_id
    LEFT JOIN erp_conciliacao_config cfg ON cfg.company_id=m.company_id
    WHERE m.company_id=p_company_id AND m.status IN ('pendente','divergente')
      AND (p_lote_id IS NULL OR m.lote_id=p_lote_id)
    ORDER BY m.data_transacao LIMIT p_limite
  LOOP
    v_processados:=v_processados+1;
    SELECT * INTO v_best FROM fn_conciliacao_sugerir_match(v_mov.id,1) ORDER BY match_score DESC LIMIT 1;
    IF v_best.lancamento_id IS NULL THEN v_sem_match:=v_sem_match+1; CONTINUE; END IF;

    v_corte := CASE WHEN p_auto_aplicar IS NOT NULL THEN p_score_auto ELSE v_mov.score_efetivo END;
    v_qtd   := fn_conciliacao_qtd_candidatos(v_mov.id);
    v_ident := fn_conciliacao_identificado(v_mov.descricao, v_best.contraparte);
    v_qualidade := fn_conciliacao_qualidade(v_best.match_score, v_qtd, v_ident, v_corte, COALESCE(v_best.match_valor_ok, true));

    UPDATE conciliacao_movimento
       SET psgc_sugestao=v_best.lancamento_tabela||':'||v_best.lancamento_id,
           psgc_confianca=v_best.match_score,
           motivo_status=v_qualidade,
           updated_at=now()
     WHERE id=v_mov.id;
    v_com_sugestao:=v_com_sugestao+1;

    IF v_best.match_score>=90 THEN v_perfeitos:=v_perfeitos+1;
    ELSIF v_best.match_score>=60 THEN v_quase:=v_quase+1; END IF;

    v_deve_auto:=COALESCE(p_auto_aplicar, v_mov.auto_efetivo);

    IF v_qualidade='exato' THEN
      IF NOT v_deve_auto THEN v_auto_off:=v_auto_off+1;
      ELSE
        v_chave:=v_best.lancamento_tabela||':'||v_best.lancamento_id;
        IF v_chave=ANY(v_lancs_usados)
           OR EXISTS(SELECT 1 FROM conciliacao_movimento cm
                     WHERE cm.lancamento_id=v_best.lancamento_id
                       AND cm.lancamento_tabela=v_best.lancamento_tabela AND cm.status='conciliado')
        THEN v_colisao_pulada:=v_colisao_pulada+1;
        ELSE
          PERFORM fn_conciliacao_aplicar_match(v_mov.id,v_best.lancamento_tabela,v_best.lancamento_id,NULL,'auto');
          v_lancs_usados:=array_append(v_lancs_usados,v_chave); v_auto_conc:=v_auto_conc+1;
        END IF;
      END IF;
    ELSIF v_qualidade='ambiguo' THEN v_ambiguo:=v_ambiguo+1;
    ELSIF v_qualidade='revisar' THEN v_revisar:=v_revisar+1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'company_id',p_company_id,
    'modo_auto',CASE WHEN p_auto_aplicar IS NULL THEN 'preferencia_usuario' ELSE 'override_manual' END,
    'processados',v_processados,'com_sugestao',v_com_sugestao,'perfeitos',v_perfeitos,
    'quase',v_quase,'sem_match',v_sem_match,'auto_conciliados',v_auto_conc,
    'colisao_pulada',v_colisao_pulada,'auto_desligado',v_auto_off,
    'ambiguo_revisao',v_ambiguo,'revisar_identificacao',v_revisar,
    'rodado_em',now());
END;
$function$;
