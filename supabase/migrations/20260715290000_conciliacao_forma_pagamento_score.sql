-- CONCILIAÇÃO · FORMA de pagamento no score do ranking (RD-51) · André/PS
-- ============================================================================
-- Bug de ordenação: movimento PIX rankeava a conta boleto (Toy) antes da conta PIX
-- (Fazenda), porque a FORMA de recebimento tinha peso ZERO. E o teto ficava em PRATA
-- porque o sistema não tinha como cravar OURO sem checar a forma.
--
-- Regra (RD-51 — bônus quando bate, NUNCA pune quando falta/diverge):
--   • FORMA CONFIRMADA (forma_pagamento marcada = pix/boleto, ou boleto registrado): +25 · PODE ser OURO.
--   • FORMA INFERIDA (mov PIX + conta sem boleto e sem marca): +15 · CAPA EM PRATA (não crava 100% num palpite).
--   • FORMA DIVERGE/AUSENTE: +0 (não tira ponto — ausência ≠ erro; a conta pode estar sem forma marcada).
--   • OURO (perfeito) SÓ quando valor + data + FORMA CONFIRMADA batem. Sem forma confirmável → teto PRATA (honesto).
-- Ranking SUGERE, humano CONFIRMA. Só melhora a ORDEM e a HONESTIDADE do %.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match(p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text)
LANGUAGE plpgsql
AS $function$
DECLARE v_mov RECORD; v_doc text; v_mov_forma text;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_doc := regexp_replace(COALESCE((regexp_match(v_mov.descricao,'(\d{14}|\d{11})'))[1],''),'\D','','g');
  IF length(v_doc) NOT IN (11,14) THEN v_doc := NULL; END IF;

  -- forma do MOVIMENTO detectada da descrição do extrato (sinal típico de OFX)
  v_mov_forma := CASE
    WHEN v_mov.descricao ~* 'pix' THEN 'pix'
    WHEN v_mov.descricao ~* 'boleto|cobran|liquidac|liquidaç|t[ií]tulo|\mtit\M' THEN 'boleto'
    WHEN v_mov.descricao ~* '\mted\M|\mdoc\M|transfer' THEN 'ted'
    ELSE NULL END;

  RETURN QUERY
  WITH candidatos AS (
    -- ── PAGAR (débito) ──
    SELECT 'erp_pagar'::text tabela, p.id lanc_id, p.data_vencimento::date data_lanc,
      p.valor::numeric valor_lanc, COALESCE(p.descricao,p.fornecedor_nome,'')::text desc_lanc,
      p.fornecedor_nome::text contrap, p.status::text status_lanc,
      -- forma confirmada da conta a pagar (só forma_pagamento explícita)
      (v_mov_forma IS NOT NULL AND lower(COALESCE(p.forma_pagamento,'')) ~ v_mov_forma) AS forma_conf,
      false AS forma_inf,
      ( CASE WHEN abs(p.valor-v_mov.valor)<0.01 THEN 50 WHEN abs(p.valor-v_mov.valor)<=1 THEN 40
             WHEN abs(p.valor-v_mov.valor)<=10 THEN 25
             WHEN abs(p.valor-v_mov.valor)/NULLIF(v_mov.valor,0)<0.05 THEN 15 ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=7 THEN 10 ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.2 THEN 5 ELSE 0 END
      + CASE WHEN v_doc IS NOT NULL AND v_doc = regexp_replace(COALESCE(NULLIF(f.cnpj_cpf,''),f.cpf_cnpj,''),'\D','','g') THEN 45 ELSE 0 END
      -- FORMA: confirmada +25 (nunca pune)
      + CASE WHEN (v_mov_forma IS NOT NULL AND lower(COALESCE(p.forma_pagamento,'')) ~ v_mov_forma) THEN 25 ELSE 0 END
      )::numeric score
    FROM erp_pagar p LEFT JOIN erp_fornecedores f ON f.id = p.fornecedor_id
    WHERE p.company_id=v_mov.company_id AND p.status IN ('aberto','vencido','pago')
      AND p.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='debito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=p.id AND cm2.lancamento_tabela='erp_pagar' AND cm2.status='conciliado')
    UNION ALL
    -- ── RECEBER (crédito) ──
    SELECT 'erp_receber'::text, r.id, r.data_vencimento::date, r.valor::numeric,
      COALESCE(r.descricao,r.cliente_nome,'')::text, r.cliente_nome::text, r.status::text,
      -- forma CONFIRMADA: forma_pagamento explícita OU boleto registrado (é boleto de fato)
      ( (v_mov_forma='pix' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'pix')
        OR (v_mov_forma='boleto' AND (r.boleto_nosso_numero IS NOT NULL OR lower(COALESCE(r.forma_pagamento,'')) ~ 'boleto'))
        OR (v_mov_forma='ted' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'ted|transf|doc') ) AS forma_conf,
      -- forma INFERIDA: mov PIX + conta sem boleto e sem forma marcada
      ( v_mov_forma='pix' AND r.boleto_nosso_numero IS NULL AND COALESCE(NULLIF(trim(lower(r.forma_pagamento)),''),'')='' ) AS forma_inf,
      ( CASE WHEN abs(r.valor-v_mov.valor)<0.01 THEN 50 WHEN abs(r.valor-v_mov.valor)<=1 THEN 40
             WHEN abs(r.valor-v_mov.valor)<=10 THEN 25
             WHEN abs(r.valor-v_mov.valor)/NULLIF(v_mov.valor,0)<0.05 THEN 15 ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=7 THEN 10 ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.2 THEN 5 ELSE 0 END
      + CASE WHEN v_doc IS NOT NULL AND v_doc = regexp_replace(COALESCE(NULLIF(c.cnpj_cpf,''),c.cpf_cnpj,''),'\D','','g') THEN 45 ELSE 0 END
      -- FORMA: confirmada +25 · inferida +15 · diverge/ausente +0 (nunca pune)
      + CASE
          WHEN ( (v_mov_forma='pix' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'pix')
                 OR (v_mov_forma='boleto' AND (r.boleto_nosso_numero IS NOT NULL OR lower(COALESCE(r.forma_pagamento,'')) ~ 'boleto'))
                 OR (v_mov_forma='ted' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'ted|transf|doc') ) THEN 25
          WHEN ( v_mov_forma='pix' AND r.boleto_nosso_numero IS NULL AND COALESCE(NULLIF(trim(lower(r.forma_pagamento)),''),'')='' ) THEN 15
          ELSE 0 END
      )::numeric
    FROM erp_receber r LEFT JOIN erp_clientes c ON c.id = r.cliente_id
    WHERE r.company_id=v_mov.company_id AND r.status IN ('aberto','vencido','pago')
      AND r.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='credito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=r.id AND cm2.lancamento_tabela='erp_receber' AND cm2.status='conciliado')
  )
  SELECT c.tabela,c.lanc_id,c.data_lanc,c.valor_lanc,c.desc_lanc,c.contrap,c.status_lanc,c.score,
    -- OURO (perfeito) SÓ com FORMA CONFIRMADA. Sem confirmar a forma → teto PRATA (honesto, RD-51).
    (CASE WHEN c.score>=90 AND c.forma_conf THEN 'perfeito'
          WHEN c.score>=60 THEN 'quase'
          ELSE 'fraco' END)::text,
    ('valor_diff='||(c.valor_lanc-v_mov.valor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (c.data_lanc::timestamp-v_mov.data_transacao::timestamp)))::text
      ||CASE WHEN v_doc IS NOT NULL THEN ' doc✓' ELSE '' END
      ||CASE WHEN c.forma_conf THEN ' forma✓('||COALESCE(v_mov_forma,'?')||')'
             WHEN c.forma_inf THEN ' forma~inferida(sem boleto)'
             ELSE '' END)::text
  FROM candidatos c WHERE c.score>30 ORDER BY c.score DESC LIMIT p_max_sugestoes;
END; $function$;
