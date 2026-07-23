-- Linhas manuais do balanço passam a ser LIVRES (add/editar nome+valor/excluir/ordem), por período.
-- Calculadas continuam read-only (da fonte). Aditivo, RLS existente.
ALTER TABLE public.balanco_patrimonial ADD COLUMN IF NOT EXISTS ordem int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fn_balanco_linha_salvar(
  p_company_id uuid, p_id uuid, p_lado text, p_grupo text, p_nome text,
  p_valor numeric, p_obs text DEFAULT NULL, p_subgrupo text DEFAULT NULL, p_ordem int DEFAULT 0, p_periodo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE balanco_patrimonial SET lado=p_lado, grupo=p_grupo, subgrupo=p_subgrupo, nome=p_nome,
      valor=p_valor, obs=p_obs, ordem=COALESCE(p_ordem,0), updated_at=now()
     WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','linha não encontrada'); END IF;
  ELSE
    INSERT INTO balanco_patrimonial(company_id, lado, grupo, subgrupo, nome, valor, obs, periodo, ordem)
      VALUES(p_company_id, p_lado, p_grupo, p_subgrupo, p_nome, p_valor, p_obs, p_periodo, COALESCE(p_ordem,0))
      RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_balanco_linha_excluir(p_company_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  DELETE FROM balanco_patrimonial WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', v_id IS NOT NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_balanco_copiar_periodo(p_company_id uuid, p_de text, p_para text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  WITH ins AS (
    INSERT INTO balanco_patrimonial(company_id, lado, grupo, subgrupo, nome, valor, obs, periodo, ordem)
    SELECT company_id, lado, grupo, subgrupo, nome, valor, obs, p_para, ordem
    FROM balanco_patrimonial o
    WHERE o.company_id=p_company_id AND o.periodo=p_de
      AND NOT EXISTS (SELECT 1 FROM balanco_patrimonial d
                      WHERE d.company_id=p_company_id AND d.periodo=p_para AND d.lado=o.lado AND d.grupo=o.grupo AND d.nome=o.nome)
    RETURNING 1)
  SELECT count(*) INTO v_n FROM ins;
  RETURN jsonb_build_object('ok',true,'copiadas',COALESCE(v_n,0));
END; $$;

CREATE OR REPLACE FUNCTION public.fn_balanco_patrimonial(p_company_id uuid, p_data_ref date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_periodo text := to_char(p_data_ref, 'YYYY-MM');
  v_lim_circ date := (p_data_ref + interval '12 months')::date;
  v_caixa numeric; v_receber numeric; v_estoque numeric; v_forn numeric; v_forn_lp numeric;
  v_imob_bruto numeric; v_dep_acum numeric; v_invest numeric; v_intang numeric; v_bens int;
  v_ativo numeric := 0; v_passivo numeric := 0; v_pl numeric := 0; v_linhas jsonb := '[]'::jsonb;
BEGIN
  v_caixa := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT COALESCE(SUM(COALESCE(valor - COALESCE(valor_pago,0), valor)),0) INTO v_receber
    FROM erp_receber WHERE company_id=p_company_id AND status NOT IN ('recebido','pago','cancelado','orcamento');
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
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'lado',m.lado,'grupo',m.grupo,'subgrupo',m.subgrupo,'nome',m.nome,
      'valor',m.valor,'obs',m.obs,'ordem',m.ordem,'origem','manual','editavel',true) ORDER BY m.ordem, m.nome), '[]'::jsonb)
    FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo);
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
  SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.lado='ativo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='passivo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='pl'),0)
    INTO v_caixa, v_receber, v_estoque FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo;
  v_ativo := v_ativo + v_caixa; v_passivo := v_passivo + v_receber; v_pl := v_pl + v_estoque;
  RETURN jsonb_build_object('ok',true,'data_ref',p_data_ref,'periodo',v_periodo,
    'ativo_total',ROUND(v_ativo,2),'passivo_total',ROUND(v_passivo,2),'pl_total',ROUND(v_pl,2),
    'passivo_mais_pl',ROUND(v_passivo+v_pl,2),'diferenca',ROUND(v_ativo-(v_passivo+v_pl),2),
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,'linhas',v_linhas);
END; $$;
