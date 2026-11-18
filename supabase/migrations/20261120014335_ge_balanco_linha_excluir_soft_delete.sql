-- PDCA GE · /dashboard/gestao-empresarial/balanco-patrimonial · item 3 (RD-98 p4) · code-desenvolvedor-3
-- Mensagem da caixa: e98b9977 (auditor_pdca_2, 17/11)
--
-- PROBLEMA (RD-38 — PROVADO no banco de produção):
--   fn_balanco_linha_excluir(p_company_id, p_id) faz DELETE FÍSICO em balanco_patrimonial
--   (pg_get_functiondef: contém "DELETE FROM balanco_patrimonial", NÃO contém deleted_at nem
--   audit_log). A exclusão de uma linha manual de balanço é IRRECUPERÁVEL e não deixa rastro —
--   viola RD-98 p4 (toda exclusão rastreável, nunca DELETE físico).
--
-- CORREÇÃO (aditiva — núcleo financeiro, NÃO altera/apaga dado de cliente):
--   1) Colunas deleted_at / deleted_by na tabela (idempotentes). Nenhuma linha existente é tocada
--      (todas ficam deleted_at IS NULL) → RD-38: mesma contagem de linhas ativas antes/depois.
--   2) fn_balanco_linha_excluir vira SOFT-DELETE rastreável: marca deleted_at/deleted_by e grava
--      em audit_log_global (acao='exclusao', valor_anterior = a linha). Nunca mais DELETE físico.
--   3) Todo READER de linha MANUAL passa a ignorar deleted_at IS NOT NULL, para a linha excluída
--      sumir do balanço e dos totais (fn_balanco_patrimonial: 3 leituras; fn_balanco_linha_salvar:
--      UPDATE só em linha viva; fn_balanco_copiar_periodo: fonte e dedup só sobre linhas vivas).
--   ACL reproduzida (authenticated + service_role; REVOKE anon/PUBLIC) — guarda SECURITY DEFINER.
--   fn_balanco_salvar_manual (replace-by-chave de save em lote) fica fora do escopo: não é a ação
--   "Excluir" do usuário e seu DELETE interno é uma substituição dentro de um salvamento.

-- 1) colunas de soft-delete (aditivas, idempotentes) ----------------------------------------------
ALTER TABLE public.balanco_patrimonial ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.balanco_patrimonial ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) exclusão = soft-delete rastreável + audit_log_global -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_balanco_linha_excluir(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.balanco_patrimonial%ROWTYPE;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- soft-delete: só linha VIVA desta empresa; nunca DELETE físico.
  UPDATE public.balanco_patrimonial
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_id AND company_id = p_company_id AND deleted_at IS NULL
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'linha não encontrada');
  END IF;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'balanco_patrimonial', p_id::text, 'exclusao',
          to_jsonb(v_row) - 'deleted_at' - 'deleted_by',
          jsonb_build_object('deleted_at', v_row.deleted_at, 'deleted_by', v_row.deleted_by));

  RETURN jsonb_build_object('ok', true);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_balanco_linha_excluir(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_balanco_linha_excluir(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_linha_excluir(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balanco_linha_excluir(uuid, uuid) TO service_role;

-- 3) editar só linha viva (não "ressuscita" uma linha excluída) ------------------------------------
CREATE OR REPLACE FUNCTION public.fn_balanco_linha_salvar(p_company_id uuid, p_id uuid, p_lado text, p_grupo text, p_nome text, p_valor numeric, p_obs text DEFAULT NULL::text, p_subgrupo text DEFAULT NULL::text, p_ordem integer DEFAULT 0, p_periodo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE balanco_patrimonial SET lado=p_lado, grupo=p_grupo, subgrupo=p_subgrupo, nome=p_nome,
      valor=p_valor, obs=p_obs, ordem=COALESCE(p_ordem,0), updated_at=now()
     WHERE id=p_id AND company_id=p_company_id AND deleted_at IS NULL RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','linha não encontrada'); END IF;
  ELSE
    INSERT INTO balanco_patrimonial(company_id, lado, grupo, subgrupo, nome, valor, obs, periodo, ordem)
      VALUES(p_company_id, p_lado, p_grupo, p_subgrupo, p_nome, p_valor, p_obs, p_periodo, COALESCE(p_ordem,0))
      RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_balanco_linha_salvar(uuid, uuid, text, text, text, numeric, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_balanco_linha_salvar(uuid, uuid, text, text, text, numeric, text, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_linha_salvar(uuid, uuid, text, text, text, numeric, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balanco_linha_salvar(uuid, uuid, text, text, text, numeric, text, text, integer, text) TO service_role;

-- 4) cópia de período só a partir de linhas vivas, dedup só sobre vivas ---------------------------
CREATE OR REPLACE FUNCTION public.fn_balanco_copiar_periodo(p_company_id uuid, p_de text, p_para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  WITH ins AS (
    INSERT INTO balanco_patrimonial(company_id, lado, grupo, subgrupo, nome, valor, obs, periodo, ordem)
    SELECT company_id, lado, grupo, subgrupo, nome, valor, obs, p_para, ordem
    FROM balanco_patrimonial o
    WHERE o.company_id=p_company_id AND o.periodo=p_de AND o.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM balanco_patrimonial d
                      WHERE d.company_id=p_company_id AND d.periodo=p_para AND d.deleted_at IS NULL
                        AND d.lado=o.lado AND d.grupo=o.grupo AND d.nome=o.nome)
    RETURNING 1)
  SELECT count(*) INTO v_n FROM ins;
  RETURN jsonb_build_object('ok',true,'copiadas',COALESCE(v_n,0));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_balanco_copiar_periodo(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_balanco_copiar_periodo(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_copiar_periodo(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balanco_copiar_periodo(uuid, text, text) TO service_role;

-- 5) o balanço (e os totais das manuais) ignoram linha excluída -----------------------------------
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

  -- linhas manuais LIVRES (com id/ordem) do período — só as VIVAS (deleted_at IS NULL)
  v_linhas := v_linhas || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',m.id,'lado',m.lado,'grupo',m.grupo,'subgrupo',m.subgrupo,'nome',m.nome,
      'valor',m.valor,'obs',m.obs,'ordem',m.ordem,'origem','manual','editavel',true) ORDER BY m.ordem, m.nome), '[]'::jsonb)
    FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL);

  -- templates AUSENTES (sugestão) só quando não há linha VIVA cadastrada
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
    WHERE NOT EXISTS (SELECT 1 FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL AND m.lado=x.lado AND m.grupo=x.grupo AND m.nome=x.nome));

  -- totais das manuais (todas as livres VIVAS do período)
  SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.lado='ativo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='passivo'),0), COALESCE(SUM(m.valor) FILTER (WHERE m.lado='pl'),0)
    INTO v_caixa, v_receber, v_estoque FROM balanco_patrimonial m WHERE m.company_id=p_company_id AND m.periodo=v_periodo AND m.deleted_at IS NULL;
  v_ativo := v_ativo + v_caixa; v_passivo := v_passivo + v_receber; v_pl := v_pl + v_estoque;

  RETURN jsonb_build_object('ok',true,'data_ref',p_data_ref,'periodo',v_periodo,
    'ativo_total',ROUND(v_ativo,2),'passivo_total',ROUND(v_passivo,2),'pl_total',ROUND(v_pl,2),
    'passivo_mais_pl',ROUND(v_passivo+v_pl,2),'diferenca',ROUND(v_ativo-(v_passivo+v_pl),2),
    'fecha',ABS(v_ativo-(v_passivo+v_pl))<0.01,
    -- GAP 2: sinal de balanço TODO ZERO (sem conteúdo real) para a tela mostrar estado vazio em vez do selo "fecha".
    'vazio',(ROUND(v_ativo,2)=0 AND ROUND(v_passivo,2)=0 AND ROUND(v_pl,2)=0),
    'linhas',v_linhas);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_balanco_patrimonial(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_balanco_patrimonial(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_balanco_patrimonial(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balanco_patrimonial(uuid, date) TO service_role;
