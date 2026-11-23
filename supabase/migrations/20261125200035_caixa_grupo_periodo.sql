-- Caixa do grupo · seletor de PERÍODO (Pdois/Julia). Generaliza o fn_caixa_grupo_mes: recebe p_ini/p_fim
-- (hoje, últimos 7 dias, esta semana, este mês, ou personalizado) e soma as baixas BRUTAS do intervalo.
-- fn_caixa_grupo_mes continua existindo (caso particular p_ini = date_trunc('month', p_fim)); a tela passa a
-- chamar a _periodo. Função NOVA aditiva de leitura, mesma trava fail-closed/RLS por empresa das outras duas,
-- REVOKE anon. "Em aberto" é na data final (p_fim), mesmo predicado do fn_caixa_grupo_dia (não recalcular diferente).

CREATE OR REPLACE FUNCTION public.fn_caixa_grupo_periodo(p_company_ids uuid[], p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_empresas jsonb;
  v_cons jsonb;
BEGIN
  -- Fail-closed por empresa: sem JWT = chamada interna; service_role passa; logado só vê as suas (RLS).
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', '[]'::jsonb,
      'consolidado', jsonb_build_object('recebido_bruto',0,'pago_bruto',0,'a_receber_aberto',0,'a_pagar_aberto',0));
  END IF;

  WITH rb AS (  -- recebido BRUTO do período por empresa = soma das baixas de receber (p_ini → p_fim)
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_receber_baixa b
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
     GROUP BY b.company_id
  ),
  pb AS (  -- pago BRUTO do período por empresa = soma das baixas de pagar (p_ini → p_fim)
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_pagar_baixa b
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
     GROUP BY b.company_id
  ),
  ar AS (  -- a receber em aberto na data final (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT er.company_id AS cid, COALESCE(SUM(GREATEST(er.valor - COALESCE(er.valor_pago,0),0)),0) AS v
      FROM erp_receber er
     WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
       AND er.status NOT IN ('cancelado','recebido','pago')
       AND GREATEST(er.valor - COALESCE(er.valor_pago,0),0) > 0.005
       AND er.data_vencimento <= p_fim + 7
     GROUP BY er.company_id
  ),
  ap AS (  -- a pagar em aberto na data final (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT ep.company_id AS cid, COALESCE(SUM(GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0)),0) AS v
      FROM erp_pagar ep
     WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
       AND ep.status NOT IN ('cancelado','pago')
       AND GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0) > 0.005
       AND ep.data_vencimento <= p_fim + 7
     GROUP BY ep.company_id
  ),
  ef AS (  -- todas as empresas do grupo viram linha (mesmo sem movimento), igual às outras
    SELECT co.id AS cid, coalesce(co.nome_fantasia, co.razao_social) AS nome,
           round(COALESCE(rb.v,0),2) AS recebido_bruto, round(COALESCE(pb.v,0),2) AS pago_bruto,
           round(COALESCE(ar.v,0),2) AS a_receber_aberto, round(COALESCE(ap.v,0),2) AS a_pagar_aberto
      FROM unnest(v_ids) AS vid
      JOIN companies co ON co.id = vid
      LEFT JOIN rb ON rb.cid = vid LEFT JOIN pb ON pb.cid = vid
      LEFT JOIN ar ON ar.cid = vid LEFT JOIN ap ON ap.cid = vid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'company_id', ef.cid, 'nome', ef.nome,
      'recebido_bruto', ef.recebido_bruto, 'pago_bruto', ef.pago_bruto,
      'a_receber_aberto', ef.a_receber_aberto, 'a_pagar_aberto', ef.a_pagar_aberto) ORDER BY ef.nome), '[]'::jsonb),
    jsonb_build_object(
      'recebido_bruto', round(COALESCE(SUM(ef.recebido_bruto),0),2),
      'pago_bruto', round(COALESCE(SUM(ef.pago_bruto),0),2),
      'a_receber_aberto', round(COALESCE(SUM(ef.a_receber_aberto),0),2),
      'a_pagar_aberto', round(COALESCE(SUM(ef.a_pagar_aberto),0),2))
  INTO v_empresas, v_cons
  FROM ef;

  RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', v_empresas, 'consolidado', v_cons);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_caixa_grupo_periodo(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_caixa_grupo_periodo(uuid[], date, date) TO authenticated, service_role;

-- RD-95: "?" do seletor de período, do rótulo do intervalo e dos indicadores do período (linguagem da Julia).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('financeiro.caixa_grupo.periodo', '/dashboard/financeiro/caixa-grupo', 'Filtros', 'Período',
  'Escolha o intervalo que você quer somar: Hoje, Últimos 7 dias, Esta semana, Este mês (padrão) ou Personalizado (De/Até).',
  'Define o intervalo dos Recebidos e Pagos. O rótulo ao lado mostra sempre o intervalo real que está sendo somado.',
  '"Este mês" com hoje = 23/11 soma de 01/11 a 23/11.', 'Escolher uma data única e achar que é o mês (use "Este mês").',
  'gestao_empresarial', 1, 1, 'publicado'),
 ('financeiro.caixa_grupo.intervalo', '/dashboard/financeiro/caixa-grupo', 'Filtros', 'Intervalo (período)',
  'Mostra o intervalo efetivo que está somado agora (ex.: "01/11 a 23/11").',
  'Deixa explícito o que a tela está somando — acaba a dúvida de "por que está zerado".',
  '"Período: 01/11 a 23/11".', 'Confundir o intervalo com a data do saldo.',
  'gestao_empresarial', 2, 1, 'publicado'),
 ('financeiro.caixa_grupo.recebido_periodo', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Recebidos no período',
  'Soma de tudo que ENTROU na conta no período escolhido — valor bruto, sem descontar nada.',
  'Confere com o seu outro sistema; o padrão é do dia 1 do mês até hoje, mas você escolhe hoje, a semana ou um intervalo.',
  'De 01/11 a 23/11: R$ 152.566,47 recebidos (grupo).', 'Comparar com o líquido (aqui é bruto: a soma das baixas).',
  'gestao_empresarial', 22, 1, 'publicado'),
 ('financeiro.caixa_grupo.pago_periodo', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Pagos no período',
  'Soma de tudo que SAIU da conta no período escolhido — valor bruto, sem descontar nada.',
  'Confere com o seu outro sistema; muda junto com o período escolhido no topo.',
  'De 01/11 a 23/11: R$ 120.683,39 pagos (grupo).', 'Comparar com o líquido (aqui é bruto: a soma das baixas).',
  'gestao_empresarial', 23, 1, 'publicado'),
 ('financeiro.caixa_grupo.resultado_periodo', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Resultado do período',
  'Recebidos no período menos Pagos no período (bruto). Positivo = entrou mais do que saiu.',
  'Mostra, de forma direta, se o caixa do período foi positivo ou negativo.',
  'R$ 152.566,47 − R$ 120.683,39 = R$ 31.883,08.', 'Confundir com o saldo da conta (isso é fluxo do período, não saldo).',
  'gestao_empresarial', 24, 1, 'publicado'),
 ('financeiro.caixa_grupo.posicao_aberto', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Posição em aberto',
  'A receber e a pagar ainda em aberto NA DATA FINAL do período (é saldo, ponto no tempo — não acumula no intervalo).',
  'Separa o que ainda está para entrar/sair do que já entrou/saiu (o fluxo do período).',
  'Em 23/11: A receber R$ X, A pagar R$ Y.', 'Somar isso com o fluxo do período (são coisas diferentes).',
  'gestao_empresarial', 25, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
