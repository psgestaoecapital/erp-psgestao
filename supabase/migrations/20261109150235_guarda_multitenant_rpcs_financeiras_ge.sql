-- Guarda multi-tenant em RPCs financeiras/GE (SECURITY DEFINER) — vazamento cross-tenant (RLS/LGPD) P0
-- Origem: auditoria auditor_pdca_2 (tarefa 41861285). RPCs SECURITY DEFINER com EXECUTE a `authenticated`
-- rodam como postgres (rolbypassrls) e so checavam plano GE da empresa-alvo — NAO checavam se o usuario
-- logado pertence a p_company_id. Qualquer autenticado podia ler extrato/saldo/inadimplentes/DRE/CPF de
-- QUALQUER empresa GE passando um company_id alheio.
-- Correcao (aditiva, idempotente): PERFORM/SELECT public.fn__guarda_empresa(<company>) no TOPO de cada RPC.
--   fn__guarda_empresa: auth.uid() NULL (service role) OU is_admin() => RETURN; senao se company NOT IN
--   get_user_company_ids() => RAISE 42501. Nao muda retorno para o dono legitimo nem para service role
--   (cron/edge). Para funcoes com p_company_ids uuid[], guarda cada elemento via unnest.
-- Prova RD-38 (BEGIN..ROLLBACK, producao): user comercial 3aadeb3a (comp propria 918c3ea4) chamando com
--   company alheia 1163bb56 passa a RAISE 42501; dono legitimo e service role continuam passando. Ver PR.
-- RD-52: arquivo+PR; nao aplicado via MCP. Faixa segundos :35 (code-desenvolvedor-3). revisao-eng-chefe.
--
-- AJUSTE revisor #4117 (REVOKE anon + caminho NULL-auth.uid()): fn__guarda_empresa faz RETURN quando
-- auth.uid() e NULL (service role) — mas o papel `anon` TAMBEM tem auth.uid() NULL. Se qualquer destas 22
-- concedesse EXECUTE a anon/PUBLIC, um chamador anonimo passaria pelo guard e leria dado de qualquer empresa.
-- Por isso cada funcao recebe, apos o CREATE OR REPLACE:
--   REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon;   (fecha o caminho anon de forma permanente)
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated, service_role;  (mantem o contrato do dono)
-- Prova RD-38 (producao, pg_proc.proacl, 08/11): hoje as 22 concedem EXECUTE SO a {owner, authenticated,
--   service_role} — NENHUMA a anon/PUBLIC => o REVOKE nao tira acesso vivo (sem regressao) e cobre exatamente
--   o caminho que o guard libera por NULL. Cenario anon: chave anonima (auth.uid() NULL) chamando qualquer uma
--   destas RPCs BLOQUEIA no nivel do grant (anon sem EXECUTE) ANTES de entrar no corpo — nao chega no guard.
--   authenticated-membro e service_role continuam devolvendo igual. Prova leve BEGIN..ROLLBACK (statement_timeout
--   15s) confirmou que os 44 REVOKE/GRANT aplicam limpo nas 22 assinaturas reais.

CREATE OR REPLACE FUNCTION public.fn_balanco_patrimonial(p_company_id uuid, p_data_ref date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_periodo text := to_char(p_data_ref, 'YYYY-MM');
  v_lim_circ date := (p_data_ref + interval '12 months')::date;
  v_caixa numeric; v_receber numeric; v_estoque numeric; v_forn numeric; v_forn_lp numeric;
  v_imob_bruto numeric; v_dep_acum numeric; v_invest numeric; v_intang numeric; v_bens int;
  v_ativo numeric := 0; v_passivo numeric := 0; v_pl numeric := 0; v_linhas jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_caixa := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_receber
    FROM v_receber_efetivo WHERE company_id=p_company_id AND status NOT IN ('recebido','pago','cancelado','orcamento');
  SELECT COALESCE(SUM(COALESCE(estoque_atual,0) * COALESCE(preco_custo_medio, preco_custo, 0)),0) INTO v_estoque
    FROM erp_produtos WHERE company_id=p_company_id AND COALESCE(ativo,true);
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_forn
    FROM erp_pagar WHERE company_id=p_company_id AND status NOT IN ('pago','cancelado') AND data_vencimento <= v_lim_circ;
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_forn_lp
    FROM erp_pagar WHERE company_id=p_company_id AND status NOT IN ('pago','cancelado') AND data_vencimento > v_lim_circ;
  SELECT count(*) FILTER (WHERE natureza NOT IN ('participacao','software')),
         COALESCE(SUM(valor_aquisicao) FILTER (WHERE natureza NOT IN ('participacao','software')),0),
         COALESCE(SUM(valor_aquisicao) FILTER (WHERE natureza='participacao'),0),
         COALESCE(SUM(valor_aquisicao) FILTER (WHERE natureza='software'),0)
    INTO v_bens, v_imob_bruto, v_invest, v_intang
  FROM erp_bem WHERE company_id=p_company_id AND status IN ('ativo','em_construcao');
  SELECT COALESCE(SUM(d.acumulado),0) INTO v_dep_acum
  FROM erp_bem_depreciacao d
  JOIN LATERAL (SELECT max(competencia) mc FROM erp_bem_depreciacao dd WHERE dd.bem_id=d.bem_id AND dd.competencia <= p_data_ref) x ON x.mc=d.competencia
  JOIN erp_bem b ON b.id=d.bem_id WHERE d.company_id=p_company_id AND b.status IN ('ativo','em_construcao');

  v_linhas := v_linhas
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Caixa e bancos','valor',ROUND(v_caixa,2),'origem','calculado','editavel',false,'fonte','fn_saldo_bancos_dinamico')
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Contas a receber','valor',ROUND(v_receber,2),'origem','calculado','editavel',false,'fonte','erp_receber (em aberto)')
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Estoques','valor',ROUND(v_estoque,2),'origem','calculado','editavel',false,'fonte','erp_produtos (estoque×custo médio)');
  v_ativo := v_ativo + v_caixa + v_receber + v_estoque;
  v_linhas := v_linhas
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Investimentos','valor',ROUND(v_invest,2),'origem','calculado','editavel',false,'fonte','erp_bem (participacao)')
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Imobilizado bruto','valor',CASE WHEN v_bens=0 THEN NULL ELSE ROUND(v_imob_bruto,2) END,'origem',CASE WHEN v_bens=0 THEN 'ausente' ELSE 'calculado' END,'editavel',false,'fonte','erp_bem','motivo',CASE WHEN v_bens=0 THEN 'nenhum bem cadastrado' ELSE NULL END)
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','(−) Depreciação acumulada','valor',ROUND(-v_dep_acum,2),'origem','calculado','editavel',false,'fonte','erp_bem_depreciacao')
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Intangível (software)','valor',ROUND(v_intang,2),'origem','calculado','editavel',false,'fonte','erp_bem (software)');
  v_ativo := v_ativo + v_invest + v_imob_bruto - v_dep_acum + v_intang;
  v_linhas := v_linhas || jsonb_build_object('lado','passivo','grupo','PASSIVO CIRCULANTE','nome','Fornecedores (≤12m)','valor',ROUND(v_forn,2),'origem','calculado','editavel',false,'fonte','erp_pagar (aberto ≤12m)');
  v_passivo := v_passivo + v_forn;
  v_linhas := v_linhas || jsonb_build_object('lado','passivo','grupo','PASSIVO NÃO CIRCULANTE','nome','Obrigações de longo prazo (>12m)','valor',ROUND(v_forn_lp,2),'origem','calculado','editavel',false,'fonte','erp_pagar (aberto >12m)');
  v_passivo := v_passivo + v_forn_lp;

  -- linhas manuais LIVRES (com id/ordem) do período
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',m.id,'lado',m.lado,'grupo',m.grupo,'subgrupo',m.subgrupo,'nome',m.nome,
      'valor',m.valor,'obs',m.obs,'ordem',m.ordem,'origem','manual','editavel',true) ORDER BY m.ordem, m.nome), '[]'::jsonb)
    FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo);

  -- templates AUSENTES (sugestão) só quando não há linha cadastrada
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('lado',x.lado,'grupo',x.grupo,'nome',x.nome,'valor',NULL,
        'origem','ausente','editavel',true,'fonte','balanco_patrimonial','motivo',x.nome||' não cadastrado (sugestão)')), '[]'::jsonb)
    FROM (VALUES
      ('ativo','ATIVO CIRCULANTE','Outros circulantes'),('ativo','ATIVO NÃO CIRCULANTE','Realizável a longo prazo'),
      ('passivo','PASSIVO CIRCULANTE','Obrigações fiscais/trabalhistas'),('passivo','PASSIVO CIRCULANTE','Empréstimos curto prazo'),
      ('passivo','PASSIVO NÃO CIRCULANTE','Empréstimos longo prazo'),('pl','PATRIMÔNIO LÍQUIDO','Capital social'),
      ('pl','PATRIMÔNIO LÍQUIDO','Reservas'),('pl','PATRIMÔNIO LÍQUIDO','Resultado acumulado')
    ) AS x(lado,grupo,nome)
    WHERE NOT EXISTS (SELECT 1 FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.lado=x.lado AND m.grupo=x.grupo AND m.nome=x.nome));

  -- totais das manuais (todas as livres do período)
  SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.lado='ativo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='passivo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='pl'),0)
    INTO v_caixa, v_receber, v_estoque FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo;
  v_ativo := v_ativo + v_caixa; v_passivo := v_passivo + v_receber; v_pl := v_pl + v_estoque;

  RETURN jsonb_build_object('ok',true,'data_ref',p_data_ref,'periodo',v_periodo,
    'ativo_total',ROUND(v_ativo,2),'passivo_total',ROUND(v_passivo,2),'pl_total',ROUND(v_pl,2),
    'passivo_mais_pl',ROUND(v_passivo+v_pl,2),'diferenca',ROUND(v_ativo-(v_passivo+v_pl),2),
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,'linhas',v_linhas);
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_balanco_patrimonial(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_patrimonial(uuid, date) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis(p_company_ids uuid[])
 RETURNS TABLE(a_receber_valor numeric, a_receber_qtd bigint, a_pagar_valor numeric, a_pagar_qtd bigint, saldo_bancos numeric, mrr_mensal numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn__guarda_empresa(_cid) FROM unnest(p_company_ids) AS _cid;
  SELECT
    COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT COUNT(*)  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar   WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT COUNT(*)  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar   WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    fn_saldo_bancos_dinamico(p_company_ids),
    COALESCE((SELECT SUM(COALESCE(valor_atual, valor_mensal, 0) * CASE periodicidade
        WHEN 'anual' THEN 1.0/12 WHEN 'semestral' THEN 1.0/6 WHEN 'trimestral' THEN 1.0/3
        WHEN 'bimestral' THEN 1.0/2 ELSE 1 END)
      FROM erp_contratos WHERE company_id = ANY(p_company_ids) AND status='ativo'), 0)
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_dashboard_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dashboard_kpis(uuid[]) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_dre_ordem_personalizada_get(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'linha_id', linha_id,
      'ordem', ordem,
      'visivel', visivel,
      'agrupador', agrupador
    ) ORDER BY ordem
  ), '[]'::jsonb)
  FROM erp_dre_ordem_personalizada
  WHERE company_id = p_company_id
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_dre_ordem_personalizada_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dre_ordem_personalizada_get(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_fiscal_subitens_obra(p_company_id uuid, p_codigo_lc116 text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao) ORDER BY codigo), '[]'::jsonb)
  FROM public.erp_fiscal_servico_obra_obrigatoria
  WHERE ativo AND (company_id IS NULL OR company_id = p_company_id)
    -- grupo = 4 primeiros dígitos do LC116 do serviço (ex '07.02' -> '0702'); subitens '0702NN'
    AND left(codigo, 4) = left(regexp_replace(COALESCE(p_codigo_lc116,''),'[^0-9]','','g'), 4)
    AND length(regexp_replace(COALESCE(p_codigo_lc116,''),'[^0-9]','','g')) >= 4;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_fiscal_subitens_obra(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_subitens_obra(uuid, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(p_company_id uuid, p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_inicial numeric;
  v_data_saldo_inicial date;
  v_resultado jsonb := '[]'::jsonb;
  v_saldo_acumulado numeric;
  v_dia record;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
    INTO v_saldo_inicial, v_data_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true
    AND (p_conta_id IS NULL OR id = p_conta_id);

  v_saldo_acumulado := v_saldo_inicial;

  FOR v_dia IN
    SELECT
      d::date AS data,
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')
                  AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'
                  AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))), 0) AS pagamentos,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado + v_dia.recebimentos - v_dia.pagamentos
                         + v_dia.transferencias_entrada - v_dia.transferencias_saida;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos
                       + v_dia.transferencias_entrada - v_dia.transferencias_saida,
      'saldo_final', v_saldo_acumulado
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('inicio', p_data_inicio, 'fim', p_data_fim),
    'saldo_inicial', v_saldo_inicial,
    'saldo_final', v_saldo_acumulado,
    'total_recebimentos', (SELECT SUM((d ->> 'recebimentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos', (SELECT SUM((d ->> 'pagamentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_entrada', (SELECT SUM((d ->> 'transferencias_entrada')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_saida', (SELECT SUM((d ->> 'transferencias_saida')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_dre_divisional(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mes int := EXTRACT(MONTH FROM CURRENT_DATE);
  v_ano int := EXTRACT(YEAR FROM CURRENT_DATE);
  v_linhas jsonb; v_total_realizado numeric := 0; v_total_orcado numeric := 0; v_pct_geral numeric;
  v_receita_total numeric := 0; v_sem_linha numeric := 0;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM linhas_negocio WHERE empresa_id = p_company_id) THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'empty_state', true,
      'mensagem', 'Empresa sem linhas de negocio configuradas (DRE Divisional opcional)');
  END IF;
  WITH realizado AS (
    SELECT ln.id AS linha_id, ln.nome AS linha_nome, COALESCE(SUM(d.receita_bruta), 0) AS receita_realizada
    FROM linhas_negocio ln
    LEFT JOIN m2_dre_divisional d ON d.ln_id = ln.id AND d.year = v_ano AND d.month = v_mes
    WHERE ln.empresa_id = p_company_id GROUP BY ln.id, ln.nome),
  orcado AS (
    SELECT linha_id, COALESCE(SUM(receita_budget), 0) AS receita_orcada
    FROM linhas_negocio_budget WHERE empresa_id = p_company_id AND ano = v_ano AND mes = v_mes GROUP BY linha_id)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'linha_id', r.linha_id, 'linha_nome', r.linha_nome, 'realizado', r.receita_realizada,
      'orcado', COALESCE(o.receita_orcada, 0),
      'pct_atingido', CASE WHEN COALESCE(o.receita_orcada, 0) = 0 THEN NULL ELSE ROUND((r.receita_realizada / o.receita_orcada) * 100, 0) END,
      'status', CASE WHEN COALESCE(o.receita_orcada, 0) = 0 THEN 'sem_orcamento'
        WHEN r.receita_realizada / o.receita_orcada >= 0.9 THEN 'verde'
        WHEN r.receita_realizada / o.receita_orcada >= 0.7 THEN 'amarelo' ELSE 'vermelho' END
    ) ORDER BY r.linha_nome), '[]'::jsonb),
    SUM(r.receita_realizada), SUM(COALESCE(o.receita_orcada, 0))
  INTO v_linhas, v_total_realizado, v_total_orcado
  FROM realizado r LEFT JOIN orcado o ON o.linha_id = r.linha_id;
  SELECT COALESCE(SUM(pd.valor), 0) INTO v_receita_total
  FROM psgc_dre pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ano = v_ano AND pd.mes = v_mes
    AND pc.dre_grupo = 'ROB' AND COALESCE(pd.regime, 'competencia') = 'competencia';
  v_sem_linha := v_receita_total - COALESCE(v_total_realizado, 0);
  IF v_sem_linha > 0.005 THEN
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'linha_id', 'sem_linha', 'linha_nome', 'Sem linha de negócio',
      'realizado', v_sem_linha, 'orcado', 0, 'pct_atingido', NULL, 'status', 'sem_orcamento'));
    v_total_realizado := COALESCE(v_total_realizado, 0) + v_sem_linha;
  END IF;
  v_pct_geral := CASE WHEN COALESCE(v_total_orcado, 0) = 0 THEN NULL ELSE ROUND((v_total_realizado / v_total_orcado) * 100, 0) END;
  RETURN jsonb_build_object('company_id', p_company_id, 'mes', v_mes, 'ano', v_ano, 'linhas', v_linhas,
    'total_realizado', COALESCE(v_total_realizado, 0), 'total_orcado', COALESCE(v_total_orcado, 0), 'pct_geral', v_pct_geral);
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_dre_divisional(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_dre_divisional(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_extrato_conta(p_company_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_data_inicio date := COALESCE(p_data_inicio, CURRENT_DATE - 30);
  v_data_fim date := COALESCE(p_data_fim, CURRENT_DATE);
  v_saldo_base numeric := 0;
  v_data_ancora date;
  v_saldo_anterior numeric := 0;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_c_inicio numeric := 0;
  v_c_ancora numeric := 0;
  v_resultados jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  SELECT COALESCE(SUM(saldo_inicial),0), MIN(data_saldo_inicial)
    INTO v_saldo_base, v_data_ancora
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo AND soma_no_saldo
    AND (p_conta_id IS NULL OR id = p_conta_id);

  IF v_data_ancora IS NULL THEN
    -- Sem data de âncora: o saldo de abertura vale desde sempre. Saldo no início do período =
    -- abertura + (recebidos antes do início) − (pagos antes do início). (Antes faltava v_saldo_base aqui.)
    SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_c_inicio
      FROM erp_receber
      WHERE company_id = p_company_id AND status IN ('recebido','pago') AND data_pagamento < v_data_inicio;
    SELECT v_saldo_base + v_c_inicio - COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_saldo_anterior
      FROM erp_pagar
      WHERE company_id = p_company_id AND status = 'pago' AND data_pagamento < v_data_inicio;
  ELSE
    v_c_inicio :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_inicio - 1)
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_inicio - 1);
    v_c_ancora :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_ancora)
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_ancora);
    v_saldo_anterior := v_saldo_base + v_c_inicio - v_c_ancora;
  END IF;

  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_entradas
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim;
  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_saidas
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim;

  WITH movimentos AS (
    SELECT id, 'receita' AS tipo, descricao, cliente_nome AS nome_pessoa, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor) AS valor,
      data_pagamento AS data, COALESCE(valor_pago, valor) AS sinal
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
    UNION ALL
    SELECT id, 'despesa', descricao, fornecedor_nome, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor),
      data_pagamento, -COALESCE(valor_pago, valor)
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
    LIMIT 500
  ),
  com_saldo AS (
    SELECT *, v_saldo_anterior + SUM(sinal) OVER (ORDER BY data, id ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
    FROM movimentos
  )
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.data DESC, a.id DESC) INTO v_resultados FROM com_saldo a;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_data_inicio, 'fim', v_data_fim),
    'totalizadores', jsonb_build_object(
      'saldo_anterior', v_saldo_anterior,
      'total_entradas', v_total_entradas,
      'total_saidas', v_total_saidas,
      'saldo_atual', v_saldo_anterior + v_total_entradas - v_total_saidas,
      'saldo_base', v_saldo_base,
      'data_ancora', v_data_ancora
    ),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_kpis_dashboard(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receber_vencido jsonb; v_receber_hoje jsonb; v_receber_mes jsonb;
  v_pagar_vencido jsonb; v_saldo_total jsonb; v_saldo_valor numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  -- RECEBER vencido: em aberto (não recebido/pago/cancelado) e vencido por DATA. valor = valor - pago.
  WITH base AS (
    SELECT categoria, (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor
    FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado') AND data_vencimento < CURRENT_DATE),
  totais AS (SELECT SUM(valor) AS total, COUNT(*) AS qtd FROM base),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE((SELECT total FROM totais), 0), 'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_receber_vencido;
  -- RECEBER vencendo hoje (+ restante do mês).
  WITH base AS (SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado') AND data_vencimento = CURRENT_DATE)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'restante_mes', (SELECT COALESCE(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 0) FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
      WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado')
        AND data_vencimento BETWEEN CURRENT_DATE + 1 AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))
  INTO v_receber_hoje FROM base;
  WITH base AS (
    SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado')
      AND data_vencimento BETWEEN CURRENT_DATE AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes FROM base;
  -- PAGAR vencido: em aberto (não pago/cancelado — erp_pagar não tem status 'vencido') e vencido por DATA.
  WITH base AS (
    SELECT categoria, (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor, data_vencimento FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
    WHERE company_id = p_company_id AND status NOT IN ('pago','cancelado') AND data_vencimento < CURRENT_DATE),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'dias_max_atraso', COALESCE(MAX(CURRENT_DATE - data_vencimento), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_pagar_vencido FROM base;
  v_saldo_valor := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT jsonb_build_object('valor', v_saldo_valor, 'limite_credito', 0, 'disponivel_total', v_saldo_valor, 'qtd_contas', COUNT(*))
  INTO v_saldo_total FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true AND COALESCE(soma_no_saldo, true) = true;
  RETURN jsonb_build_object('company_id', p_company_id,
    'kpi_receber_vencido', v_receber_vencido, 'kpi_vencem_hoje', v_receber_hoje,
    'kpi_vencer_mes', v_receber_mes, 'kpi_pagar_vencido', v_pagar_vencido, 'kpi_saldo_total', v_saldo_total);
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_kpis_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_kpis_dashboard(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date, p_status_filtro text DEFAULT 'todos'::text, p_status_filtros text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb; v_hoje date := CURRENT_DATE;
  v_kpi_vencidos numeric; v_kpi_hoje numeric; v_kpi_avencer numeric; v_kpi_pagos numeric; v_kpi_total numeric;
  v_cnt_vencidos int; v_cnt_hoje int; v_cnt_avencer int; v_cnt_pagos int;
  v_multi boolean := p_status_filtros IS NOT NULL AND cardinality(p_status_filtros) > 0;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE status = 'pago')
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      -- #2734 · cancelado nunca entra nos cards nem no total (espelha o ramo receber).
      AND COALESCE(status, '') <> 'cancelado';

    -- [Bloco B] vencido não tem período: recomputa vencidos all-time (sobrescreve o valor da janela).
    SELECT COALESCE(SUM(valor),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')
      AND COALESCE(status, '') <> 'cancelado';   -- #2734

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.fornecedor_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.conciliado, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(f.cpf_cnpj, f.cnpj_cpf) AS documento,
        CASE WHEN d.status = 'pago' AND d.conciliado THEN 'conciliado'
             WHEN d.status = 'pago' THEN 'pago'
             WHEN d.status = 'agendado' THEN 'agendado'
             WHEN d.status = 'incluido_remessa' THEN 'incluido_remessa'
             WHEN d.data_vencimento < v_hoje THEN 'vencido'
             WHEN d.data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM erp_pagar d
      LEFT JOIN erp_fornecedores f ON f.id = d.fornecedor_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
        -- #2734 · cancelado não aparece na lista (nem soma no Total recomposto pelo front).
        AND COALESCE(d.status, '') <> 'cancelado'
        -- [Bloco B] período OU vencido-não-pago (vencido nunca some da lista)
        AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
             OR (d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa')))
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos'         = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('hoje'             = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('avencer'          = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('pagos'            = ANY(p_status_filtros) AND d.status = 'pago' AND NOT COALESCE(d.conciliado,false))
              OR ('conciliado'       = ANY(p_status_filtros) AND d.status = 'pago' AND COALESCE(d.conciliado,false))
              OR ('agendado'         = ANY(p_status_filtros) AND d.status = 'agendado')
              OR ('incluido_remessa' = ANY(p_status_filtros) AND d.status = 'incluido_remessa')
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos'         AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'hoje'             AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'avencer'          AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'pagos'            AND d.status = 'pago' AND NOT COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'conciliado'       AND d.status = 'pago' AND COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'agendado'         AND d.status = 'agendado')
              OR (p_status_filtro = 'incluido_remessa' AND d.status = 'incluido_remessa')
          ) END
        )
      ORDER BY d.data_vencimento ASC, d.descricao LIMIT 5000
    ) a;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status IN ('recebido','pago') THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE status IN ('recebido','pago'))
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

    -- [Bloco B] vencido não tem período: recomputa vencidos all-time (sobrescreve o valor da janela).
    SELECT COALESCE(SUM(valor),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('recebido','pago')
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.cliente_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.conciliado, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(c.cpf_cnpj, c.cnpj_cpf) AS documento,
        CASE WHEN d.status IN ('recebido','pago') AND d.conciliado THEN 'conciliado'
             WHEN d.status IN ('recebido','pago') THEN 'pago'
             WHEN d.data_vencimento < v_hoje THEN 'vencido'
             WHEN d.data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM v_receber_efetivo d
      LEFT JOIN erp_clientes c ON c.id = d.cliente_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
        -- [Bloco B] período OU vencido-não-pago (vencido nunca some da lista)
        AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
             OR (d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago')))
        AND COALESCE(d.status, '') NOT IN ('orcamento','renegociado','cancelado')
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos'   = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('hoje'       = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('avencer'    = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('pagos'      = ANY(p_status_filtros) AND d.status IN ('recebido','pago') AND NOT COALESCE(d.conciliado,false))
              OR ('conciliado' = ANY(p_status_filtros) AND d.status IN ('recebido','pago') AND COALESCE(d.conciliado,false))
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos'   AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'hoje'       AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'avencer'    AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'pagos'      AND d.status IN ('recebido','pago') AND NOT COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'conciliado' AND d.status IN ('recebido','pago') AND COALESCE(d.conciliado,false))
          ) END
        )
      ORDER BY d.data_vencimento ASC, d.descricao LIMIT 5000
    ) a;
  END IF;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('data_inicio', p_data_inicio, 'data_fim', p_data_fim),
    'tipo', p_tipo,
    'kpis', jsonb_build_object(
      'vencidos', jsonb_build_object('valor', v_kpi_vencidos, 'qtd', v_cnt_vencidos),
      'hoje', jsonb_build_object('valor', v_kpi_hoje, 'qtd', v_cnt_hoje),
      'avencer', jsonb_build_object('valor', v_kpi_avencer, 'qtd', v_cnt_avencer),
      'pagos', jsonb_build_object('valor', v_kpi_pagos, 'qtd', v_cnt_pagos),
      'total', v_kpi_total),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_next_best_action(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_saldo numeric; v_rec record; v_pag record; v_qtd_conciliacoes_pendentes int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'caixa', 'titulo', 'Caixa no vermelho',
      'texto', 'Saldo bancario consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G990D00') || '. Priorize entradas e segure pagamentos nao criticos.',
      'cta_principal', 'Ver contas bancarias', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/cadastros/contas-bancarias', 'rota_secundaria', '/dashboard/consultor-ia?contexto=caixa');
  END IF;
  SELECT cliente_nome, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_rec
  FROM erp_receber WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL
  GROUP BY cliente_nome ORDER BY MAX(CURRENT_DATE - data_vencimento) DESC, SUM(valor) DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'cobranca', 'titulo', 'Cobre os vencidos',
      'texto', 'Cobrar ' || COALESCE(v_rec.cliente_nome,'cliente') || ' — atrasado ha ' || v_rec.dias || ' dias, R$ ' || TO_CHAR(v_rec.valor,'FM999G999G990D00') || '. Maior risco da carteira.',
      'cta_principal', 'Ver inadimplentes', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/inadimplentes', 'rota_secundaria', '/dashboard/consultor-ia?contexto=cobranca');
  END IF;
  SELECT COUNT(*) AS qtd, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_pag
  FROM erp_pagar WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL;
  IF v_pag.qtd > 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'pagamento', 'titulo', 'Contas a pagar vencidas',
      'texto', v_pag.qtd || ' conta(s) vencida(s), R$ ' || TO_CHAR(v_pag.valor,'FM999G999G990D00') || ' · maior atraso ' || v_pag.dias || ' dia(s). Regularize pra evitar juros/negativacao.',
      'cta_principal', 'Ver contas a pagar', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/pagar?status=vencido', 'rota_secundaria', '/dashboard/consultor-ia');
  END IF;
  SELECT COUNT(*) INTO v_qtd_conciliacoes_pendentes
  FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
  WHERE bc.company_id = p_company_id AND cl.status = 'pendente';
  IF v_qtd_conciliacoes_pendentes > 10 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'conciliacao', 'titulo', 'Concilie o extrato',
      'texto', 'Voce tem ' || v_qtd_conciliacoes_pendentes || ' conciliacoes bancarias pendentes. Resolver isso corrige seus KPIs.',
      'cta_principal', 'Conciliar agora', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/conciliacao', 'rota_secundaria', '/dashboard/consultor-ia?contexto=conciliacao');
  END IF;
  RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'estavel', 'titulo', 'Tudo em dia',
    'texto', 'Sem acoes urgentes detectadas. Aproveite pra planejar o proximo mes ou revisar contratos recorrentes.',
    'cta_principal', 'Ver contratos recorrentes', 'cta_secundario', 'Falar com IA',
    'rota_principal', '/dashboard/cadastros/contratos-recorrentes', 'rota_secundaria', '/dashboard/consultor-ia');
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_next_best_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_next_best_action(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_onboarding_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_nome text;
  v_tem_plano boolean;
  v_passo_1_contas boolean;
  v_passo_2_lancamentos boolean;
  v_passo_3_contratos boolean;
  v_passo_4_categorias boolean;
  v_passo_5_dre boolean;
  v_total_completos int;
  v_pct_completo numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('erro', true, 'mensagem', 'Selecione uma empresa para acessar a Gestão Empresarial');
  END IF;

  SELECT razao_social INTO v_empresa_nome FROM companies WHERE id = p_company_id;
  IF v_empresa_nome IS NULL THEN
    RETURN jsonb_build_object('erro', true, 'mensagem', 'Empresa não encontrada');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) INTO v_tem_plano;

  IF NOT v_tem_plano THEN
    RETURN jsonb_build_object('sem_plano', true, 'empresa_nome', v_empresa_nome,
      'mensagem', 'Empresa não tem plano Gestão Empresarial ativo');
  END IF;

  v_passo_1_contas := EXISTS (SELECT 1 FROM erp_banco_contas WHERE company_id = p_company_id);
  v_passo_2_lancamentos := EXISTS (SELECT 1 FROM erp_lancamentos WHERE company_id = p_company_id);
  v_passo_3_contratos := EXISTS (SELECT 1 FROM erp_contratos WHERE company_id = p_company_id);

  -- Fix passo 4: erp_plano_contas (tabela correta) + threshold >= 1
  v_passo_4_categorias := EXISTS (SELECT 1 FROM erp_plano_contas WHERE company_id = p_company_id);

  v_passo_5_dre := EXISTS (SELECT 1 FROM m2_dre_divisional WHERE company_id = p_company_id);

  v_total_completos := (v_passo_1_contas::int + v_passo_2_lancamentos::int +
    v_passo_3_contratos::int + v_passo_4_categorias::int + v_passo_5_dre::int);
  v_pct_completo := ROUND((v_total_completos * 100.0) / 5, 0);

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'empresa_nome', v_empresa_nome,
    'sem_plano', false,
    'onboarding_completo', v_total_completos = 5,
    'total_passos', 5,
    'passos_completos', v_total_completos,
    'pct_completo', v_pct_completo,
    'passos', jsonb_build_array(
      jsonb_build_object('numero', 1, 'titulo', 'Cadastre suas contas bancárias',
        'descricao', 'Quais bancos sua empresa usa? Santander, Inter, Sicoob... O sistema vai mostrar seus saldos aqui.',
        'icone', 'building-bank', 'rota_acao', '/dashboard/cadastros/contas-bancarias',
        'completo', v_passo_1_contas),
      jsonb_build_object('numero', 2, 'titulo', 'Importe seus lançamentos',
        'descricao', 'Suba uma planilha (Excel/CSV) ou arquivo OFX do banco. Ou cadastre manualmente.',
        'icone', 'file-upload', 'rota_acao', '/dashboard/importer-universal',
        'completo', v_passo_2_lancamentos),
      jsonb_build_object('numero', 3, 'titulo', 'Cadastre seus contratos recorrentes',
        'descricao', 'Aluguéis, mensalidades, contratos de serviço. O sistema gera as cobranças automaticamente todo mês.',
        'icone', 'repeat', 'rota_acao', '/dashboard/contratos-recorrentes',
        'completo', v_passo_3_contratos),
      jsonb_build_object('numero', 4, 'titulo', 'Organize suas categorias contábeis',
        'descricao', 'Classifique suas receitas e despesas (Aluguel, Fornecedores, Vendas...). O sistema sugere as padrões.',
        'icone', 'tags', 'rota_acao', '/dashboard/cadastros/plano-contas',
        'completo', v_passo_4_categorias),
      jsonb_build_object('numero', 5, 'titulo', 'Configure seu DRE por área',
        'descricao', 'Sua empresa tem várias linhas de negócio? (Ex: Tintas, Gesso, Imóveis). Veja performance separada por área.',
        'icone', 'chart-pie', 'rota_acao', '/dashboard/dre-divisional/configurar',
        'completo', v_passo_5_dre, 'opcional', true)
    )
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_onboarding_status(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_saude_financeira(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_total numeric := 0; v_burn_rate_mensal numeric := 0; v_meses_caixa numeric := 0;
  v_concentracao_pct numeric := 0; v_top_cliente_nome text;
  v_inadimplencia_pct numeric := 0; v_inadimplencia_qtd int := 0; v_inadimplencia_valor numeric := 0;
  v_score int := 0; v_classificacao text; v_cor text; v_frase_1 text; v_frase_2 text; v_frase_3 text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true, 'mensagem', 'Empresa sem plano GE ativo');
  END IF;
  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT COALESCE(AVG(total_mes), 0) INTO v_burn_rate_mensal
  FROM (SELECT DATE_TRUNC('month', data_pagamento) AS mes, SUM(COALESCE(valor_pago, valor)) AS total_mes
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '3 months' GROUP BY DATE_TRUNC('month', data_pagamento)) sub;
  v_meses_caixa := CASE WHEN v_burn_rate_mensal > 0 THEN ROUND(v_saldo_total / v_burn_rate_mensal, 1) ELSE 0 END;
  WITH receitas_por_cliente AS (
    SELECT cliente_id, cliente_nome, SUM(COALESCE(valor_pago, valor)) AS total FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status='recebido' AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days'
      AND cliente_id IS NOT NULL GROUP BY cliente_id, cliente_nome),
  totais AS (SELECT SUM(total) AS total_geral FROM receitas_por_cliente)
  SELECT cliente_nome, ROUND((total / NULLIF(total_geral, 0)) * 100, 0) INTO v_top_cliente_nome, v_concentracao_pct
  FROM receitas_por_cliente, totais ORDER BY total DESC LIMIT 1;
  v_concentracao_pct := COALESCE(v_concentracao_pct, 0);
  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_inadimplencia_qtd, v_inadimplencia_valor
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE;
  WITH base AS (SELECT SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status IN ('aberto','vencido') THEN valor ELSE 0 END) AS vencido,
           SUM(valor) AS total FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id)
  SELECT ROUND((vencido / NULLIF(total, 0)) * 100, 0) INTO v_inadimplencia_pct FROM base;
  v_inadimplencia_pct := COALESCE(v_inadimplencia_pct, 0);
  v_score := LEAST(100, GREATEST(0, LEAST(40, ROUND(v_meses_caixa * 7))::int +
    GREATEST(0, 30 - (v_inadimplencia_pct * 0.5))::int + GREATEST(0, 30 - (v_concentracao_pct * 0.3))::int));
  IF v_saldo_total < 0 THEN v_score := LEAST(v_score, 15); END IF;
  v_classificacao := CASE WHEN v_score >= 70 THEN 'BOA' WHEN v_score >= 40 THEN 'ATENÇÃO' ELSE 'CRÍTICA' END;
  v_cor := CASE WHEN v_score >= 70 THEN 'verde' WHEN v_score >= 40 THEN 'amarelo' ELSE 'vermelho' END;
  v_frase_1 := CASE
    WHEN v_saldo_total < 0 THEN 'Caixa NEGATIVO: R$ ' || TO_CHAR(v_saldo_total, 'FM999G999G990D00')
    WHEN v_meses_caixa = 0 THEN 'Sem histórico de pagamentos pra calcular meses de caixa'
    WHEN v_meses_caixa >= 6 THEN 'Caixa cobre ' || v_meses_caixa || ' meses de operação'
    WHEN v_meses_caixa >= 3 THEN 'Caixa cobre ' || v_meses_caixa || ' meses (atenção)'
    ELSE 'Caixa cobre só ' || v_meses_caixa || ' meses (crítico)' END;
  v_frase_2 := CASE WHEN v_inadimplencia_qtd = 0 THEN 'Inadimplência zerada'
    ELSE 'Inadimplência: ' || v_inadimplencia_qtd || ' contas · R$ ' || TO_CHAR(v_inadimplencia_valor, 'FM999G999G990D00') END;
  v_frase_3 := CASE WHEN v_top_cliente_nome IS NULL THEN 'Sem dados de concentração de receita ainda'
    WHEN v_concentracao_pct >= 50 THEN 'Concentração alta: ' || v_top_cliente_nome || ' representa ' || v_concentracao_pct || '%'
    WHEN v_concentracao_pct >= 30 THEN 'Maior cliente (' || v_top_cliente_nome || ') = ' || v_concentracao_pct || '% da receita'
    ELSE 'Carteira diversificada (maior cliente = ' || v_concentracao_pct || '%)' END;
  RETURN jsonb_build_object('score', v_score, 'classificacao', v_classificacao, 'cor_semaforo', v_cor,
    'meses_caixa', v_meses_caixa, 'saldo_total', v_saldo_total, 'inadimplencia_pct', v_inadimplencia_pct,
    'inadimplencia_qtd', v_inadimplencia_qtd, 'inadimplencia_valor', v_inadimplencia_valor,
    'concentracao_pct', v_concentracao_pct, 'top_cliente_nome', v_top_cliente_nome,
    'frases', jsonb_build_array(v_frase_1, v_frase_2, v_frase_3));
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_saude_financeira(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_saude_financeira(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_ge_top_inadimplentes(p_company_id uuid, p_limit integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_top jsonb;
  v_total_atrasados int;
  v_total_valor numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH atrasados AS (
    SELECT
      r.cliente_id,
      r.cliente_nome AS nome_pessoa,
      MAX(CURRENT_DATE - r.data_vencimento)::int AS dias_max_atraso,
      SUM(r.valor) AS valor_total,
      COUNT(*) AS qtd_lancamentos
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) r
    WHERE r.company_id = p_company_id
      AND r.status NOT IN ('recebido', 'pago')
      AND COALESCE(r.status, '') != 'orcamento'
      AND r.data_vencimento < CURRENT_DATE
    GROUP BY r.cliente_id, r.cliente_nome
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'cliente_id', cliente_id,
        'nome', nome_pessoa,
        'iniciais', UPPER(LEFT(SPLIT_PART(COALESCE(nome_pessoa, '?'), ' ', 1), 1) || COALESCE(LEFT(SPLIT_PART(COALESCE(nome_pessoa, ''), ' ', 2), 1), '')),
        'dias_atraso', dias_max_atraso,
        'valor_total', valor_total,
        'qtd_lancamentos', qtd_lancamentos,
        'score', NULL
      )
      ORDER BY dias_max_atraso DESC
    ), '[]'::jsonb),
    COUNT(*)::int,
    COALESCE(SUM(valor_total), 0)
  INTO v_top, v_total_atrasados, v_total_valor
  FROM (
    SELECT * FROM atrasados ORDER BY dias_max_atraso DESC LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'top', v_top,
    'total_atrasados', v_total_atrasados,
    'total_valor', v_total_valor,
    'qtd_total_clientes_atrasados', (
      SELECT COUNT(DISTINCT cliente_id)
      FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
      WHERE company_id = p_company_id
        AND status NOT IN ('recebido', 'pago')
        AND COALESCE(status, '') != 'orcamento'
        AND data_vencimento < CURRENT_DATE
    )
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_ge_top_inadimplentes(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_top_inadimplentes(uuid, integer) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_hub_fiscal_resumo(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dados jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT jsonb_build_object(
    'nfse_emitidas', jsonb_build_object(
      'total', nfse_total, 'autorizadas', nfse_autorizadas,
      'processando', nfse_processando, 'erros', nfse_erros,
      'autorizadas_mes', nfse_autorizadas_mes,
      'valor_total', nfse_valor_total, 'valor_mes', nfse_valor_mes
    ),
    'nfe_emitidas', jsonb_build_object(
      'total', nfe_total, 'autorizadas', nfe_autorizadas,
      'processando', nfe_processando, 'erros', nfe_erros,
      'autorizadas_mes', nfe_autorizadas_mes,
      'valor_total', nfe_valor_total, 'valor_mes', nfe_valor_mes
    ),
    'pendencias', jsonb_build_object(
      'total_processando', total_processando, 'total_erros', total_erros
    ),
    'configuracao', jsonb_build_object(
      'focus_configurado', focus_configurado,
      'ambiente', ambiente,
      'proxima_numeracao_nfse', proxima_numeracao_nfse,
      'proxima_numeracao_nfe', proxima_numeracao_nfe
    ),
    'storage', (
      SELECT jsonb_build_object(
        'nfse_armazenadas', (SELECT COUNT(*) FROM erp_nfse_emitidas WHERE company_id = p_company_id AND xml_storage_path IS NOT NULL),
        'nfe_armazenadas', (SELECT COUNT(*) FROM erp_nfe_emitidas WHERE company_id = p_company_id AND xml_storage_path IS NOT NULL),
        'pendentes_fila', (SELECT COUNT(*) FROM erp_fiscal_storage_queue WHERE company_id = p_company_id AND processado = false)
      )
    )
  ) INTO v_dados
  FROM v_hub_fiscal_cards
  WHERE company_id = p_company_id;
  
  IF v_dados IS NULL THEN
    RETURN jsonb_build_object(
      'nfse_emitidas', jsonb_build_object('total',0,'autorizadas',0,'processando',0,'erros',0,'autorizadas_mes',0,'valor_total',0,'valor_mes',0),
      'nfe_emitidas', jsonb_build_object('total',0,'autorizadas',0,'processando',0,'erros',0,'autorizadas_mes',0,'valor_total',0,'valor_mes',0),
      'pendencias', jsonb_build_object('total_processando',0,'total_erros',0),
      'configuracao', jsonb_build_object('focus_configurado',false,'ambiente',null,'proxima_numeracao_nfse',1,'proxima_numeracao_nfe',1),
      'storage', jsonb_build_object('nfse_armazenadas',0,'nfe_armazenadas',0,'pendentes_fila',0)
    );
  END IF;
  
  RETURN v_dados;
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_hub_fiscal_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_fiscal_resumo(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_inadimplentes_por_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atrasadas jsonb;
  v_andamento jsonb;
  v_resolvidas jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'total_valor', COALESCE(SUM(er.valor), 0),
    'agrupado_cliente', COALESCE((
      SELECT jsonb_agg(cliente_data) FROM (
        SELECT jsonb_build_object(
          'cliente_id', MAX(er.cliente_id::text)::uuid,
          -- nome do cadastro; se não houver, o nome gravado no título; nunca "(sem nome)".
          'cliente_nome', COALESCE(MAX(cli.nome_fantasia), MAX(cli.razao_social), NULLIF(TRIM(MAX(er.cliente_nome)), ''), 'Cliente sem cadastro'),
          'cliente_cpf_cnpj', COALESCE(MAX(cli.cpf_cnpj), MAX(cli.cnpj_cpf)),
          'cliente_telefone', MAX(cli.telefone),
          'cliente_celular', MAX(cli.celular),
          'cliente_whatsapp', MAX(cli.whatsapp),
          'cliente_email', MAX(cli.email),
          'qtd_contas', COUNT(er.id),
          'total_valor', SUM(er.valor),
          'contas', jsonb_agg(jsonb_build_object(
            'id', er.id,
            'descricao', er.descricao,
            'vencimento', er.data_vencimento,
            'valor', er.valor,
            'dias_atraso', (CURRENT_DATE - er.data_vencimento)
          ) ORDER BY er.data_vencimento)
        ) AS cliente_data
        FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
        LEFT JOIN erp_clientes cli ON cli.id = er.cliente_id
        WHERE er.company_id = p_company_id
          AND er.data_vencimento < CURRENT_DATE
          AND er.status NOT IN ('pago', 'recebido', 'cancelado')
          AND COALESCE(er.em_renegociacao, false) = false
        -- com cadastro: agrupa por cliente_id; sem cadastro: agrupa pelo nome do título (cada um no seu grupo).
        GROUP BY COALESCE(er.cliente_id::text, 'nome:' || lower(trim(COALESCE(er.cliente_nome, ''))))
      ) sub
    ), '[]'::jsonb)
  ) INTO v_atrasadas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND COALESCE(er.em_renegociacao, false) = false;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor), 0))
  INTO v_andamento
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND COALESCE(er.em_renegociacao, false) = true;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor_pago), 0))
  INTO v_resolvidas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.status IN ('pago', 'recebido')
    AND er.data_pagamento > er.data_vencimento
    AND er.data_pagamento > CURRENT_DATE - INTERVAL '90 days';

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'atrasadas', v_atrasadas,
    'em_andamento', v_andamento,
    'resolvidas', v_resolvidas
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_inadimplentes_por_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_inadimplentes_por_status(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_listar(p_company_id uuid, p_cpf text, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn_nr36_pode_subir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao', 'anexos', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'arquivo_path', arquivo_path, 'arquivo_nome', arquivo_nome, 'enviado_em', enviado_em
         ) ORDER BY enviado_em DESC), '[]'::jsonb)
    INTO v
    FROM public.nr36_conferencia_anexo
   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data AND removido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'anexos', v);
END $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_onboarding_maturidade(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_contas int;
  v_total_clientes int;
  v_total_lancamentos int;
  v_total_orcamentos int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COUNT(*) INTO v_total_contas FROM erp_banco_contas WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_clientes FROM erp_clientes WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_lancamentos FROM erp_pagar WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_orcamentos FROM erp_orcamentos WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'eh_madura', v_total_contas >= 1 AND v_total_clientes >= 3 AND v_total_lancamentos >= 10,
    'contas', v_total_contas,
    'clientes', v_total_clientes,
    'lancamentos', v_total_lancamentos,
    'orcamentos', v_total_orcamentos,
    'pct_maturidade', LEAST(100,
      ((LEAST(v_total_contas,1)::float / 1 * 33) +
       (LEAST(v_total_clientes,3)::float / 3 * 33) +
       (LEAST(v_total_lancamentos,10)::float / 10 * 34))::int
    )
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_onboarding_maturidade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_maturidade(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_psgc_painel_operacional(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_fim_30d date := CURRENT_DATE + INTERVAL '30 days';
  v_fim_mes date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_receber_vencidos jsonb; v_receber_hoje jsonb; v_receber_30d jsonb; v_receber_mes jsonb;
  v_pagar_vencidos jsonb; v_pagar_hoje jsonb; v_pagar_30d jsonb; v_pagar_mes jsonb;
  v_saldos_bancarios jsonb; v_saldo_total numeric;
  v_conciliacoes_qtd int; v_conciliacoes_valor numeric; v_alertas_imediatos jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(_cid) FROM unnest(p_company_ids) AS _cid;
  IF p_company_ids IS NULL OR array_length(p_company_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('erro', 'sem_empresas');
  END IF;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_receber_vencidos FROM (
    SELECT cliente_nome, valor, data_vencimento FROM v_receber_efetivo
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_receber_hoje FROM (
    SELECT cliente_nome, valor FROM v_receber_efetivo
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_30d
  FROM v_receber_efetivo WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes
  FROM v_receber_efetivo WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_pagar_vencidos FROM (
    SELECT fornecedor_nome, valor, data_vencimento FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_pagar_hoje FROM (
    SELECT fornecedor_nome, valor FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_30d
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_mes
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));

  SELECT COALESCE(SUM(COALESCE(saldo_atual,0)),0) INTO v_saldo_total
  FROM erp_banco_contas WHERE company_id = ANY(p_company_ids) AND ativo = true AND COALESCE(soma_no_saldo, true) = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conta', bc.nome,
      'saldo', ROUND(COALESCE(bc.saldo_atual,0), 2),
      'entradas_acum', 0, 'saidas_acum', 0, 'ultima_movimentacao', bc.updated_at
    ) ORDER BY bc.nome), '[]'::jsonb)
  INTO v_saldos_bancarios
  FROM erp_banco_contas bc WHERE bc.company_id = ANY(p_company_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true;

  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_conciliacoes_qtd, v_conciliacoes_valor
  FROM (
    SELECT valor FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL AND deleted_at IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    UNION ALL
    SELECT valor FROM v_receber_efetivo WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL AND deleted_at IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
  ) pendentes;
  WITH criticos AS (
    SELECT 'pagar' AS tipo, 'critico' AS severidade, fornecedor_nome AS pessoa, valor, data_vencimento,
      (CURRENT_DATE - data_vencimento) AS dias_atraso,
      CASE WHEN (CURRENT_DATE - data_vencimento) > 90 THEN '🚨 Vencido há +90 dias — risco de protesto'
           WHEN (CURRENT_DATE - data_vencimento) > 30 THEN '⚠️ Vencido há +30 dias — juros/multa acumulando'
           ELSE '📅 Vencido recentemente' END AS mensagem
    FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC, valor DESC LIMIT 5)
  SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'severidade', severidade, 'pessoa', pessoa,
    'valor', valor, 'vencimento', data_vencimento, 'dias_atraso', dias_atraso, 'mensagem', mensagem))
  INTO v_alertas_imediatos FROM criticos;
  RETURN jsonb_build_object('gerado_em', NOW(), 'data_referencia', v_hoje,
    'empresas_consideradas', array_length(p_company_ids, 1),
    'cards_hero', jsonb_build_object(
      'receber_vencidos', v_receber_vencidos, 'receber_hoje', v_receber_hoje,
      'receber_30d', v_receber_30d, 'receber_resto_mes', v_receber_mes,
      'pagar_vencidos', v_pagar_vencidos, 'pagar_hoje', v_pagar_hoje,
      'pagar_30d', v_pagar_30d, 'pagar_resto_mes', v_pagar_mes),
    'saldos_bancarios', jsonb_build_object(
      'total', COALESCE(ROUND(v_saldo_total::numeric, 2), 0),
      'qtd_contas', COALESCE(jsonb_array_length(v_saldos_bancarios), 0),
      'contas', COALESCE(v_saldos_bancarios, '[]'::jsonb)),
    'conciliacoes_pendentes', jsonb_build_object('qtd', v_conciliacoes_qtd, 'valor_estimado', ROUND(v_conciliacoes_valor::numeric, 2)),
    'alertas_imediatos', COALESCE(v_alertas_imediatos, '[]'::jsonb));
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_psgc_painel_operacional(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_psgc_painel_operacional(uuid[]) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_rateio_base(p_company_id uuid, p_data_ref date)
 RETURNS TABLE(business_line_id uuid, nome text, base numeric, percentual numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver text; v_incluir boolean; v_ini date; v_fim date;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(driver,'receita'), COALESCE(incluir_area_improdutiva,false)
    INTO v_driver, v_incluir
  FROM rateio_config_empresa WHERE company_id = p_company_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  v_driver := COALESCE(v_driver, 'receita');
  v_incluir := COALESCE(v_incluir, false);
  v_ini := date_trunc('month', p_data_ref)::date;
  v_fim := (date_trunc('month', p_data_ref) + interval '1 month - 1 day')::date;

  RETURN QUERY
  WITH _rb(bl, vbase) AS (
    SELECT pa.business_line_id, SUM(pa.area_ha)
    FROM erp_propriedade_area pa
    WHERE v_driver = 'area' AND pa.company_id = p_company_id AND pa.ativo AND pa.entra_rateio
      AND pa.business_line_id IS NOT NULL
      AND (v_incluir OR pa.uso NOT IN ('reserva_legal','app','infraestrutura'))
    GROUP BY pa.business_line_id
    UNION ALL
    SELECT pa.business_line_id, SUM(COALESCE(cua.ua_valor,1.0))
    FROM erp_pec_animal an
    JOIN erp_propriedade_area pa ON pa.id = an.area_atual_id AND pa.business_line_id IS NOT NULL
    LEFT JOIN erp_pec_categoria_ua cua ON cua.company_id = an.company_id AND cua.categoria = an.categoria
    WHERE v_driver = 'ua' AND an.company_id = p_company_id AND an.ativo
    GROUP BY pa.business_line_id
    UNION ALL
    SELECT bl.id, bl.headcount::numeric
    FROM business_lines bl
    WHERE v_driver = 'headcount' AND bl.company_id = p_company_id
      AND COALESCE(bl.is_active,true) AND COALESCE(bl.headcount,0) > 0
    UNION ALL
    SELECT bl.id, SUM(COALESCE(r.valor_pago, r.valor, 0))
    FROM erp_receber r
    JOIN business_lines bl ON bl.company_id = r.company_id
      AND (lower(bl.name) = lower(btrim(r.linha_negocio)) OR bl.ln_number::text = btrim(r.linha_negocio))
    WHERE v_driver = 'receita' AND r.company_id = p_company_id AND r.status IN ('recebido','pago')
      AND COALESCE(r.data_pagamento, r.data_vencimento) BETWEEN v_ini AND v_fim
    GROUP BY bl.id
    UNION ALL
    SELECT (kv.key)::uuid, (kv.value)::numeric
    FROM rateio_regras rr, jsonb_each_text(rr.distribuicao) kv
    WHERE v_driver = 'manual' AND rr.company_id = p_company_id AND COALESCE(rr.ativo,true)
      AND kv.key ~ '^[0-9a-fA-F-]{36}$'
  ),
  tot AS (SELECT SUM(vbase) t FROM _rb WHERE vbase > 0),
  r AS (
    SELECT _rb.bl, _rb.vbase,
      ROUND(100 * _rb.vbase / NULLIF((SELECT t FROM tot), 0), 2) AS pct,
      ROW_NUMBER() OVER (ORDER BY _rb.vbase DESC) AS rn
    FROM _rb WHERE _rb.vbase > 0
  ),
  adj AS (
    SELECT r.bl, r.vbase,
      r.pct + CASE WHEN r.rn = 1 THEN (100 - (SELECT SUM(pct) FROM r)) ELSE 0 END AS pct
    FROM r
  )
  SELECT adj.bl, bl.name, adj.vbase, adj.pct
  FROM adj JOIN business_lines bl ON bl.id = adj.bl
  ORDER BY adj.vbase DESC;
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_rateio_base(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rateio_base(uuid, date) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_remessa_extrato(p_remessa_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rem record; v_itens jsonb; v_total numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', i.id, 'erp_pagar_id', i.erp_pagar_id, 'forma', i.forma,
            'beneficiario', COALESCE(NULLIF(f.razao_social,''), NULLIF(f.nome_fantasia,''), p.descricao, '—'),
            'descricao', p.descricao, 'data_vencimento', p.data_vencimento,
            'valor', i.valor, 'status_item', i.status_item, 'ocorrencia', i.ocorrencia_retorno)
            ORDER BY p.data_vencimento NULLS LAST), '[]'::jsonb),
         COALESCE(sum(i.valor), 0)
    INTO v_itens, v_total
  FROM public.erp_remessa_pagamento_item i
  LEFT JOIN public.erp_pagar p ON p.id = i.erp_pagar_id
  LEFT JOIN public.erp_fornecedores f ON f.id = p.fornecedor_id
  WHERE i.remessa_id = p_remessa_id AND i.removido_em IS NULL;

  RETURN jsonb_build_object('sucesso', true,
    'remessa', jsonb_build_object('id', v_rem.id, 'numero_sequencial', v_rem.numero_sequencial,
      'status', v_rem.status, 'ambiente', v_rem.ambiente, 'arquivo_nome', v_rem.arquivo_nome,
      'gerado_em', v_rem.gerado_em, 'retorno_importado_em', v_rem.retorno_importado_em),
    'itens', v_itens, 'total', v_total, 'qtd', jsonb_array_length(v_itens));
END; $function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_remessa_extrato(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_remessa_extrato(uuid, uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_saldo_bancos_dinamico(p_company_ids uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn__guarda_empresa(_cid) FROM unnest(p_company_ids) AS _cid;
  SELECT COALESCE(SUM(g.saldo_gerencial), 0)
  FROM public.fn_saldo_gerencial_contas(p_company_ids) g
  WHERE g.conta_id IS NOT NULL AND g.soma_no_saldo = true;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_saldo_bancos_dinamico(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_bancos_dinamico(uuid[]) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_saude_alertas_proativos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_despesa_mensal numeric;
  v_meses_caixa numeric;
  v_inadimplencia_pct numeric;
  v_concentracao_cliente jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]);
  
  SELECT COALESCE(SUM(valor_pago), 0) / 3.0 INTO v_despesa_mensal
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar 
  WHERE company_id = p_company_id 
    AND data_pagamento > CURRENT_DATE - INTERVAL '90 days'
    AND status = 'pago';
  
  v_meses_caixa := CASE WHEN v_despesa_mensal > 0 
                        THEN v_saldo / v_despesa_mensal 
                        ELSE NULL END;
  
  -- Alerta 1 · Meses de caixa
  IF v_meses_caixa IS NOT NULL AND v_meses_caixa < 1 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Caixa baixo',
      'mensagem', FORMAT('Você tem menos de 1 mês de caixa (%s meses). Risco operacional alto.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Reduza despesas não-essenciais E acelere recebimentos.'
    );
  ELSIF v_meses_caixa IS NOT NULL AND v_meses_caixa < 3 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Reserva limitada',
      'mensagem', FORMAT('Você tem %s meses de caixa. Recomendado: pelo menos 3 meses.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Considere reservar % do faturamento mensal.'
    );
  END IF;
  
  -- Alerta 2 · Inadimplência
  SELECT 
    CASE WHEN SUM(valor) > 0 
         THEN SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status NOT IN ('pago','recebido','cancelado') THEN valor ELSE 0 END) * 100.0 / SUM(valor)
         ELSE 0 END
  INTO v_inadimplencia_pct
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id;
  
  IF v_inadimplencia_pct > 10 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Inadimplência alta',
      'mensagem', FORMAT('%s%% da carteira está inadimplente.', ROUND(v_inadimplencia_pct, 1)),
      'acao_sugerida', 'Priorize cobrança ativa nas atrasadas acima de 30 dias.'
    );
  END IF;
  
  -- Alerta 3 · Concentração receita (top cliente > 40%)
  WITH receita_cliente AS (
    SELECT cliente_id, SUM(valor) AS total
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id
      AND data_pagamento > CURRENT_DATE - INTERVAL '90 days'
      AND status IN ('pago', 'recebido')
    GROUP BY cliente_id
  ),
  total_receita AS (
    SELECT SUM(total) AS total FROM receita_cliente
  )
  SELECT jsonb_build_object(
    'cliente_top_id', cliente_id,
    'pct', ROUND(total / NULLIF((SELECT total FROM total_receita), 0) * 100, 1)
  )
  INTO v_concentracao_cliente
  FROM receita_cliente
  ORDER BY total DESC
  LIMIT 1;
  
  IF (v_concentracao_cliente ->> 'pct')::numeric > 40 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Concentração de receita',
      'mensagem', FORMAT('Top cliente representa %s%% da receita. Risco de dependência.', v_concentracao_cliente ->> 'pct'),
      'acao_sugerida', 'Diversifique base de clientes.'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_atual', v_saldo,
    'despesa_mensal_media', v_despesa_mensal,
    'meses_caixa', v_meses_caixa,
    'inadimplencia_pct', v_inadimplencia_pct,
    'concentracao_top_cliente', v_concentracao_cliente,
    'total_alertas', jsonb_array_length(v_alertas),
    'alertas', v_alertas
  );
END;
$function$;
-- Trava de grants (revisor #4117 · segurança RLS/LGPD): fecha o caminho anon do NULL-auth.uid() do guard.
REVOKE ALL ON FUNCTION public.fn_saude_alertas_proativos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saude_alertas_proativos(uuid) TO authenticated, service_role;


