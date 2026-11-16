-- fn_balanco_patrimonial: deriva o "Resultado acumulado (exercícios anteriores)" no PL
-- Code: code-desenvolvedor-3
--
-- Origem: auditor_pdca_2 (PDCA GE · /dashboard/gestao-empresarial/balanco-patrimonial).
--   O balanço não fecha na DEMO GE (diferença R$ 545.654,18) porque todo o PL de ABERTURA
--   vem 'ausente': o sistema deriva ativo e passivo das fontes operacionais, mas o PL só tinha
--   a linha do "Resultado do exercício" (ano corrente). O resultado dos EXERCÍCIOS ANTERIORES
--   (lucros/prejuízos acumulados) é calculável da MESMA fonte do resultado do exercício.
--
-- FIX (passo 1 do plano do auditor — aditivo, NÃO força fechamento):
--   Acrescenta ao PL a linha CALCULADA "Resultado acumulado (exercícios anteriores)" =
--   fn_ge_resultado_por_negocio_calc(competência, do início da operação até o dia anterior ao
--   início do exercício corrente). Espelha exatamente o padrão da linha "Resultado do exercício
--   (apurado)" já existente (origem='calculado', editavel=false), blindada por BEGIN/EXCEPTION:
--   se a apuração falhar, a linha apenas não aparece e o balanço não quebra.
--   Os períodos NÃO se sobrepõem (acumulado termina em date_trunc('year')-1; exercício começa em
--   date_trunc('year')), então não há dupla contagem; a soma é o lucro retido total.
--   Remove a SUGESTÃO ausente duplicada "Resultado acumulado" do template (agora é calculada);
--   "Capital social" e "Reservas" seguem como linhas editáveis (abertura informada pelo usuário).
--
-- HONESTIDADE CONTÁBIL (RD-38, provado no dado GE-DEMO ...0004): derivar o acumulado reduz a
--   diferença de 545.654,18 para 244.054,18 — NÃO fecha sozinho. O resíduo é o CAPITAL SOCIAL de
--   abertura (ativos de implantação — imobilizado/estoque — que nunca passaram pelo resultado).
--   Esta migration NÃO fabrica fechamento com linha-tampão (seria ficção contábil): acrescenta só
--   o lucro retido REAL e deixa o Capital social como a linha editável honesta da abertura. O
--   fechamento pleno depende da decisão sobre o capital de abertura (seed DEMO / informe do usuário).
--
-- Prova RD-38 (BEGIN..ROLLBACK, GE-DEMO ...0004, CURRENT_DATE): ver prova no PR.
--   antes: pl_total=7.415,27 · diferenca=545.654,18 · fecha=false
--   depois: pl_total=309.015,27 (+301.600,00) · diferenca=244.054,18 · fecha=false (resíduo = capital social)
--   + nova linha PL "Resultado acumulado (exercícios anteriores)"=301.600,00 origem='calculado'.
--
-- Segurança: CREATE OR REPLACE da função existente (STABLE, SECURITY DEFINER, search_path, guarda
--   fn__guarda_empresa — todos preservados). Aditivo: não altera ativo/passivo nem dado de cliente.

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
  v_res_exerc numeric;  -- gap anterior: resultado do exercício apurado pelo sistema (linha de PL calculada)
  v_res_acum numeric;   -- NOVO: resultado acumulado dos exercícios anteriores (lucro retido histórico)
  v_banco numeric := 0;  -- GAP 1: saldo bancário bruto (pode ser negativo = descoberto)
  v_desc numeric := 0;   -- GAP 1: módulo do descoberto reclassificado ao passivo
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- GAP 1: saldo bancário bruto. O sinal negativo (descoberto) NÃO entra no ativo; é reclassificado ao passivo.
  v_banco := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  -- exclui títulos soft-deleted do recebível (espelha o tratamento de erp_pagar abaixo).
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

  -- ATIVO CIRCULANTE: "Caixa e bancos" com piso 0 (GAP 1 — descoberto não deixa o ativo negativo).
  v_linhas := v_linhas
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Caixa e bancos','valor',ROUND(GREATEST(v_banco,0),2),'origem','calculado','editavel',false,'fonte','fn_saldo_bancos_dinamico (saldo positivo; descoberto vai ao passivo)')
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Contas a receber','valor',ROUND(v_receber,2),'origem','calculado','editavel',false,'fonte','erp_receber (em aberto)')
    || jsonb_build_object('lado','ativo','grupo','ATIVO CIRCULANTE','nome','Estoques','valor',ROUND(v_estoque,2),'origem','calculado','editavel',false,'fonte','erp_produtos (estoque×custo médio)');
  v_ativo := v_ativo + GREATEST(v_banco,0) + v_receber + v_estoque;
  v_linhas := v_linhas
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Investimentos','valor',ROUND(v_invest,2),'origem','calculado','editavel',false,'fonte','erp_bem (participacao)')
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Imobilizado bruto','valor',CASE WHEN v_bens=0 THEN NULL ELSE ROUND(v_imob_bruto,2) END,'origem',CASE WHEN v_bens=0 THEN 'ausente' ELSE 'calculado' END,'editavel',false,'fonte','erp_bem','motivo',CASE WHEN v_bens=0 THEN 'nenhum bem cadastrado' ELSE NULL END)
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','(−) Depreciação acumulada','valor',ROUND(-v_dep_acum,2),'origem','calculado','editavel',false,'fonte','erp_bem_depreciacao')
    || jsonb_build_object('lado','ativo','grupo','ATIVO NÃO CIRCULANTE','nome','Intangível (software)','valor',ROUND(v_intang,2),'origem','calculado','editavel',false,'fonte','erp_bem (software)');
  v_ativo := v_ativo + v_invest + v_imob_bruto - v_dep_acum + v_intang;

  -- PASSIVO CIRCULANTE: fornecedores + (GAP 1) descoberto bancário reclassificado.
  v_linhas := v_linhas || jsonb_build_object('lado','passivo','grupo','PASSIVO CIRCULANTE','nome','Fornecedores (≤12m)','valor',ROUND(v_forn,2),'origem','calculado','editavel',false,'fonte','erp_pagar (aberto ≤12m)');
  v_passivo := v_passivo + v_forn;
  v_desc := GREATEST(-v_banco, 0);
  IF v_desc > 0 THEN
    v_linhas := v_linhas || jsonb_build_object('lado','passivo','grupo','PASSIVO CIRCULANTE','nome','Bancos conta garantida (descoberto)','valor',ROUND(v_desc,2),'origem','calculado','editavel',false,'fonte','fn_saldo_bancos_dinamico (saldo negativo reclassificado ao passivo)');
    v_passivo := v_passivo + v_desc;
  END IF;
  v_linhas := v_linhas || jsonb_build_object('lado','passivo','grupo','PASSIVO NÃO CIRCULANTE','nome','Obrigações de longo prazo (>12m)','valor',ROUND(v_forn_lp,2),'origem','calculado','editavel',false,'fonte','erp_pagar (aberto >12m)');
  v_passivo := v_passivo + v_forn_lp;

  -- PL ganha UMA linha CALCULADA — "Resultado do exercício (apurado)" — do resultado do próprio sistema.
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

  -- PL ganha a linha CALCULADA — "Resultado acumulado (exercícios anteriores)" — do lucro retido
  -- histórico (mesma fonte do resultado do exercício, no período anterior ao exercício corrente).
  -- Blindada por BEGIN/EXCEPTION; não força fechamento (o Capital social de abertura segue editável).
  BEGIN
    SELECT (fn_ge_resultado_por_negocio_calc(
              p_company_id, '1900-01-01'::date, (date_trunc('year', p_data_ref) - interval '1 day')::date, 'competencia'
            ) ->> 'total_empresa')::numeric
      INTO v_res_acum;
  EXCEPTION WHEN OTHERS THEN
    v_res_acum := NULL;
  END;
  IF v_res_acum IS NOT NULL AND v_res_acum <> 0 THEN
    v_linhas := v_linhas || jsonb_build_object(
      'lado','pl','grupo','PATRIMÔNIO LÍQUIDO','nome','Resultado acumulado (exercícios anteriores)',
      'valor',ROUND(v_res_acum,2),'origem','calculado','editavel',false,
      'fonte','resultado por negócio dos exercícios anteriores (receitas − despesas, competência)');
    v_pl := v_pl + v_res_acum;
  END IF;

  -- linhas manuais LIVRES (com id/ordem) do período
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',m.id,'lado',m.lado,'grupo',m.grupo,'subgrupo',m.subgrupo,'nome',m.nome,
      'valor',m.valor,'obs',m.obs,'ordem',m.ordem,'origem','manual','editavel',true) ORDER BY m.ordem, m.nome), '[]'::jsonb)
    FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo);

  -- templates AUSENTES (sugestão) só quando não há linha cadastrada
  -- "Resultado acumulado" saiu do template: agora é a linha CALCULADA acima (lucro retido histórico).
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('lado',x.lado,'grupo',x.grupo,'nome',x.nome,'valor',NULL,
        'origem','ausente','editavel',true,'fonte','balanco_patrimonial','motivo',x.nome||' não cadastrado (sugestão)')), '[]'::jsonb)
    FROM (VALUES
      ('ativo','ATIVO CIRCULANTE','Outros circulantes'),('ativo','ATIVO NÃO CIRCULANTE','Realizável a longo prazo'),
      ('passivo','PASSIVO CIRCULANTE','Obrigações fiscais/trabalhistas'),('passivo','PASSIVO CIRCULANTE','Empréstimos curto prazo'),
      ('passivo','PASSIVO NÃO CIRCULANTE','Empréstimos longo prazo'),('pl','PATRIMÔNIO LÍQUIDO','Capital social'),
      ('pl','PATRIMÔNIO LÍQUIDO','Reservas')
    ) AS x(lado,grupo,nome)
    WHERE NOT EXISTS (SELECT 1 FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.lado=x.lado AND m.grupo=x.grupo AND m.nome=x.nome));

  -- totais das manuais (todas as livres do período)
  SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.lado='ativo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='passivo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='pl'),0)
    INTO v_caixa, v_receber, v_estoque FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo;
  v_ativo := v_ativo + v_caixa; v_passivo := v_passivo + v_receber; v_pl := v_pl + v_estoque;

  RETURN jsonb_build_object('ok',true,'data_ref',p_data_ref,'periodo',v_periodo,
    'ativo_total',ROUND(v_ativo,2),'passivo_total',ROUND(v_passivo,2),'pl_total',ROUND(v_pl,2),
    'passivo_mais_pl',ROUND(v_passivo+v_pl,2),'diferenca',ROUND(v_ativo-(v_passivo+v_pl),2),
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,
    -- GAP 2: sinal de balanço TODO ZERO (sem conteúdo real) para a tela mostrar estado vazio em vez do selo "fecha".
    'vazio',(ROUND(v_ativo,2)=0 AND ROUND(v_passivo,2)=0 AND ROUND(v_pl,2)=0),
    'linhas',v_linhas);
END; $function$;
