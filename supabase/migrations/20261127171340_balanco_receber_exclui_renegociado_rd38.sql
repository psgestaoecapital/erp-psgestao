-- fix(gestao-empresarial/balanco-patrimonial · RD-38): "Contas a receber" não conta título renegociado
--
-- GAP (aud8 55/95 "dado não bate com banco", PDCA auditor_pdca_2 23/11):
-- A linha "Contas a receber" somava títulos status='renegociado' (o título MORTO da renegociação)
-- ao mesmo tempo em que soma os boletos de SUBSTITUIÇÃO (status='aberto'). Isso DOBRA o Ativo pelo
-- valor renegociado (ativo-fantasma). O filtro de status não excluía 'renegociado', ao contrário do
-- resto do módulo: fn_fluxo_caixa_diario usa status NOT IN ('pago','recebido','cancelado','renegociado').
-- Essa assimetria é a origem do flag "o Balanço discorda do Fluxo de Caixa e da tela /financeiro/receber".
--
-- PROVA NO DADO (RD-38, 23/11):
--   • DEMO GE (b0700000-…-0004): "Contas a receber" 26.147,28 → 23.177,28 (–2.970,00 de 2 títulos
--     renegociado, renegociacao_id edfce16e-…; os 2 boletos de substituição 'aberto' já entram).
--   • Gean Auto Mecanica (a462e13f-…, is_demo=false): remove R$ 5.520,00 de ativo-fantasma HOJE.
--   • receber com em_renegociacao=true mas status ainda aberto/vencido = 0 em toda a base → NÃO se
--     acrescenta a coluna booleana ao filtro (sem evidência; RD-38 não supõe).
--   • erp_pagar com status='renegociado' = 0 em toda a base → v_forn/v_forn_lp não precisam de ajuste.
--
-- Mudança: aditiva, apenas CREATE OR REPLACE da função (STABLE, SECURITY DEFINER). Não toca dado de cliente.
-- Única diferença em relação à definição viva: acrescenta 'renegociado' ao NOT IN do cálculo de v_receber.

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
  v_res_acum numeric;   -- resultado acumulado dos exercícios anteriores (lucro retido histórico)
  v_banco numeric := 0;  -- GAP 1: saldo bancário bruto (pode ser negativo = descoberto)
  v_desc numeric := 0;   -- GAP 1: módulo do descoberto reclassificado ao passivo
  v_plug numeric := 0;   -- item 1 (17/11): linha-plug de PL "a apurar (fechamento)"
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- GAP 1: saldo bancário bruto. O sinal negativo (descoberto) NÃO entra no ativo; é reclassificado ao passivo.
  v_banco := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  -- exclui títulos soft-deleted do recebível (espelha o tratamento de erp_pagar abaixo).
  -- RD-38 23/11: 'renegociado' é o título MORTO (substituído por boleto novo 'aberto'); conta-lo aqui
  -- dobra o ativo. Simétrico a fn_fluxo_caixa_diario e à tela /financeiro/receber (em aberto).
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_receber
    FROM v_receber_efetivo WHERE company_id=p_company_id AND deleted_at IS NULL AND status NOT IN ('recebido','pago','cancelado','orcamento','renegociado');
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

  -- PL ganha a linha CALCULADA — "Resultado acumulado (exercícios anteriores)".
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

  -- linhas manuais LIVRES (com id/ordem) do período — ignora soft-deletadas (item 3)
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',m.id,'lado',m.lado,'grupo',m.grupo,'subgrupo',m.subgrupo,'nome',m.nome,
      'valor',m.valor,'obs',m.obs,'ordem',m.ordem,'origem','manual','editavel',true) ORDER BY m.ordem, m.nome), '[]'::jsonb)
    FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL);

  -- templates AUSENTES (sugestão) só quando não há linha cadastrada (ignora soft-deletadas)
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('lado',x.lado,'grupo',x.grupo,'nome',x.nome,'valor',NULL,
        'origem','ausente','editavel',true,'fonte','balanco_patrimonial','motivo',x.nome||' não cadastrado (sugestão)')), '[]'::jsonb)
    FROM (VALUES
      ('ativo','ATIVO CIRCULANTE','Outros circulantes'),('ativo','ATIVO NÃO CIRCULANTE','Realizável a longo prazo'),
      ('passivo','PASSIVO CIRCULANTE','Obrigações fiscais/trabalhistas'),('passivo','PASSIVO CIRCULANTE','Empréstimos curto prazo'),
      ('passivo','PASSIVO NÃO CIRCULANTE','Empréstimos longo prazo'),('pl','PATRIMÔNIO LÍQUIDO','Capital social'),
      ('pl','PATRIMÔNIO LÍQUIDO','Reservas')
    ) AS x(lado,grupo,nome)
    WHERE NOT EXISTS (SELECT 1 FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL AND m.lado=x.lado AND m.grupo=x.grupo AND m.nome=x.nome));

  -- totais das manuais (todas as livres do período) — ignora soft-deletadas (item 3)
  SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.lado='ativo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='passivo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='pl'),0)
    INTO v_caixa, v_receber, v_estoque FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL;
  v_ativo := v_ativo + v_caixa; v_passivo := v_passivo + v_receber; v_pl := v_pl + v_estoque;

  -- item 1 (FECHAMENTO): linha-plug de PL que força Ativo = Passivo + PL e torna a diferença EXPLÍCITA.
  -- Realiza o conceito "Patrimônio Líquido a apurar" do front como uma LINHA nomeada (não um banner).
  -- Não é dado de cliente: deriva dos próprios componentes. Cadastrar Capital Social/Reservas reduz esta linha.
  v_plug := ROUND(v_ativo - v_passivo - v_pl, 2);
  IF ABS(v_plug) >= 0.01 THEN
    v_linhas := v_linhas || jsonb_build_object(
      'lado','pl','grupo','PATRIMÔNIO LÍQUIDO','nome','Resultado/ajuste a apurar (fechamento)',
      'valor',v_plug,'origem','calculado','editavel',false,
      'fonte','fechamento contábil: Ativo − (Passivo + PL informado). Cadastre Capital Social/Reservas para reduzir este ajuste.');
    v_pl := v_pl + v_plug;
  ELSE
    v_plug := 0;
  END IF;

  RETURN jsonb_build_object('ok',true,'data_ref',p_data_ref,'periodo',v_periodo,
    'ativo_total',ROUND(v_ativo,2),'passivo_total',ROUND(v_passivo,2),'pl_total',ROUND(v_pl,2),
    'passivo_mais_pl',ROUND(v_passivo+v_pl,2),'diferenca',ROUND(v_ativo-(v_passivo+v_pl),2),
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,
    'ajuste_apurar',v_plug,  -- item 1: valor da linha-plug "a apurar" (0 quando o balanço já fechava sozinho)
    -- GAP 2: sinal de balanço TODO ZERO (sem conteúdo real) para a tela mostrar estado vazio em vez do selo "fecha".
    'vazio',(ROUND(v_ativo,2)=0 AND ROUND(v_passivo,2)=0 AND ROUND(v_pl,2)=0),
    'linhas',v_linhas);
END; $function$;

-- AJUSTES revisor (check_fn_guards · revoke_anon): CREATE OR REPLACE reseta a ACL; re-aplica o fecho
-- padrão — REVOKE anon/PUBLIC + GRANT só a authenticated/service_role (ACL viva: authenticated=X,
-- service_role=X; sem anon). Sem este bloco o CREATE OR REPLACE tiraria o EXECUTE de authenticated e quebraria a tela.
REVOKE ALL ON FUNCTION public.fn_balanco_patrimonial(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_patrimonial(uuid, date) TO authenticated, service_role;
