-- GE · Precificação / Markup na tela de Produtos — ENTREGA 1 (CEO 13/10, Opção A · rodrigo-code · faixa 30).
--
-- "Destrava a venda": a tela Compras › Precificação mostra, por produto ativo, Custo médio · Estoque · Preço de venda ·
-- Margem real (semáforo pela meta/mínima da empresa), com filtro "Sem preço de venda", banner de preço 0 e "Formar
-- preços" (margem % OU markup, arredondamento, PRÉVIA obrigatória — nada grava sem confirmar, RD-55).
--
-- RD-26: REAPROVEITA o motor fn_produto_margem_real / fn_produto_preco_por_margem / fn_produto_preco_aplicar.
-- Pilar 2: custo/valor só para quem pode ver (tenant_user_roles), no backend.
--
-- Revisão Eng. Chefe 13/10 (correção 1a): os parâmetros de preço da empresa (imposto da venda, margem meta/mínima)
-- vão numa TABELA PRÓPRIA DO GE (erp_precificacao_parametros) — NUNCA em erp_oficina_parametros, porque ramos_da_empresa
-- lê o `ramo` de lá e criar a linha marcaria a empresa como oficina. O motor passa a ler esse parâmetro no TOPO da
-- ordem de prioridade do imposto (fonte 'parametros_ge'); se for NULL, segue EXATAMENTE a ordem atual (mudança aditiva).
-- Nunca grava em erp_fiscal_provider_config (esse % sai na NF-e, Lei 12.741) — o override é só para a conta de margem.
--
-- Aditiva: tabela NOVA + funções NOVAS + CREATE OR REPLACE aditivo do motor + chaves de ajuda (RD-95). Não altera
-- função de guarda. Sem DROP/DELETE/TRUNCATE.

-- ── Parâmetros de precificação da empresa (GE) ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_precificacao_parametros (
  company_id        uuid PRIMARY KEY,
  imposto_venda_pct numeric,     -- imposto que incide na venda (entra só na conta de margem, não na NF-e)
  margem_meta_pct   numeric,     -- margem líquida alvo (semáforo verde)
  margem_minima_pct numeric,     -- margem líquida mínima (abaixo dela = vermelho)
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_por    uuid
);
ALTER TABLE public.erp_precificacao_parametros ENABLE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_precificacao_parametros' AND policyname='erp_precificacao_parametros_empresa') THEN
    CREATE POLICY erp_precificacao_parametros_empresa ON public.erp_precificacao_parametros
      FOR ALL TO authenticated
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $pol$;
REVOKE ALL ON TABLE public.erp_precificacao_parametros FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_precificacao_parametros TO authenticated;
GRANT ALL ON TABLE public.erp_precificacao_parametros TO service_role;

-- ── Motor de margem: lê o imposto do GE no TOPO da prioridade (aditivo; NULL → ordem atual intacta) ───────────────
CREATE OR REPLACE FUNCTION public.fn_produto_margem_real(p_company_id uuid, p_custo numeric, p_preco numeric, p_produto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o erp_oficina_parametros%ROWTYPE; c erp_precificacao_config%ROWTYPE; v_tem_precif boolean;
  v_imp_pct numeric := 0; v_pc_pct numeric := 0; v_cred numeric := 0; v_com_pct numeric := 0; v_cf_pct numeric := 0;
  v_mono boolean := false; v_avisos jsonb := '[]'::jsonb;
  v_imp numeric; v_com numeric; v_cf numeric; v_ded_pct numeric; v_margem numeric; v_equil numeric; v_fonte text;
  v_regime text; v_sn_pct numeric;
  v_ge_imp numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_preco,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','preco_invalido'); END IF;
  SELECT * INTO o FROM erp_oficina_parametros WHERE company_id=p_company_id;
  SELECT * INTO c FROM erp_precificacao_config WHERE company_id=p_company_id AND COALESCE(ativo,true) ORDER BY vigencia_inicio DESC NULLS LAST LIMIT 1;
  v_tem_precif := FOUND;
  IF p_produto_id IS NOT NULL THEN v_mono := fn_produto_monofasico(p_company_id, p_produto_id); END IF;

  -- parâmetro de imposto do GE (erp_precificacao_parametros) — fonte de maior prioridade, sem tocar oficina/fiscal
  SELECT imposto_venda_pct INTO v_ge_imp FROM erp_precificacao_parametros WHERE company_id=p_company_id;

  -- regime tributário + alíquota Simples da config fiscal ATIVA (RD-44/45: a alíquota já existe)
  SELECT regime_tributario, percentual_total_tributos_sn INTO v_regime, v_sn_pct
    FROM erp_fiscal_provider_config
   WHERE company_id=p_company_id AND ativo=true
   ORDER BY (percentual_total_tributos_sn IS NOT NULL) DESC, atualizado_em DESC NULLS LAST
   LIMIT 1;

  -- imposto de venda, em ordem de prioridade:
  --   0) parâmetro do GE (erp_precificacao_parametros.imposto_venda_pct) — informado na tela de Precificação
  --   1) override explícito da empresa (o.imposto_venda_pct) — também é a alavanca pra separar peça (Anexo I) de serviço
  --   2) Simples Nacional → % total de tributos aprox. do DAS (all-in; NÃO soma PIS/COFINS por cima)
  --   3) precificacao_config do Hub (ICMS + PIS/COFINS − créditos)
  --   4) nada → 0 + aviso
  IF v_ge_imp IS NOT NULL THEN
    v_imp_pct := v_ge_imp; v_pc_pct := 0; v_cred := 0;
    v_fonte := 'parametros_ge';
  ELSIF o.imposto_venda_pct IS NOT NULL THEN
    v_imp_pct := o.imposto_venda_pct; v_pc_pct := COALESCE(o.pis_cofins_venda_pct,0); v_cred := 0;
    v_fonte := 'override_empresa';
  ELSIF v_regime='simples_nacional' AND v_sn_pct IS NOT NULL THEN
    v_imp_pct := v_sn_pct; v_pc_pct := 0; v_cred := 0;
    v_fonte := 'simples_nacional_das';
    v_avisos := v_avisos || to_jsonb(format('Imposto = %s%% do Simples (%% total de tributos aprox., Anexo III / serviço). Peça é Anexo I e pode ter alíquota diferente — cadastre o imposto da venda pra sobrescrever se precisar.', trim_scale(v_sn_pct))::text);
  ELSE
    v_imp_pct := c.icms_pct; v_pc_pct := COALESCE(o.pis_cofins_venda_pct, c.pis_cofins_pct, 0); v_cred := COALESCE(c.creditos_pct,0);
    IF v_imp_pct IS NULL AND NOT v_tem_precif THEN v_avisos := v_avisos || to_jsonb('imposto de venda não configurado — cadastre a alíquota (Simples/ICMS) nos parâmetros'::text); v_imp_pct := 0; END IF;
    v_fonte := CASE WHEN v_tem_precif THEN 'precificacao_config' ELSE 'parametros_empresa' END;
  END IF;

  -- monofásico zera a parte de PIS/COFINS — só relevante fora do DAS all-in (segregação de receita no SN fica p/ depois)
  IF v_mono AND v_fonte <> 'simples_nacional_das' THEN v_pc_pct := 0; v_fonte := 'monofasico_pis_cofins_zero'; END IF;
  v_imp_pct := GREATEST(COALESCE(v_imp_pct,0) + v_pc_pct - v_cred, 0);

  -- comissão
  v_com_pct := COALESCE(o.comissao_venda_pct, c.comissao_pct);
  IF v_com_pct IS NULL THEN v_avisos := v_avisos || to_jsonb('comissão não configurada — entrou 0'::text); v_com_pct := 0; END IF;

  -- custo fixo: config direta → rateio por VENCIMENTO nos últimos 90 dias (categorias ÷ faturamento) → 0 + aviso.
  -- Usa data_vencimento (não competência) porque a competência de salário vem colapsada num dia só; o
  -- vencimento espalha as obrigações no tempo. Faturamento usa `valor` (o faturado), não valor_pago.
  v_cf_pct := o.custo_fixo_pct;
  IF v_cf_pct IS NULL AND o.categorias_custo_fixo IS NOT NULL THEN
    DECLARE v_cf_val numeric; v_fat numeric;
    BEGIN
      SELECT (SELECT COALESCE(sum(valor),0) FROM erp_pagar WHERE company_id=p_company_id AND categoria = ANY(o.categorias_custo_fixo) AND data_vencimento BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE),
             (SELECT COALESCE(sum(valor),0) FROM erp_receber WHERE company_id=p_company_id AND data_vencimento BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE)
        INTO v_cf_val, v_fat;
      IF COALESCE(v_fat,0) > 0 THEN
        v_cf_pct := round(v_cf_val/v_fat*100, 4);
        -- RD-51 · rede de segurança: rateio >= 100% não é dedução usável → 0 + aviso com os números reais
        IF v_cf_pct >= 100 THEN
          v_avisos := v_avisos || to_jsonb(format('Custo fixo dos últimos 90 dias (R$ %s) passou do faturamento registrado (R$ %s) — o rateio de %s%% não é confiável e entrou 0. Confira lançamentos e faturamento do período.', trim_scale(round(v_cf_val,2)), trim_scale(round(v_fat,2)), trim_scale(v_cf_pct))::text);
          v_cf_pct := 0;
        END IF;
      END IF;
    END;
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
END $function$;
REVOKE ALL ON FUNCTION public.fn_produto_margem_real(uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produto_margem_real(uuid, numeric, numeric, uuid) TO service_role;

-- ── Painel de preços (leitura; custo por permissão; devolve a config da empresa p/ semáforo e bloqueio de imposto) ─
CREATE OR REPLACE FUNCTION public.fn_produtos_precos_painel(
  p_company_id uuid,
  p_filtro     text DEFAULT 'todos',     -- 'todos' | 'sem_preco' | 'margem_negativa' | 'com_custo'
  p_busca      text DEFAULT NULL,         -- nome / código
  p_modo       text DEFAULT NULL,         -- NULL = só listar | 'margem' | 'markup' (liga a PRÉVIA de "Formar preços")
  p_valor      numeric DEFAULT NULL,      -- margem alvo % (modo 'margem') ou markup % (modo 'markup')
  p_arredondar text DEFAULT 'nenhum')     -- 'nenhum' | 'real' | 'noventa' (,90) | 'noventa_nove' (,99)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_papel    text;
  v_custo    boolean;
  v_busca    text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_modo     text := NULLIF(lower(COALESCE(p_modo, '')), '');
  v_total    int;
  v_sem      int;
  v_abaixo   int;
  v_rows     jsonb;
  v_dummy    jsonb;
  v_imp_cfg  boolean;
  v_imp_ovr  numeric;
  v_meta     numeric;
  v_min      numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;

  -- multi-tenant: só a empresa de que o usuário é membro ativo
  SELECT role INTO v_papel
    FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF v_papel IS NULL AND NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- custo/valor só para quem pode ver (equipe de campo / mecânico não vê valores)
  v_custo := COALESCE(v_papel, '') NOT IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO');
  IF v_modo IS NOT NULL AND v_modo NOT IN ('margem', 'markup') THEN v_modo := NULL; END IF;

  -- config da empresa: imposto configurado? (uma chamada ao motor com custo/preço de teste — lê o aviso dele, sem
  -- duplicar a regra) + override atual e a margem meta/mínima (tabela de parâmetros do GE).
  v_dummy := fn_produto_margem_real(p_company_id, 100, 200, NULL);
  v_imp_cfg := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_dummy->'avisos', '[]'::jsonb)) a
     WHERE a ILIKE '%imposto de venda não configurado%');
  SELECT imposto_venda_pct, margem_meta_pct, margem_minima_pct INTO v_imp_ovr, v_meta, v_min
    FROM erp_precificacao_parametros WHERE company_id = p_company_id;

  -- base: produtos ativos da empresa, com o custo efetivo (médio, cai p/ preco_custo quando médio = 0)
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.unidade, p.grupo,
           COALESCE(p.estoque_atual, 0)                                AS estoque,
           COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)  AS custo,
           COALESCE(p.preco_venda, 0)                                  AS preco_hoje
      FROM erp_produtos p
     WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true) = true
  ),
  tot AS (
    SELECT count(*)::int                                                        AS total_ativos,
           count(*) FILTER (WHERE preco_hoje <= 0)::int                         AS sem_preco,
           count(*) FILTER (WHERE preco_hoje > 0 AND custo > 0 AND preco_hoje < custo)::int AS abaixo_custo
      FROM base
  ),
  filtrada AS (
    SELECT b.*,
      CASE WHEN b.custo > 0 AND b.preco_hoje > 0
           THEN (fn_produto_margem_real(p_company_id, b.custo, b.preco_hoje, b.id) ->> 'margem_liquida_pct')::numeric
      END AS margem_hoje_pct,
      CASE WHEN v_modo = 'markup' AND b.custo > 0 THEN b.custo * (1 + COALESCE(p_valor, 0) / 100)
           WHEN v_modo = 'margem' AND b.custo > 0 THEN (fn_produto_preco_por_margem(p_company_id, b.custo, p_valor, b.id) ->> 'preco_sugerido')::numeric
      END AS preco_cru
      FROM base b
     WHERE (p_filtro <> 'sem_preco'       OR b.preco_hoje <= 0)
       AND (p_filtro <> 'margem_negativa' OR (b.preco_hoje > 0 AND b.custo > 0 AND b.preco_hoje < b.custo))
       AND (p_filtro <> 'com_custo'       OR b.custo > 0)
       AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR b.codigo ILIKE '%' || v_busca || '%')
  ),
  calc AS (
    SELECT f.*,
      CASE
        WHEN f.preco_cru IS NULL OR f.preco_cru <= 0 THEN NULL
        WHEN p_arredondar = 'real'         THEN ceil(f.preco_cru)
        WHEN p_arredondar = 'noventa'      THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.90 THEN 1.90 ELSE 0.90 END
        WHEN p_arredondar = 'noventa_nove' THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.99 THEN 1.99 ELSE 0.99 END
        ELSE round(f.preco_cru, 2)
      END AS preco_novo
      FROM filtrada f
  )
  SELECT (SELECT total_ativos FROM tot), (SELECT sem_preco FROM tot), (SELECT abaixo_custo FROM tot),
         COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'unidade', c.unidade,
           'estoque', c.estoque,
           'custo',            CASE WHEN v_custo THEN c.custo END,
           'preco_hoje',       c.preco_hoje,
           'margem_hoje_pct',  CASE WHEN v_custo THEN c.margem_hoje_pct END,
           'preco_novo',       CASE WHEN v_custo THEN c.preco_novo END,
           'margem_nova_pct',  CASE WHEN v_custo AND c.preco_novo > 0
                                     THEN (fn_produto_margem_real(p_company_id, c.custo, c.preco_novo, c.id) ->> 'margem_liquida_pct')::numeric END
         ) ORDER BY (c.preco_hoje <= 0) DESC, c.margem_hoje_pct ASC NULLS LAST, c.nome), '[]'::jsonb)
    INTO v_total, v_sem, v_abaixo, v_rows
    FROM calc c;

  RETURN jsonb_build_object('ok', true,
    'pode_ver_custo', v_custo,
    'total_ativos', v_total, 'sem_preco', v_sem, 'abaixo_custo', v_abaixo,
    'modo', v_modo, 'valor', p_valor, 'arredondar', p_arredondar,
    'config', jsonb_build_object(
      'imposto_configurado', v_imp_cfg,
      'imposto_pct',         (v_dummy->'deducoes'->'pct'->>'imposto')::numeric,
      'imposto_override',    v_imp_ovr,
      'imposto_fonte',       v_dummy->>'fonte_imposto',
      'margem_meta_pct',     v_meta,
      'margem_minima_pct',   v_min),
    'produtos', v_rows);
END $function$;
REVOKE ALL ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) TO authenticated, service_role;

-- "Conta do preço" na tela (chamada direta do cliente): wrapper do motor para quem é da empresa, sem abrir o motor
-- a authenticated. O motor já confere o acesso por auth.uid() lá dentro.
CREATE OR REPLACE FUNCTION public.fn_preco_conta(p_company_id uuid, p_custo numeric, p_preco numeric, p_produto_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.fn_produto_margem_real(p_company_id, p_custo, p_preco, p_produto_id); $function$;
REVOKE ALL ON FUNCTION public.fn_preco_conta(uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preco_conta(uuid, numeric, numeric, uuid) TO authenticated, service_role;

-- Salva a configuração de preço da empresa: imposto da venda + margem meta/mínima. Guarda de empresa
-- (get_user_company_ids/is_admin) + auditoria. Grava SÓ em erp_precificacao_parametros (tabela do GE) — nunca em
-- erp_oficina_parametros nem em erp_fiscal_provider_config.
CREATE OR REPLACE FUNCTION public.fn_preco_config_empresa_salvar(
  p_company_id         uuid,
  p_imposto_pct        numeric DEFAULT NULL,
  p_margem_meta_pct    numeric DEFAULT NULL,
  p_margem_minima_pct  numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_imposto_pct IS NOT NULL AND (p_imposto_pct < 0 OR p_imposto_pct >= 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'imposto_invalido'); END IF;
  IF p_margem_meta_pct IS NOT NULL AND p_margem_meta_pct <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'meta_invalida'); END IF;
  IF p_margem_minima_pct IS NOT NULL AND p_margem_meta_pct IS NOT NULL AND p_margem_minima_pct > p_margem_meta_pct THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'minima_maior_que_meta'); END IF;

  INSERT INTO erp_precificacao_parametros (company_id, imposto_venda_pct, margem_meta_pct, margem_minima_pct, atualizado_em, atualizado_por)
    VALUES (p_company_id, p_imposto_pct, p_margem_meta_pct, p_margem_minima_pct, now(), v_uid)
  ON CONFLICT (company_id) DO UPDATE SET
    imposto_venda_pct = COALESCE(EXCLUDED.imposto_venda_pct, erp_precificacao_parametros.imposto_venda_pct),
    margem_meta_pct   = COALESCE(EXCLUDED.margem_meta_pct,   erp_precificacao_parametros.margem_meta_pct),
    margem_minima_pct = COALESCE(EXCLUDED.margem_minima_pct, erp_precificacao_parametros.margem_minima_pct),
    atualizado_em = now(), atualizado_por = v_uid;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    SELECT p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_precificacao_parametros', NULL, 'CONFIG_PRECO',
      jsonb_build_object('imposto_pct', p_imposto_pct, 'margem_meta_pct', p_margem_meta_pct, 'margem_minima_pct', p_margem_minima_pct);

  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_preco_config_empresa_salvar(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preco_config_empresa_salvar(uuid, numeric, numeric, numeric) TO authenticated, service_role;

-- RD-95: "?" dos campos/colunas/ações da tela de precificação. Textos em linguagem do usuário, editáveis sem deploy.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('compras.precificacao.imposto_venda', '/dashboard/compras/precificacao', 'Precificação', 'Imposto sobre a venda (%)',
  'A alíquota de imposto que incide quando você VENDE (Simples Nacional, ICMS+PIS/COFINS etc.). Informe o total em %.',
  'Entra na conta da margem: sem ele, o preço sai mais baixo do que deveria e a margem real fica errada. É o % que o motor desconta do preço para achar o quanto sobra. Fica na precificação, não vai para a NF-e.',
  'Simples Anexo I ~8,5%. Com imposto 11% e margem 30%, um custo de R$ 60,78 vira R$ 103,02.',
  'Deixar em branco: a tela bloqueia a gravação de preços até você informar, para não gravar preço com imposto 0.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.margem_meta', '/dashboard/compras/precificacao', 'Precificação', 'Margem meta',
  'A margem líquida que a empresa QUER ter (o alvo). Em %.', 'Pinta o semáforo de verde quando a margem real alcança a meta, e é a margem padrão ao formar preços.',
  'Meta 25%.', 'Pôr a meta acima do que o imposto+comissão permitem: o preço fica muito alto. Veja a "Conta do preço".',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.margem_minima', '/dashboard/compras/precificacao', 'Precificação', 'Margem mínima',
  'A menor margem líquida aceitável. Abaixo dela o produto está no vermelho. Em %.',
  'Pinta o semáforo: vermelho abaixo da mínima, amarelo entre a mínima e a meta, verde na meta ou acima.',
  'Mínima 10%.', 'Mínima maior que a meta: o sistema recusa — a mínima é sempre menor ou igual à meta.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.custo_medio', '/dashboard/compras/precificacao', 'Precificação', 'Custo médio',
  'Não preenche — é o custo médio de compra do produto, calculado pelas entradas de estoque (notas de compra).',
  'É a base de todo o cálculo: a margem e o preço sugerido saem dele. Produto sem custo não entra no cálculo (processe as notas de compra).',
  'Comprou 10 a R$ 8 e 10 a R$ 10 → custo médio R$ 9.', 'Custo zerado por nota ainda não processada: a margem aparece em branco até a entrada ser lançada.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.estoque', '/dashboard/compras/precificacao', 'Precificação', 'Estoque',
  'Não preenche — é o saldo atual em estoque do produto.', 'Ajuda a priorizar: forme preço primeiro no que você tem para vender agora.',
  '12 unidades.', 'Saldo diferente do físico: faça o inventário (contagem) para acertar.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.preco_venda', '/dashboard/compras/precificacao', 'Precificação', 'Preço de venda',
  'Não preenche aqui — é o preço de venda atual do produto. Para mudar, use "Formar preços" ou aplique o sugerido.',
  'É o preço que o cliente paga hoje. Preço zero trava a venda — por isso o aviso no topo.', 'R$ 19,90.',
  'Preço abaixo do custo (fica vermelho): você está vendendo com prejuízo.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.margem_real', '/dashboard/compras/precificacao', 'Precificação', 'Margem real',
  'Não preenche — é a margem líquida real de hoje, já descontando imposto da venda, comissão e custo fixo rateado.',
  'Mostra quanto SOBRA de verdade, não o markup. Verde na meta, amarelo entre a mínima e a meta, vermelho abaixo da mínima.',
  'Preço R$ 100, custo R$ 60, deduções R$ 25 → margem real R$ 15 (15%).',
  'Confundir com markup: markup é sobre o custo; a margem real é sobre o preço, depois de tudo.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.modo', '/dashboard/compras/precificacao', 'Precificação', 'Como formar o preço',
  'Escolha "Por margem" (quero sobrar X% no final) ou "Por markup" (quero multiplicar o custo por um fator).',
  'Define a conta do preço novo. Por margem o sistema desconta imposto/comissão/custo fixo para a margem fechar; por markup é só custo × fator.',
  'Margem 25% ou markup 60%.', 'Esperar que markup 25% dê 25% de margem: não dá — o imposto e a comissão comem parte.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.valor', '/dashboard/compras/precificacao', 'Precificação', 'Percentual',
  'O número do percentual: a margem líquida que você quer (modo margem) ou o quanto somar sobre o custo (modo markup).',
  'É o alvo do cálculo. A prévia mostra o preço novo e a margem real que ele dá antes de você gravar.', '25 (margem) ou 60 (markup).',
  'Pedir margem maior do que as deduções permitem: o sistema avisa que é impossível.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.arredondar', '/dashboard/compras/precificacao', 'Precificação', 'Arredondamento',
  'Como terminar o preço: exato, inteiro (R$ 20), terminando em ,90 (R$ 19,90) ou em ,99 (R$ 19,99).',
  'Deixa o preço comercial. O arredondamento é sempre para cima, para não comer a margem calculada.', 'R$ 19,47 → ,90 vira R$ 19,90.',
  'Arredondar para baixo à mão depois: você perde a margem que pediu.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.busca', '/dashboard/compras/precificacao', 'Precificação', 'Buscar',
  'Digite parte do nome ou do código do produto e tecle Enter para filtrar a lista.',
  'Achar rápido um produto específico para ver a margem ou formar o preço.', 'Tinta, ou o código 7898...',
  'Buscar não limpa o filtro de cima: se não achar, confira se o filtro não está escondendo o produto.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.formar_precos', '/dashboard/compras/precificacao', 'Precificação', 'Formar preços',
  'Botão: calcula o preço novo dos produtos do filtro pela margem/markup e mostra a PRÉVIA. Nada é gravado antes de você confirmar.',
  'Precificar em lote com segurança: você vê o de→para e a margem nova, confere e só então grava (cada produto vira uma linha no histórico de preços).',
  'Filtrar "Sem preço de venda", margem 30%, ver a prévia e gravar.', 'Achar que já gravou ao calcular: só grava no "Gravar preços" da prévia.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.conta_preco', '/dashboard/compras/precificacao', 'Precificação', 'Conta do preço',
  'Não preenche — abre a conta do preço: custo, imposto da venda, comissão, custo fixo e a margem que sobra.',
  'Mostra de onde vem a margem real, para você entender e explicar o preço.', 'Preço R$ 100 = custo 60 + imposto 10 + comissão 5 + custo fixo 10 + margem 15.',
  'Deduções em 0: falta cadastrar imposto/comissão nos parâmetros (o cartão avisa).', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
