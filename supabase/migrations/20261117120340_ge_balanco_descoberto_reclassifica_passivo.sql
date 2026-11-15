-- PDCA GE · /dashboard/gestao-empresarial/balanco-patrimonial (auditor_pdca_2, RD-38 provado no dado)
-- Code: code-desenvolvedor-3
--
-- GAP 1 (CRÍTICO · CÁLCULO): Ativo total NEGATIVO quando o banco está a descoberto.
--   Prova (produção, is_demo=false): "Troian Corretora de Seguros" (d577602d-...-23), hoje:
--     ANTES: ativo_total = -23.295,63 (linha "Caixa e bancos" = -23.806,49).
--   Um Balanço Patrimonial NUNCA pode ter Ativo total negativo. Saldo bancário negativo
--   (cheque especial / conta garantida / descoberto) é OBRIGAÇÃO: reclassifica-se para o PASSIVO.
--   FIX: no ativo "Caixa e bancos" nunca fica negativo (piso 0); o módulo do saldo negativo vira
--   linha "Bancos conta garantida (descoberto)" em PASSIVO CIRCULANTE. A diferença (fecha/PL a apurar)
--   NÃO muda, pois move o mesmo valor de ativo(−) para passivo(+).
--     DEPOIS (provado em BEGIN..ROLLBACK): Troian ativo_total = 510,86 (>= 0), passivo ganha o descoberto.
--
-- GAP 2 (ALTO · ESTADO VAZIO · critério d): "✓ Balanço fecha" VERDE num balanço TODO ZERO engana.
--   Prova: "FRIOESTE" (975365cc-...) sem lançamento financeiro → ativo=passivo=pl=0, fecha=true.
--   FIX: expõe flag "vazio" (ativo=passivo=pl=0) para a tela mostrar ESTADO VAZIO com CTA em vez do
--   selo verde "fecha". (A decisão de UI fica na tela; a RPC só informa o sinal.)
--
-- Aditiva: apenas CREATE OR REPLACE de função de leitura (STABLE, sem escrita). Não altera dado de
-- cliente. Guarda de empresa preservada (fn__guarda_empresa). Grants inalterados.

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
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,
    -- GAP 2: sinal de balanço TODO ZERO (sem conteúdo real) para a tela mostrar estado vazio em vez do selo "fecha".
    'vazio',(ROUND(v_ativo,2)=0 AND ROUND(v_passivo,2)=0 AND ROUND(v_pl,2)=0),
    'linhas',v_linhas);
END; $function$;
