-- =============================================================
-- fn_conciliacao_sugerir_match · v3 (CPF/CNPJ + status_lancamento)
-- =============================================================
-- Mudancas em relacao ao adendo anterior:
--   + componente CPF/CNPJ no score (+45 quando descricao do mov contem
--     um doc de 11 ou 14 digitos que bate com cpf_cnpj do fornecedor/cliente)
--   + nova coluna status_lancamento no retorno (frontend mostra badge
--     "✔ Baixado" / "⏳ Em aberto" / "🔴 Vencido")
--   + status 'vencido' incluido alem de 'aberto'/'pago'
--
-- Como mudou a assinatura (RETURNS TABLE), foi necessario DROP + CREATE.
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

DROP FUNCTION IF EXISTS public.fn_conciliacao_sugerir_match(uuid, integer);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match(
  p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date,
  valor_lancamento numeric, descricao_lancamento text, contraparte text,
  status_lancamento text, match_score numeric, match_categoria text, motivo text)
LANGUAGE plpgsql AS $function$
DECLARE v_mov RECORD; v_doc text;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_doc := regexp_replace(COALESCE((regexp_match(v_mov.descricao,'(\d{14}|\d{11})'))[1],''),'\D','','g');
  IF length(v_doc) NOT IN (11,14) THEN v_doc := NULL; END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT 'erp_pagar'::text tabela, p.id lanc_id, p.data_vencimento::date data_lanc,
      p.valor::numeric valor_lanc, COALESCE(p.descricao,p.fornecedor_nome,'')::text desc_lanc,
      p.fornecedor_nome::text contrap, p.status::text status_lanc,
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
      )::numeric score
    FROM erp_pagar p LEFT JOIN erp_fornecedores f ON f.id = p.fornecedor_id
    WHERE p.company_id=v_mov.company_id AND p.status IN ('aberto','vencido','pago')
      AND p.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='debito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=p.id AND cm2.lancamento_tabela='erp_pagar' AND cm2.status='conciliado')
    UNION ALL
    SELECT 'erp_receber'::text, r.id, r.data_vencimento::date, r.valor::numeric,
      COALESCE(r.descricao,r.cliente_nome,'')::text, r.cliente_nome::text, r.status::text,
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
      )::numeric
    FROM erp_receber r LEFT JOIN erp_clientes c ON c.id = r.cliente_id
    WHERE r.company_id=v_mov.company_id AND r.status IN ('aberto','vencido','pago')
      AND r.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='credito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=r.id AND cm2.lancamento_tabela='erp_receber' AND cm2.status='conciliado')
  )
  SELECT c.tabela,c.lanc_id,c.data_lanc,c.valor_lanc,c.desc_lanc,c.contrap,c.status_lanc,c.score,
    (CASE WHEN c.score>=90 THEN 'perfeito' WHEN c.score>=60 THEN 'quase' ELSE 'fraco' END)::text,
    ('valor_diff='||(c.valor_lanc-v_mov.valor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (c.data_lanc::timestamp-v_mov.data_transacao::timestamp)))::text||CASE WHEN v_doc IS NOT NULL THEN ' doc✓' ELSE '' END)::text
  FROM candidatos c WHERE c.score>30 ORDER BY c.score DESC LIMIT p_max_sugestoes;
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_sugerir_match(uuid, integer) TO authenticated;
