-- PDCA GE · /dashboard/gestao-empresarial/balanco-patrimonial (auditor_pdca_2, aud8 55/95)
-- gap2 (critério b "dado não carrega → redigitar é gap"): o PATRIMÔNIO LÍQUIDO vinha 100% manual
-- (Capital social / Reservas / Resultado acumulado = origem "ausente"), então o balanço nunca fechava
-- com dado próprio e o usuário via a diferença sem saber o que fazer.
--
-- O sistema JÁ apura o resultado (receitas − despesas do exercício). Esta migration faz o balanço
-- trazer UMA linha de PL CALCULADA — "Resultado do exercício (apurado)" — a partir do resultado do
-- sistema (fn_ge_resultado_por_negocio_calc.total_empresa, do início do ano até a data de referência,
-- regime competência). Capital social / Reservas / Resultado acumulado seguem MANUAIS (vêm do contrato
-- social e de exercícios anteriores), como o auditor pediu.
--
-- ADITIVA / read-only: só CREATE OR REPLACE da função de leitura (STABLE), sem tocar dado de cliente.
-- A fonte (fn_ge_resultado_por_negocio_calc) é STABLE e sem escrita (provado). A chamada é envolvida em
-- BEGIN/EXCEPTION para o balanço NUNCA quebrar caso a apuração falhe (linha apenas não aparece).
-- RD-38 provado no dado (dif_antes → resultado → dif_depois):
--   GE-DEMO  555768.21 → +11314.03 → 544454.18
--   Pdois   -499071.04 → -467743.09 → -31327.95  (quase fecha)
--   Gean     116008.63 → -175207.42 → 291216.05  (prejuízo: PL cai — contabilmente correto)
--   Tryo   -6392737.42 → -2659575.75 → -3733161.67

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
  v_res_exerc numeric;  -- gap2: resultado do exercício apurado pelo sistema (linha de PL calculada)
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_caixa := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  -- FIX: exclui títulos soft-deleted do recebível (espelha o tratamento de erp_pagar abaixo).
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_receber
    FROM v_receber_efetivo WHERE company_id=p_company_id AND deleted_at IS NULL AND status NOT IN ('recebido','pago','cancelado','orcamento');
  SELECT COALESCE(SUM(COALESCE(estoque_atual,0) * COALESCE(preco_custo_medio, preco_custo, 0)),0) INTO v_estoque
    FROM erp_produtos WHERE company_id=p_company_id AND COALESCE(ativo,true);
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_forn
    FROM erp_pagar WHERE company_id=p_company_id AND deleted_at IS NULL AND status NOT IN ('pago','cancelado') AND data_vencimento <= v_lim_circ;
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_forn_lp
    FROM erp_pagar WHERE company_id=p_company_id AND deleted_at IS NULL AND status NOT IN ('pago','cancelado') AND data_vencimento > v_lim_circ;
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

  -- gap2 (auditor_pdca_2): PL ganha UMA linha CALCULADA — "Resultado do exercício (apurado)" — vinda do
  -- resultado do próprio sistema (receitas − despesas do exercício, competência, do início do ano até a
  -- data de referência). Lucro aumenta o PL; prejuízo reduz. Assim o balanço deixa de depender só de
  -- digitação para a parcela que o sistema sabe calcular. Capital social / Reservas / Resultado acumulado
  -- (exercícios anteriores) continuam manuais, pela sugestão de template mais abaixo.
  -- Blindado por BEGIN/EXCEPTION: se a apuração falhar, a linha apenas não aparece e o balanço não quebra.
  BEGIN
    SELECT (fn_ge_resultado_por_negocio_calc(
              p_company_id, date_trunc('year', p_data_ref)::date, p_data_ref, 'competencia'
            ) ->> 'total_empresa')::numeric
      INTO v_res_exerc;
  EXCEPTION WHEN OTHERS THEN
    v_res_exerc := NULL;
  END;
  IF v_res_exerc IS NOT NULL THEN
    v_linhas := v_linhas || jsonb_build_object(
      'lado','pl','grupo','PATRIMÔNIO LÍQUIDO','nome','Resultado do exercício (apurado)',
      'valor',ROUND(v_res_exerc,2),'origem','calculado','editavel',false,
      'fonte','resultado por negócio (receitas − despesas do exercício, competência)');
    v_pl := v_pl + v_res_exerc;
  END IF;

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
