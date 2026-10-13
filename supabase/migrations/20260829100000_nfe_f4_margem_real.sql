-- SPEC NFE-F4 · preço de venda com MARGEM REAL (o que sobra depois de imposto+comissão+custo fixo).
-- Pedido da Jordana. Depende de F1 (custo real). RD-52: não cria 3º motor — dá consciência fiscal ao
-- motor da oficina, lendo (só leitura) o precificacao_config do Hub quando existir, e config própria da
-- empresa (erp_oficina_parametros) quando não. RD-51: componente que falta entra 0 E vira aviso.
-- Auditoria: KGF é simples_nacional, tem oficina (margem_alvo 40) mas NÃO tem precificacao_config.

-- ── config própria da empresa p/ imposto/comissão na VENDA (KGF não usa o precificacao_config do Hub) ──
ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS imposto_venda_pct    numeric(9,4),   -- ICMS ou DAS do Simples sobre a venda
  ADD COLUMN IF NOT EXISTS pis_cofins_venda_pct numeric(9,4),   -- parte de PIS/COFINS (zerada no monofásico)
  ADD COLUMN IF NOT EXISTS comissao_venda_pct   numeric(9,4),   -- comissão do vendedor
  ADD COLUMN IF NOT EXISTS custo_fixo_pct       numeric(9,4);   -- rateio de custo fixo (se já calculado)

-- ── ENTREGA 3 · regra de preço por escopo (produto→grupo→fornecedor→empresa; a mais específica vence) ──
CREATE TABLE IF NOT EXISTS public.erp_preco_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
  escopo text NOT NULL, escopo_id uuid, escopo_valor text,
  base text NOT NULL DEFAULT 'margem_liquida',   -- 'markup' | 'margem_liquida'
  percentual numeric(9,4) NOT NULL, arredondar_para text,
  atualizar_no_recebimento boolean NOT NULL DEFAULT false,
  limite_variacao_pct numeric(9,4),   -- acima disso, sempre pergunta (mesmo com atualizar_no_recebimento)
  ativo boolean NOT NULL DEFAULT true, criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_preco_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preco_regra_rw ON public.erp_preco_regra;
CREATE POLICY preco_regra_rw ON public.erp_preco_regra FOR ALL
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ── ENTREGA 4 · histórico de preço (quem, quando, de/para, por qual regra) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_preco_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
  produto_id uuid NOT NULL, preco_antes numeric(14,4), preco_depois numeric(14,4),
  custo_no_momento numeric(14,4), regra_id uuid, motivo text, origem text,
  alterado_por uuid, alterado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_preco_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preco_hist_rw ON public.erp_preco_historico;
CREATE POLICY preco_hist_rw ON public.erp_preco_historico FOR ALL
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- monofásico? produto já apareceu em nota com PIS CST 04 (extraído na F1)
CREATE OR REPLACE FUNCTION public.fn_produto_monofasico(p_company_id uuid, p_produto_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens_tributo t JOIN erp_nfe_recebidas_itens i ON i.id=t.item_id
     WHERE i.company_id=p_company_id AND i.produto_id=p_produto_id AND t.tributo='pis' AND t.cst='04')
$$;

-- ── ENTREGA 1 · margem real (decomposição inteira; nunca um número solto; 0 + aviso quando falta) ─────
CREATE OR REPLACE FUNCTION public.fn_produto_margem_real(p_company_id uuid, p_custo numeric, p_preco numeric, p_produto_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  o erp_oficina_parametros%ROWTYPE; c erp_precificacao_config%ROWTYPE; v_tem_precif boolean;
  v_imp_pct numeric := 0; v_pc_pct numeric := 0; v_cred numeric := 0; v_com_pct numeric := 0; v_cf_pct numeric := 0;
  v_mono boolean := false; v_avisos jsonb := '[]'::jsonb;
  v_imp numeric; v_com numeric; v_cf numeric; v_ded_pct numeric; v_margem numeric; v_equil numeric; v_fonte text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_preco,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','preco_invalido'); END IF;
  SELECT * INTO o FROM erp_oficina_parametros WHERE company_id=p_company_id;
  SELECT * INTO c FROM erp_precificacao_config WHERE company_id=p_company_id AND COALESCE(ativo,true) ORDER BY vigencia_inicio DESC NULLS LAST LIMIT 1;
  v_tem_precif := FOUND;
  IF p_produto_id IS NOT NULL THEN v_mono := fn_produto_monofasico(p_company_id, p_produto_id); END IF;

  -- imposto de venda: config própria da empresa → precificacao_config (Hub) → 0 + aviso
  v_imp_pct := COALESCE(o.imposto_venda_pct, c.icms_pct);
  v_pc_pct  := COALESCE(o.pis_cofins_venda_pct, c.pis_cofins_pct, 0);
  v_cred    := COALESCE(c.creditos_pct, 0);
  IF v_imp_pct IS NULL AND NOT v_tem_precif THEN v_avisos := v_avisos || to_jsonb('imposto de venda não configurado — cadastre a alíquota (Simples/ICMS) nos parâmetros'::text); v_imp_pct := 0; END IF;
  IF v_mono THEN v_pc_pct := 0; v_fonte := 'monofasico_pis_cofins_zero'; ELSE v_fonte := CASE WHEN v_tem_precif THEN 'precificacao_config' ELSE 'parametros_empresa' END; END IF;
  v_imp_pct := GREATEST(COALESCE(v_imp_pct,0) + v_pc_pct - v_cred, 0);

  -- comissão
  v_com_pct := COALESCE(o.comissao_venda_pct, c.comissao_pct);
  IF v_com_pct IS NULL THEN v_avisos := v_avisos || to_jsonb('comissão não configurada — entrou 0'::text); v_com_pct := 0; END IF;

  -- custo fixo: config direta → rateio (categorias ÷ faturamento) → 0 + aviso
  v_cf_pct := o.custo_fixo_pct;
  IF v_cf_pct IS NULL AND o.categorias_custo_fixo IS NOT NULL THEN
    SELECT CASE WHEN COALESCE(fat,0) > 0 THEN round(cf/fat*100, 4) ELSE NULL END INTO v_cf_pct FROM (
      SELECT (SELECT COALESCE(sum(valor),0) FROM erp_pagar WHERE company_id=p_company_id AND categoria = ANY(o.categorias_custo_fixo) AND data_competencia >= CURRENT_DATE - 90) AS cf,
             (SELECT COALESCE(sum(valor),0) FROM erp_receber WHERE company_id=p_company_id AND data_competencia >= CURRENT_DATE - 90) AS fat) t;
  END IF;
  IF v_cf_pct IS NULL THEN v_avisos := v_avisos || to_jsonb('custo fixo estimado em 0 — meta de produção/faturamento não cadastrado'::text); v_cf_pct := 0; END IF;

  v_imp := round(p_preco * v_imp_pct/100, 2);
  v_com := round(p_preco * v_com_pct/100, 2);
  v_cf  := round(p_preco * v_cf_pct/100, 2);
  v_ded_pct := v_imp_pct + v_com_pct + v_cf_pct;
  v_margem := p_preco - COALESCE(p_custo,0) - v_imp - v_com - v_cf;
  v_equil := CASE WHEN v_ded_pct < 100 THEN round(COALESCE(p_custo,0)/(1 - v_ded_pct/100), 2) ELSE NULL END;

  RETURN jsonb_build_object('ok',true,'preco',p_preco,'custo',p_custo,
    'markup_pct', CASE WHEN COALESCE(p_custo,0)>0 THEN round((p_preco/p_custo - 1)*100,2) END,
    'deducoes', jsonb_build_object('imposto_venda',v_imp,'comissao',v_com,'custo_fixo',v_cf,
      'pct', jsonb_build_object('imposto',v_imp_pct,'comissao',v_com_pct,'custo_fixo',v_cf_pct)),
    'margem_liquida', round(v_margem,2), 'margem_liquida_pct', round(v_margem/p_preco*100,2),
    'preco_equilibrio', v_equil, 'monofasico', v_mono, 'fonte_imposto', v_fonte, 'avisos', v_avisos);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_produto_margem_real(uuid,numeric,numeric,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_produto_margem_real(uuid,numeric,numeric,uuid) TO authenticated, service_role;

-- ── ENTREGA 2 · preço para uma margem líquida alvo (inverso; erro claro se impossível) ───────────────
CREATE OR REPLACE FUNCTION public.fn_produto_preco_por_margem(p_company_id uuid, p_custo numeric, p_margem_alvo_pct numeric, p_produto_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ded_pct numeric; v_preco numeric; r jsonb; v_alvo numeric := COALESCE(p_margem_alvo_pct,0)/100;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_custo,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','custo_invalido'); END IF;
  -- descobre o % de deduções calculando a margem num preço qualquer (>custo) e lendo os pct
  r := fn_produto_margem_real(p_company_id, p_custo, p_custo*2, p_produto_id);
  v_ded_pct := ((r->'deducoes'->'pct'->>'imposto')::numeric + (r->'deducoes'->'pct'->>'comissao')::numeric + (r->'deducoes'->'pct'->>'custo_fixo')::numeric)/100;
  IF (v_ded_pct + v_alvo) >= 1 THEN
    RETURN jsonb_build_object('ok',false,'erro','margem_impossivel',
      'mensagem', format('Não é possível atingir %s%% de margem com deduções de %s%%.', round(p_margem_alvo_pct,1), round(v_ded_pct*100,1))); END IF;
  v_preco := round(p_custo / (1 - v_ded_pct - v_alvo), 2);
  RETURN jsonb_build_object('ok',true,'custo',p_custo,'margem_alvo_pct',p_margem_alvo_pct,'preco_sugerido',v_preco,
    'deducoes_pct', round(v_ded_pct*100,2), 'avisos', r->'avisos');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_produto_preco_por_margem(uuid,numeric,numeric,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_produto_preco_por_margem(uuid,numeric,numeric,uuid) TO authenticated, service_role;

-- ── §7 · precificação em massa (relatório, NÃO grava) — cria a tabela de preço pela 1ª vez ───────────
CREATE OR REPLACE FUNCTION public.fn_produto_preco_sugerir_lote(p_company_id uuid, p_margem_alvo numeric DEFAULT 25, p_filtro text DEFAULT 'todos')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'margem_hoje_pct')::numeric ASC NULLS LAST), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('produto_id',p.id,'codigo',p.codigo,'nome',p.nome,'custo',custo,'preco_hoje',p.preco_venda,
      'margem_hoje_pct', CASE WHEN p.preco_venda>0 THEN (fn_produto_margem_real(p_company_id,custo,p.preco_venda,p.id)->>'margem_liquida_pct')::numeric END,
      'preco_sugerido', (fn_produto_preco_por_margem(p_company_id,custo,p_margem_alvo,p.id)->>'preco_sugerido')::numeric) AS x
    FROM (SELECT id, codigo, nome, preco_venda, COALESCE(NULLIF(preco_custo_medio,0),preco_custo) AS custo
            FROM erp_produtos WHERE company_id=p_company_id AND COALESCE(ativo,true)=true) p
    WHERE p.custo > 0     -- sem custo não há margem (os 847 sem custo se resolvem processando as notas)
      AND (p_filtro <> 'sem_preco' OR COALESCE(p.preco_venda,0) = 0)
      AND (p_filtro <> 'margem_negativa' OR (p.preco_venda>0 AND p.preco_venda < p.custo))
  ) t;
  RETURN jsonb_build_object('ok',true,'total',jsonb_array_length(v_rows),'margem_alvo',p_margem_alvo,'produtos',v_rows,
    'aviso','Relatório — nada gravado. Revise e reimporte, ou aplique produto a produto (RD-55).');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_produto_preco_sugerir_lote(uuid,numeric,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_produto_preco_sugerir_lote(uuid,numeric,text) TO authenticated, service_role;

-- ── ENTREGA 4 · aplicar UM preço (com histórico) — chamado pelo clique humano, nunca sozinho ─────────
CREATE OR REPLACE FUNCTION public.fn_produto_preco_aplicar(p_produto_id uuid, p_novo_preco numeric, p_regra_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_antes numeric; v_custo numeric;
BEGIN
  SELECT company_id, preco_venda, COALESCE(NULLIF(preco_custo_medio,0),preco_custo) INTO v_comp, v_antes, v_custo FROM erp_produtos WHERE id=p_produto_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','produto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_novo_preco,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','preco_invalido'); END IF;
  UPDATE erp_produtos SET preco_venda=p_novo_preco, updated_at=now() WHERE id=p_produto_id;
  INSERT INTO erp_preco_historico (company_id, produto_id, preco_antes, preco_depois, custo_no_momento, regra_id, motivo, origem, alterado_por)
  VALUES (v_comp, p_produto_id, v_antes, p_novo_preco, v_custo, p_regra_id, p_motivo, 'manual', auth.uid());
  RETURN jsonb_build_object('ok',true,'preco_antes',v_antes,'preco_depois',p_novo_preco);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_produto_preco_aplicar(uuid,numeric,uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_produto_preco_aplicar(uuid,numeric,uuid,text) TO authenticated, service_role;
