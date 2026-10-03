-- Conciliação · inbox abaixo de 1 s (Jordana/BPO, 02/10: fn_conciliacao_inbox deu 500 por statement timeout 18 vezes).
-- Medido em produção como a Jordana (PS_ADMIN, com RLS), em transação desfeita, lote da maior empresa (301 movimentos
-- pendentes, 5.505 contas a pagar): passava de 55 s. Depois desta migration: 675 ms o inbox inteiro (Gean: 100 ms).
--
-- Causa: o inbox chamava, para CADA movimento, fn_conciliacao_sugerir_match e fn_conciliacao_qtd_candidatos — uma
-- consulta nova por movimento (RLS reavaliada a cada uma) — e dentro dela, para CADA um dos ~293 títulos da janela,
-- fn_pagar_valor_referencia (função SQL com SET search_path, não "inlinada": outra consulta por título). ~88 mil
-- consultas por abertura do inbox.
--
-- Sem mudar regra nenhuma de pontuação (provado: notas, categorias, linhas e contagens idênticas às de antes em 100
-- movimentos de 3 empresas, e o inbox do lote da Gean idêntico linha a linha):
--  1) fn_conciliacao_sugerir_match_lote(movimentos[], n): a MESMA pontuação para todos os movimentos numa consulta só.
--     · cada título da janela é preparado UMA vez (texto normalizado, documento do favorecido — só buscado se algum
--       movimento traz CPF/CNPJ —, e os valores que podem ter sido pagos: valor, saldo após pagamento parcial, baixas
--       não conciliadas — a regra de fn_pagar_valor_referencia / fn_receber_valor_referencia);
--     · o par movimento × título sai por IGUALDADE de data (movimento × 31 dias da janela de ±15), junção por hash;
--     · dois descartes EXATOS antes de comparar texto (a semelhança de texto vale no máximo 20 pontos): par com nota
--       sem texto <= 10 nunca passa da nota mínima 30; par com nota sem texto + 20 abaixo da k-ésima melhor do
--       movimento nunca entra nas k sugestões.
--  2) fn_conciliacao_sugerir_match(movimento, n) passa a chamar a de lote (regra num lugar só).
--  3) fn_conciliacao_qtd_candidatos_lote(movimentos[]) conta os candidatos exatos de todos de uma vez, com faixas
--     (BETWEEN) em vez de abs(x - y) <= n — o índice (empresa, vencimento) é usado; mesmo resultado.
--     fn_conciliacao_qtd_candidatos(movimento) passa a chamar a de lote.
--  4) fn_conciliacao_inbox usa as duas de lote. Mesma assinatura, mesmas colunas, mesma ordem.
-- Empate de pontuação: antes a ordem entre candidatos com a mesma nota não era definida; agora desempata por
-- vencimento e id (determinístico). Todas as funções seguem SECURITY INVOKER (a RLS do usuário vale).

CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match_lote(p_movimento_ids uuid[], p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(movimento_id uuid, lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text)
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
    -- cada movimento com os 31 vencimentos da janela de ±15 dias: o par sai por IGUALDADE de data (junção por
    -- hash), em vez de comparar cada movimento com cada título da empresa
    SELECT mv.*, d.dia, mv.data_transacao + d.dia AS venc_alvo,
      CASE mv.natureza WHEN 'debito' THEN 'erp_pagar' WHEN 'credito' THEN 'erp_receber' END AS tabela
    FROM mv CROSS JOIN generate_series(-15, 15) AS d(dia)
  ), faixa AS (
    -- janela de vencimentos que interessa a cada empresa (±15 dias dos movimentos); tem_doc: algum movimento traz
    -- CPF/CNPJ (sem isso o documento do favorecido não muda nota nenhuma e nem é buscado)
    SELECT company_id, natureza, min(data_transacao) - 15 AS dmin, max(data_transacao) + 15 AS dmax,
      bool_or(doc IS NOT NULL) AS tem_doc
    FROM mv GROUP BY 1, 2
  ),
  -- cada título é preparado UMA vez (não uma vez por par movimento × título): texto normalizado, documento do
  -- favorecido e os valores que podem ter sido pagos (valor, saldo após pagamento parcial, baixas não conciliadas —
  -- a mesma regra de fn_pagar_valor_referencia / fn_receber_valor_referencia)
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
             WHERE b.receber_id = r.id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL)::numeric[]
    FROM faixa fx
    JOIN public.erp_receber r ON r.company_id = fx.company_id AND fx.natureza = 'credito'
     AND r.data_vencimento BETWEEN fx.dmin AND fx.dmax
    WHERE r.deleted_at IS NULL AND r.status IN ('aberto','vencido','parcial','pago')
      AND NOT EXISTS (SELECT 1 FROM public.conciliacao_movimento cm2 WHERE cm2.lancamento_id=r.id AND cm2.lancamento_tabela='erp_receber' AND cm2.status='conciliado')
  ), pares AS (
    -- pares movimento × título da janela de ±15 dias, com a nota SEM o texto
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
      -- valor de referência: o valor possível (> 0) mais perto do movimento; sem nenhum, o valor do título. Com um
      -- valor só (o caso comum: título sem pagamento parcial nem baixa) a resposta é ele mesmo, sem subconsulta.
      CROSS JOIN LATERAL (SELECT CASE WHEN cardinality(t.vals) = 1 THEN CASE WHEN t.vals[1] > 0 THEN t.vals[1] ELSE t.valor END
                                      ELSE COALESCE((SELECT v FROM unnest(t.vals) v WHERE v > 0 ORDER BY abs(v - abs(mv.valor)) LIMIT 1), t.valor)
                                 END AS v) ref
      OFFSET 0  -- o valor de referência é calculado UMA vez por par (sem isso o planejador o repete em cada faixa da nota)
    ) x
  ), com_corte AS (
    -- A semelhança de texto vale no máximo 20 pontos e a sugestão exige nota > 30: par com nota sem texto <= 10 nunca
    -- aparece (descartado já aqui). kth = a k-ésima melhor nota sem texto do movimento (NULL quando há menos de k):
    -- par com nota + 20 abaixo de kth nunca entra nas k melhores. Os dois descartes são EXATOS (o top-k sai igual) e
    -- o texto só é comparado para quem ainda pode entrar.
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
    (CASE WHEN k.score>=90 AND k.forma_conf THEN 'perfeito'
          WHEN k.score>=60 THEN 'quase'
          ELSE 'fraco' END)::text,
    ('valor_diff='||(k.valor_ref-k.mvalor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (k.venc::timestamp-k.mdata::timestamp)))::text
      ||CASE WHEN k.valor_ref <> k.valor THEN ' ref='||k.valor_ref::text||'(saldo/baixa)' ELSE '' END
      ||CASE WHEN k.mdoc IS NOT NULL THEN ' doc✓' ELSE '' END
      ||CASE WHEN k.forma_conf THEN ' forma✓('||COALESCE(k.mforma,'?')||')'
             WHEN k.forma_inf THEN ' forma~inferida(sem boleto)'
             ELSE '' END)::text
  FROM ranqueados k
  WHERE k.rn <= p_max_sugestoes
  ORDER BY k.mov_id, k.rn;
$function$;

CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match(p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text)
 LANGUAGE sql
 STABLE
AS $function$
  -- a pontuação mora em fn_conciliacao_sugerir_match_lote (uma regra só, para um ou para o lote inteiro)
  SELECT s.lancamento_tabela, s.lancamento_id, s.data_lancamento, s.valor_lancamento, s.descricao_lancamento, s.contraparte,
         s.status_lancamento, s.match_score, s.match_categoria, s.motivo
    FROM public.fn_conciliacao_sugerir_match_lote(ARRAY[p_movimento_id], p_max_sugestoes) s
   ORDER BY s.match_score DESC, s.data_lancamento, s.lancamento_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_conciliacao_qtd_candidatos_lote(p_movimento_ids uuid[])
 RETURNS TABLE(movimento_id uuid, qtd integer)
 LANGUAGE sql
 STABLE
AS $function$
  -- candidatos exatos (valor ± 0,01 e vencimento ± 1 dia) ainda não conciliados; faixas para o índice ser usado
  SELECT m.id,
    CASE WHEN m.natureza = 'debito' THEN (
      SELECT count(*)::int FROM public.erp_pagar p
       WHERE p.deleted_at IS NULL AND p.company_id = m.company_id
         AND p.status IN ('aberto','vencido','pago')
         AND p.valor BETWEEN m.valor - 0.01 AND m.valor + 0.01
         AND p.data_vencimento BETWEEN m.data_transacao - 1 AND m.data_transacao + 1
         AND NOT EXISTS (SELECT 1 FROM public.conciliacao_movimento cm
                          WHERE cm.lancamento_id = p.id AND cm.lancamento_tabela = 'erp_pagar'
                            AND cm.status = 'conciliado' AND cm.id <> m.id))
    ELSE (
      SELECT count(*)::int FROM public.erp_receber r
       WHERE r.deleted_at IS NULL AND r.company_id = m.company_id
         AND r.status IN ('aberto','vencido','pago')
         AND r.valor BETWEEN m.valor - 0.01 AND m.valor + 0.01
         AND r.data_vencimento BETWEEN m.data_transacao - 1 AND m.data_transacao + 1
         AND NOT EXISTS (SELECT 1 FROM public.conciliacao_movimento cm
                          WHERE cm.lancamento_id = r.id AND cm.lancamento_tabela = 'erp_receber'
                            AND cm.status = 'conciliado' AND cm.id <> m.id))
    END
  FROM public.conciliacao_movimento m
  WHERE m.id = ANY (p_movimento_ids);
$function$;

CREATE OR REPLACE FUNCTION public.fn_conciliacao_qtd_candidatos(p_movimento_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE((SELECT q.qtd FROM public.fn_conciliacao_qtd_candidatos_lote(ARRAY[p_movimento_id]) q), 0);
$function$;

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

  -- sugestão (top 1) e candidatos exatos de todos os movimentos de uma vez — antes, uma consulta por movimento
  RETURN QUERY
  WITH s AS (SELECT * FROM fn_conciliacao_sugerir_match_lote(v_ids, 1)),
       qc AS (SELECT * FROM fn_conciliacao_qtd_candidatos_lote(v_ids))
  SELECT
    m.id, cl.nome, cl.tipo, m.data_transacao, m.valor, m.descricao, m.natureza, m.status,
    s.lancamento_tabela, s.lancamento_id, s.data_lancamento, s.valor_lancamento,
    s.contraparte, s.match_score, s.match_categoria,
    fn_conciliacao_qualidade(
      s.match_score, qc.qtd,
      fn_conciliacao_identificado(m.descricao, s.contraparte), 90
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

-- mesmo acesso das funções que já existiam: usuário logado (com RLS) e serviço; nunca anônimo
REVOKE ALL ON FUNCTION public.fn_conciliacao_sugerir_match_lote(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_sugerir_match_lote(uuid[], integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_conciliacao_qtd_candidatos_lote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_qtd_candidatos_lote(uuid[]) TO authenticated, service_role;
