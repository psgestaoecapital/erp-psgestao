-- Hub · Mão de obra v2 (pedido urgente do CEO, 01/10, após a tela entrar no ar):
--  1) Obrigatórios: pessoa = nome completo, CPF (dígito verificador), função, vínculo, salário base (ou valor da diária/m²/
--     hora) e data de admissão; perfil padrão = função, salário médio e vínculo. O resto é opcional ("pode completar
--     depois"). A regra fica no banco (fn_mao_obra_ficha_salvar), a tela só antecipa.
--  2) Ajuste por ficha: encargos da folha %, 13º %, férias + 1/3 % e provisão de rescisão % vêm do padrão da empresa e
--     podem ser editados na ficha — fica marcado "ajustado nesta ficha" com quem e quando; "voltar ao padrão" limpa.
--  3) Padrões da empresa ("Configurar padrões"): encargos do regime + horas produtivas (176), vínculo (CLT), forma
--     (mensal) e benefícios padrão (VT, alimentação, saúde, seguro de vida, EPI/uniforme) — pré-preenchem a ficha nova.
--  4) Salário sugerido da função (só para quem vê salário): média dos salários CLT mensais conferidos do grupo; sem
--     ficha conferida, estimado a partir do custo/hora manual (custo × 176 ÷ fator de encargos da empresa).

-- ───────────────────────────── CPF ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__cpf_valido(p_cpf text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE d text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'); s int; r int; i int;
BEGIN
  IF length(d) <> 11 OR d ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
  s := 0; FOR i IN 1..9 LOOP s := s + substr(d, i, 1)::int * (11 - i); END LOOP;
  r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
  IF r <> substr(d, 10, 1)::int THEN RETURN false; END IF;
  s := 0; FOR i IN 1..10 LOOP s := s + substr(d, i, 1)::int * (12 - i); END LOOP;
  r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
  RETURN r = substr(d, 11, 1)::int;
END $function$;
REVOKE ALL ON FUNCTION public.fn__cpf_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__cpf_valido(text) TO authenticated, service_role;

-- ───────────────────────────── colunas ─────────────────────────────
ALTER TABLE public.erp_encargos_empresa
  ADD COLUMN IF NOT EXISTS horas_produtivas_padrao numeric(6, 2) NOT NULL DEFAULT 176 CHECK (horas_produtivas_padrao > 0 AND horas_produtivas_padrao <= 300),
  ADD COLUMN IF NOT EXISTS vinculo_padrao text NOT NULL DEFAULT 'clt' CHECK (vinculo_padrao IN ('clt', 'pj', 'diarista')),
  ADD COLUMN IF NOT EXISTS forma_padrao text NOT NULL DEFAULT 'mensal' CHECK (forma_padrao IN ('mensal', 'hora', 'm2', 'diaria')),
  ADD COLUMN IF NOT EXISTS beneficio_vt_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_vt_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_alimentacao_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_alimentacao_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_saude_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_saude_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_seguro_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_seguro_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_epi_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_epi_padrao >= 0);

ALTER TABLE public.erp_mao_obra_custo
  ADD COLUMN IF NOT EXISTS encargos_folha_pct_ajuste numeric(7, 4) CHECK (encargos_folha_pct_ajuste IS NULL OR encargos_folha_pct_ajuste BETWEEN 0 AND 150),
  ADD COLUMN IF NOT EXISTS prov_13_pct_ajuste numeric(6, 3) CHECK (prov_13_pct_ajuste IS NULL OR prov_13_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS prov_ferias_pct_ajuste numeric(6, 3) CHECK (prov_ferias_pct_ajuste IS NULL OR prov_ferias_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS prov_rescisao_pct_ajuste numeric(6, 3) CHECK (prov_rescisao_pct_ajuste IS NULL OR prov_rescisao_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ajuste_por uuid,
  ADD COLUMN IF NOT EXISTS ajuste_em timestamptz;

-- ───────────────────────────── padrões da empresa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_encargos_vigentes(p_company_id uuid, p_data date DEFAULT current_date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e record; v_reg text; v_reg_raw text; v_inss numeric; v_rat numeric; v_terc numeric; v_total numeric;
BEGIN
  SELECT * INTO e FROM erp_encargos_empresa WHERE company_id = p_company_id AND vigencia_inicio <= p_data
   ORDER BY vigencia_inicio DESC LIMIT 1;
  IF FOUND THEN
    v_total := e.inss_patronal_pct * e.desoneracao_fator_folha + e.rat_pct * e.fap + e.terceiros_pct + e.fgts_pct;
    RETURN jsonb_build_object('fonte', 'empresa', 'provisorio', e.confirmado_em IS NULL, 'regime', e.regime, 'simples_anexo', e.simples_anexo,
      'inss_patronal_pct', e.inss_patronal_pct, 'rat_pct', e.rat_pct, 'fap', e.fap, 'terceiros_pct', e.terceiros_pct, 'fgts_pct', e.fgts_pct,
      'desoneracao', e.desoneracao, 'desoneracao_fator_folha', e.desoneracao_fator_folha, 'cprb_pct', e.cprb_pct,
      'prov_13_pct', e.prov_13_pct, 'prov_ferias_pct', e.prov_ferias_pct, 'prov_rescisao_pct', e.prov_rescisao_pct,
      'encargos_folha_pct', round(v_total, 4), 'vigencia_inicio', e.vigencia_inicio, 'confirmado_em', e.confirmado_em,
      'padroes', jsonb_build_object('horas_produtivas_mes', e.horas_produtivas_padrao, 'vinculo', e.vinculo_padrao, 'forma_pagamento', e.forma_padrao,
        'beneficio_vt', e.beneficio_vt_padrao, 'beneficio_alimentacao', e.beneficio_alimentacao_padrao, 'beneficio_saude', e.beneficio_saude_padrao,
        'beneficio_seguro', e.beneficio_seguro_padrao, 'beneficio_epi', e.beneficio_epi_padrao));
  END IF;
  SELECT lower(COALESCE(regime_tributario, '')) INTO v_reg_raw FROM companies WHERE id = p_company_id;
  v_reg := CASE WHEN v_reg_raw LIKE '%simples%' THEN 'simples' WHEN v_reg_raw LIKE '%real%' THEN 'real' ELSE 'presumido' END;
  IF v_reg = 'simples' THEN v_inss := 20; v_rat := 3; v_terc := 0;
  ELSE v_inss := 20; v_rat := 3; v_terc := 5.8; END IF;
  v_total := v_inss + v_rat + v_terc + 8;
  RETURN jsonb_build_object('fonte', 'padrao_regime', 'provisorio', true, 'regime', v_reg, 'simples_anexo', CASE WHEN v_reg = 'simples' THEN 'IV' END,
    'inss_patronal_pct', v_inss, 'rat_pct', v_rat, 'fap', 1, 'terceiros_pct', v_terc, 'fgts_pct', 8,
    'desoneracao', false, 'desoneracao_fator_folha', 1, 'cprb_pct', NULL,
    'prov_13_pct', 8.33, 'prov_ferias_pct', 11.11, 'prov_rescisao_pct', 4,
    'encargos_folha_pct', v_total, 'vigencia_inicio', NULL, 'confirmado_em', NULL,
    'padroes', jsonb_build_object('horas_produtivas_mes', 176, 'vinculo', 'clt', 'forma_pagamento', 'mensal',
      'beneficio_vt', 0, 'beneficio_alimentacao', 0, 'beneficio_saude', 0, 'beneficio_seguro', 0, 'beneficio_epi', 0));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) TO authenticated, service_role;

-- salvar padrões: mudar só benefícios/horas/vínculo NÃO derruba a confirmação do contador (percentuais iguais à vigente)
CREATE OR REPLACE FUNCTION public.fn_mao_obra_encargos_salvar(p_company_id uuid, p_dados jsonb, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_vig date := COALESCE(NULLIF(p_dados->>'vigencia_inicio', '')::date, current_date); v_id uuid; v_reg text := p_dados->>'regime';
  a record; v_conf_por uuid; v_conf_em timestamptz;
  n_inss numeric := COALESCE((p_dados->>'inss_patronal_pct')::numeric, 20); n_rat numeric := COALESCE((p_dados->>'rat_pct')::numeric, 3);
  n_fap numeric := COALESCE((p_dados->>'fap')::numeric, 1); n_terc numeric := COALESCE((p_dados->>'terceiros_pct')::numeric, 0);
  n_fgts numeric := COALESCE((p_dados->>'fgts_pct')::numeric, 8); n_13 numeric := COALESCE((p_dados->>'prov_13_pct')::numeric, 8.33);
  n_fer numeric := COALESCE((p_dados->>'prov_ferias_pct')::numeric, 11.11); n_resc numeric := COALESCE((p_dados->>'prov_rescisao_pct')::numeric, 4);
  n_des boolean := COALESCE((p_dados->>'desoneracao')::boolean, false); n_fator numeric := COALESCE((p_dados->>'desoneracao_fator_folha')::numeric, 1);
  n_cprb numeric := NULLIF(p_dados->>'cprb_pct', '')::numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF v_reg NOT IN ('simples', 'presumido', 'real') THEN RAISE EXCEPTION 'Informe o regime (simples, presumido ou real).'; END IF;
  IF p_confirmar THEN v_conf_por := auth.uid(); v_conf_em := now();
  ELSE
    SELECT * INTO a FROM erp_encargos_empresa WHERE company_id = p_company_id AND vigencia_inicio <= v_vig ORDER BY vigencia_inicio DESC LIMIT 1;
    IF FOUND AND a.confirmado_em IS NOT NULL AND a.regime = v_reg AND a.inss_patronal_pct = n_inss AND a.rat_pct = n_rat AND a.fap = n_fap
       AND a.terceiros_pct = n_terc AND a.fgts_pct = n_fgts AND a.prov_13_pct = n_13 AND a.prov_ferias_pct = n_fer AND a.prov_rescisao_pct = n_resc
       AND a.desoneracao = n_des AND a.desoneracao_fator_folha = n_fator AND a.cprb_pct IS NOT DISTINCT FROM n_cprb THEN
      v_conf_por := a.confirmado_por; v_conf_em := a.confirmado_em;  -- só padrões mudaram: a confirmação continua
    END IF;
  END IF;
  INSERT INTO erp_encargos_empresa (company_id, vigencia_inicio, regime, simples_anexo, inss_patronal_pct, rat_pct, fap, terceiros_pct, fgts_pct,
         prov_13_pct, prov_ferias_pct, prov_rescisao_pct, desoneracao, desoneracao_fator_folha, cprb_pct, confirmado_por, confirmado_em, observacao,
         horas_produtivas_padrao, vinculo_padrao, forma_padrao, beneficio_vt_padrao, beneficio_alimentacao_padrao, beneficio_saude_padrao,
         beneficio_seguro_padrao, beneficio_epi_padrao)
  VALUES (p_company_id, v_vig, v_reg, NULLIF(p_dados->>'simples_anexo', ''), n_inss, n_rat, n_fap, n_terc, n_fgts, n_13, n_fer, n_resc, n_des, n_fator, n_cprb,
          v_conf_por, v_conf_em, NULLIF(btrim(p_dados->>'observacao'), ''),
          COALESCE(NULLIF(p_dados->>'horas_produtivas_padrao', '')::numeric, 176), COALESCE(NULLIF(p_dados->>'vinculo_padrao', ''), 'clt'),
          COALESCE(NULLIF(p_dados->>'forma_padrao', ''), 'mensal'), COALESCE(NULLIF(p_dados->>'beneficio_vt_padrao', '')::numeric, 0),
          COALESCE(NULLIF(p_dados->>'beneficio_alimentacao_padrao', '')::numeric, 0), COALESCE(NULLIF(p_dados->>'beneficio_saude_padrao', '')::numeric, 0),
          COALESCE(NULLIF(p_dados->>'beneficio_seguro_padrao', '')::numeric, 0), COALESCE(NULLIF(p_dados->>'beneficio_epi_padrao', '')::numeric, 0))
  ON CONFLICT (company_id, vigencia_inicio) DO UPDATE SET
    regime = EXCLUDED.regime, simples_anexo = EXCLUDED.simples_anexo, inss_patronal_pct = EXCLUDED.inss_patronal_pct, rat_pct = EXCLUDED.rat_pct,
    fap = EXCLUDED.fap, terceiros_pct = EXCLUDED.terceiros_pct, fgts_pct = EXCLUDED.fgts_pct, prov_13_pct = EXCLUDED.prov_13_pct,
    prov_ferias_pct = EXCLUDED.prov_ferias_pct, prov_rescisao_pct = EXCLUDED.prov_rescisao_pct, desoneracao = EXCLUDED.desoneracao,
    desoneracao_fator_folha = EXCLUDED.desoneracao_fator_folha, cprb_pct = EXCLUDED.cprb_pct,
    confirmado_por = EXCLUDED.confirmado_por, confirmado_em = EXCLUDED.confirmado_em, observacao = EXCLUDED.observacao,
    horas_produtivas_padrao = EXCLUDED.horas_produtivas_padrao, vinculo_padrao = EXCLUDED.vinculo_padrao, forma_padrao = EXCLUDED.forma_padrao,
    beneficio_vt_padrao = EXCLUDED.beneficio_vt_padrao, beneficio_alimentacao_padrao = EXCLUDED.beneficio_alimentacao_padrao,
    beneficio_saude_padrao = EXCLUDED.beneficio_saude_padrao, beneficio_seguro_padrao = EXCLUDED.beneficio_seguro_padrao,
    beneficio_epi_padrao = EXCLUDED.beneficio_epi_padrao
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, auth.uid(), 'erp_encargos_empresa', v_id::text, CASE WHEN p_confirmar THEN 'ENCARGOS_CONFIRMADOS' ELSE 'ENCARGOS_SALVOS' END, p_dados);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'encargos', public.fn_mao_obra_encargos_vigentes(p_company_id));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) TO authenticated, service_role;

-- ───────────────────────────── cálculo: o ajuste da ficha vence o padrão da empresa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_custo_calcular(p_ficha jsonb, p_encargos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  vinc text := COALESCE(p_ficha->>'vinculo', 'clt'); forma text := COALESCE(p_ficha->>'forma_pagamento', 'mensal');
  sal numeric := COALESCE((p_ficha->>'salario')::numeric, 0);
  vu numeric := COALESCE((p_ficha->>'valor_unidade')::numeric, 0);
  dias numeric := COALESCE((p_ficha->>'dias_mes')::numeric, 22);
  horas numeric := NULLIF(COALESCE((p_ficha->>'horas_produtivas_mes')::numeric, 176), 0);
  adic numeric := COALESCE((p_ficha->>'adicional_insalubridade')::numeric, 0) + COALESCE((p_ficha->>'adicional_periculosidade')::numeric, 0) + COALESCE((p_ficha->>'adicional_outros')::numeric, 0);
  ben numeric := COALESCE((p_ficha->>'beneficio_vt')::numeric, 0) + COALESCE((p_ficha->>'beneficio_alimentacao')::numeric, 0) + COALESCE((p_ficha->>'beneficio_saude')::numeric, 0) + COALESCE((p_ficha->>'beneficio_seguro')::numeric, 0) + COALESCE((p_ficha->>'beneficio_epi')::numeric, 0);
  p13 numeric := COALESCE((p_ficha->>'prov_13_pct_ajuste')::numeric, (p_encargos->>'prov_13_pct')::numeric, 8.33);
  pfer numeric := COALESCE((p_ficha->>'prov_ferias_pct_ajuste')::numeric, (p_encargos->>'prov_ferias_pct')::numeric, 11.11);
  presc numeric := COALESCE((p_ficha->>'prov_rescisao_pct_ajuste')::numeric, (p_encargos->>'prov_rescisao_pct')::numeric, 4);
  encp numeric := COALESCE((p_ficha->>'encargos_folha_pct_ajuste')::numeric, (p_encargos->>'encargos_folha_pct')::numeric, 36.8);
  base numeric; remun numeric; enc numeric; resc numeric; mensal numeric; hora numeric; m2 numeric;
BEGIN
  IF vinc = 'clt' THEN
    base := sal + adic;
    remun := base * (1 + (p13 + pfer) / 100);
    enc := remun * encp / 100;
    resc := base * presc / 100;
    mensal := remun + enc + resc + ben;
  ELSIF vinc = 'diarista' THEN
    base := vu; remun := vu * dias; enc := 0; resc := 0; mensal := remun + ben;
  ELSE  -- pj
    base := sal; remun := sal; enc := 0; resc := 0;
    mensal := CASE WHEN forma = 'hora' THEN vu * COALESCE(horas, 0) WHEN forma = 'm2' THEN NULL ELSE sal END;
    IF mensal IS NOT NULL THEN mensal := mensal + ben; END IF;
  END IF;
  hora := CASE WHEN vinc = 'pj' AND forma = 'hora' THEN vu WHEN mensal IS NULL OR horas IS NULL THEN NULL ELSE mensal / horas END;
  m2 := CASE WHEN forma = 'm2' THEN vu END;
  RETURN jsonb_build_object('base', round(base, 2), 'remuneracao', round(remun, 2), 'encargos', round(enc, 2), 'rescisao', round(resc, 2),
    'beneficios', round(ben, 2), 'custo_mensal', round(mensal, 2), 'custo_hora', round(hora, 2), 'custo_m2', round(m2, 2),
    'encargos_folha_pct', encp, 'prov_13_pct', p13, 'prov_ferias_pct', pfer, 'prov_rescisao_pct', presc);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) TO authenticated, service_role;

-- campos aceitos do cliente (os de ajuste à parte: precisam aceitar null explícito = "voltar ao padrão")
CREATE OR REPLACE FUNCTION public.fn__mao_obra_ficha_ajustes(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(jsonb_object_agg(k, p->k), '{}'::jsonb)
    FROM unnest(ARRAY['encargos_folha_pct_ajuste', 'prov_13_pct_ajuste', 'prov_ferias_pct_ajuste', 'prov_rescisao_pct_ajuste']) k
   WHERE p ? k
$function$;

-- ───────────────────────────── salário sugerido da função (só para quem vê salário) ─────────────────────────────
-- ci-sem-guarda: fn__mao_obra_salario_sugerido — interna (sem EXECUTE para authenticated); só fn_mao_obra_listar a chama, e só quando v_pode
CREATE OR REPLACE FUNCTION public.fn__mao_obra_salario_sugerido(p_funcao_id uuid, p_enc jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f record; v_chave text; v_media numeric; v_n int; v_fator numeric;
BEGIN
  SELECT * INTO f FROM erp_funcao_mao_obra WHERE id = p_funcao_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_chave := public.fn__mao_obra_funcao_chave(p_funcao_id);
  SELECT round(sum(k.salario * k.quantidade_pessoas) / NULLIF(sum(k.quantidade_pessoas), 0), 2), sum(k.quantidade_pessoas)::int INTO v_media, v_n
    FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
    JOIN companies c1 ON c1.id = f.company_id JOIN companies c2 ON c2.id = k.company_id AND (c2.id = c1.id OR (c1.group_id IS NOT NULL AND c2.group_id = c1.group_id))
   WHERE k.ativo AND k.vigencia_fim IS NULL AND k.conferido AND k.vinculo = 'clt' AND k.forma_pagamento = 'mensal' AND k.salario > 0
     AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave;
  IF v_media IS NOT NULL THEN RETURN jsonb_build_object('valor', v_media, 'origem', 'media_conferida', 'pessoas', v_n); END IF;
  IF f.custo_hora_manual IS NOT NULL THEN
    v_fator := (1 + ((p_enc->>'prov_13_pct')::numeric + (p_enc->>'prov_ferias_pct')::numeric) / 100) * (1 + (p_enc->>'encargos_folha_pct')::numeric / 100)
               + (p_enc->>'prov_rescisao_pct')::numeric / 100;
    RETURN jsonb_build_object('valor', round(f.custo_hora_manual * 176 / v_fator, 2), 'origem', 'estimado_custo_hora', 'pessoas', 0);
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_salario_sugerido(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_salario_sugerido(uuid, jsonb) TO service_role;

-- ───────────────────────────── leitura da tela ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pode boolean; v_enc jsonb; v_funcoes jsonb; v_equipe jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_pode := public.fn__mao_obra_pode_ver_individual(p_company_id);
  v_enc := public.fn_mao_obra_encargos_vigentes(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'cbo', f.cbo, 'forma_pagamento', f.forma_pagamento,
           'custo_hora_manual', f.custo_hora_manual, 'unida_a_id', f.unida_a_id, 'ativo', f.ativo,
           'unida_a_nome', (SELECT u.nome FROM erp_funcao_mao_obra u WHERE u.id = f.unida_a_id),
           'migrada_de', f.projetos_mao_obra_id, 'custo', public.fn_funcao_custo_hora(f.id),
           -- LGPD: salário sugerido só para quem vê salário (média de poucas pessoas revelaria o salário de alguém)
           'salario_sugerido', CASE WHEN v_pode THEN public.fn__mao_obra_salario_sugerido(f.id, v_enc) END) ORDER BY f.ativo DESC, f.nome), '[]'::jsonb)
    INTO v_funcoes FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb) INTO v_equipe FROM (
    SELECT jsonb_build_object('id', k.id, 'grupo_id', k.grupo_id, 'tipo', k.tipo, 'funcionario_id', k.funcionario_id,
      'nome', CASE WHEN k.tipo = 'pessoa' THEN cf.nome_completo ELSE COALESCE(k.descricao, fn.nome || ' (perfil padrão)') END,
      'funcao_id', k.funcao_id, 'funcao', fn.nome, 'vinculo', k.vinculo, 'forma_pagamento', k.forma_pagamento, 'setor', COALESCE(k.setor, cf.setor),
      'quantidade_pessoas', k.quantidade_pessoas, 'horas_produtivas_mes', k.horas_produtivas_mes,
      'vigencia_inicio', k.vigencia_inicio, 'conferido', k.conferido, 'conferido_em', k.conferido_em, 'ativo', k.ativo,
      'matricula', cf.matricula, 'data_admissao', cf.data_admissao,
      'ficha', CASE WHEN v_pode THEN to_jsonb(k) - ARRAY['company_id', 'created_by', 'conferido_por', 'ajuste_por'] END,
      'ajuste_por_nome', CASE WHEN v_pode AND k.ajuste_por IS NOT NULL THEN (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = k.ajuste_por) END,
      'custo', CASE WHEN v_pode THEN public.fn_mao_obra_custo_calcular(to_jsonb(k), public.fn_mao_obra_encargos_vigentes(k.company_id)) END) x
    FROM erp_mao_obra_custo k
    JOIN erp_funcao_mao_obra fn ON fn.id = k.funcao_id
    LEFT JOIN compliance_funcionarios cf ON cf.id = k.funcionario_id
   WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL) z;
  IF v_pode AND auth.uid() IS NOT NULL THEN
    INSERT INTO erp_mao_obra_acesso_log (company_id, user_id, ficha_id, grupo_id, origem)
    SELECT k.company_id, auth.uid(), k.id, k.grupo_id, 'lista' FROM erp_mao_obra_custo k
     WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL;
  END IF;
  RETURN jsonb_build_object('pode_ver_individual', v_pode, 'encargos', v_enc, 'funcoes', v_funcoes, 'equipe', v_equipe);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_listar(uuid) TO authenticated, service_role;

-- ───────────────────────────── salvar ficha: obrigatórios + ajuste por ficha ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_salvar(p_company_id uuid, p_ficha jsonb, p_pessoa jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tipo text := COALESCE(p_ficha->>'tipo', 'perfil'); v_func uuid := NULLIF(p_ficha->>'funcionario_id', '')::uuid;
  v_funcao uuid := NULLIF(p_ficha->>'funcao_id', '')::uuid; v_id uuid; c jsonb := public.fn__mao_obra_ficha_campos(p_ficha);
  aj jsonb := public.fn__mao_obra_ficha_ajustes(p_ficha); v_tem_ajuste boolean;
  v_nome_funcao text; v_vinc text := NULLIF(p_ficha->>'vinculo', ''); v_forma text := COALESCE(NULLIF(p_ficha->>'forma_pagamento', ''), 'mensal');
  v_cpf text := regexp_replace(COALESCE(p_pessoa->>'cpf', ''), '\D', '', 'g');
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  SELECT nome INTO v_nome_funcao FROM erp_funcao_mao_obra WHERE id = v_funcao AND company_id = p_company_id AND ativo;
  IF v_nome_funcao IS NULL THEN RAISE EXCEPTION 'Escolha uma função ativa desta empresa.'; END IF;
  IF v_vinc IS NULL OR v_vinc NOT IN ('clt', 'pj', 'diarista') THEN RAISE EXCEPTION 'Informe o vínculo (CLT, PJ ou diarista).'; END IF;
  -- salário base (mensal) ou valor da unidade (diária / m² / hora)
  IF (v_vinc = 'diarista' OR (v_vinc = 'pj' AND v_forma <> 'mensal')) THEN
    IF COALESCE(NULLIF(p_ficha->>'valor_unidade', '')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Informe o valor %.', CASE WHEN v_vinc = 'diarista' OR v_forma = 'diaria' THEN 'da diária' WHEN v_forma = 'm2' THEN 'por m²' ELSE 'por hora' END;
    END IF;
  ELSIF COALESCE(NULLIF(p_ficha->>'salario', '')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION '%', CASE WHEN v_tipo = 'perfil' THEN 'Informe o salário médio.' ELSE 'Informe o salário base.' END;
  END IF;
  IF v_tipo = 'pessoa' THEN
    IF v_func IS NULL THEN
      IF length(btrim(COALESCE(p_pessoa->>'nome_completo', ''))) < 3 THEN RAISE EXCEPTION 'Informe o nome completo do funcionário.'; END IF;
      IF NOT public.fn__cpf_valido(v_cpf) THEN RAISE EXCEPTION 'CPF inválido — confira os números.'; END IF;
      IF NULLIF(p_pessoa->>'data_admissao', '') IS NULL THEN RAISE EXCEPTION 'Informe a data de admissão.'; END IF;
      IF EXISTS (SELECT 1 FROM compliance_funcionarios WHERE company_id = p_company_id AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = v_cpf AND COALESCE(ativo, true)) THEN
        RAISE EXCEPTION 'Já existe funcionário ativo com este CPF nesta empresa.';
      END IF;
      INSERT INTO compliance_funcionarios (company_id, nome_completo, cpf, rg, data_nascimento, email, telefone, cep, logradouro, numero, complemento,
             bairro, cidade, uf, matricula, cargo, setor, funcao, data_admissao, tipo_contrato, obra_nome, salario_base)
      VALUES (p_company_id, btrim(p_pessoa->>'nome_completo'), v_cpf,
             NULLIF(p_pessoa->>'rg', ''), NULLIF(p_pessoa->>'data_nascimento', '')::date, NULLIF(p_pessoa->>'email', ''), NULLIF(p_pessoa->>'telefone', ''),
             NULLIF(p_pessoa->>'cep', ''), NULLIF(p_pessoa->>'logradouro', ''), NULLIF(p_pessoa->>'numero', ''), NULLIF(p_pessoa->>'complemento', ''),
             NULLIF(p_pessoa->>'bairro', ''), NULLIF(p_pessoa->>'cidade', ''), NULLIF(p_pessoa->>'uf', ''), NULLIF(p_pessoa->>'matricula', ''),
             NULLIF(p_pessoa->>'cargo', ''), NULLIF(p_pessoa->>'setor', ''), v_nome_funcao, (p_pessoa->>'data_admissao')::date,
             upper(v_vinc), NULLIF(p_pessoa->>'obra_nome', ''), NULLIF(p_ficha->>'salario', '')::numeric)
      RETURNING id INTO v_func;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM compliance_funcionarios WHERE id = v_func AND company_id = p_company_id) THEN
        RAISE EXCEPTION 'Funcionário não encontrado nesta empresa (a ficha é da empresa que emprega).';
      END IF;
      IF EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE funcionario_id = v_func AND vigencia_fim IS NULL) THEN
        RAISE EXCEPTION 'Este funcionário já tem ficha de custo — use "Editar / reajuste".';
      END IF;
      UPDATE compliance_funcionarios SET funcao = v_nome_funcao, updated_at = now() WHERE id = v_func;
    END IF;
  ELSIF v_tipo <> 'perfil' THEN RAISE EXCEPTION 'Tipo de ficha inválido.';
  END IF;
  v_tem_ajuste := EXISTS (SELECT 1 FROM jsonb_each(aj) WHERE value <> 'null'::jsonb);
  INSERT INTO erp_mao_obra_custo (company_id, tipo, funcionario_id, funcao_id, descricao, setor, vinculo, forma_pagamento, salario, valor_unidade, dias_mes,
         adicional_insalubridade, adicional_periculosidade, adicional_outros, beneficio_vt, beneficio_alimentacao, beneficio_saude, beneficio_seguro, beneficio_epi,
         quantidade_pessoas, horas_produtivas_mes, vigencia_inicio, motivo,
         encargos_folha_pct_ajuste, prov_13_pct_ajuste, prov_ferias_pct_ajuste, prov_rescisao_pct_ajuste, ajuste_por, ajuste_em)
  VALUES (p_company_id, v_tipo, CASE WHEN v_tipo = 'pessoa' THEN v_func END, v_funcao, c->>'descricao', c->>'setor',
         v_vinc, v_forma, COALESCE((c->>'salario')::numeric, 0), COALESCE((c->>'valor_unidade')::numeric, 0),
         COALESCE((c->>'dias_mes')::numeric, 22), COALESCE((c->>'adicional_insalubridade')::numeric, 0), COALESCE((c->>'adicional_periculosidade')::numeric, 0),
         COALESCE((c->>'adicional_outros')::numeric, 0), COALESCE((c->>'beneficio_vt')::numeric, 0), COALESCE((c->>'beneficio_alimentacao')::numeric, 0),
         COALESCE((c->>'beneficio_saude')::numeric, 0), COALESCE((c->>'beneficio_seguro')::numeric, 0), COALESCE((c->>'beneficio_epi')::numeric, 0),
         CASE WHEN v_tipo = 'pessoa' THEN 1 ELSE COALESCE((c->>'quantidade_pessoas')::int, 1) END, COALESCE((c->>'horas_produtivas_mes')::numeric, 176),
         COALESCE(NULLIF(p_ficha->>'vigencia_inicio', '')::date, current_date), 'cadastro',
         NULLIF(aj->>'encargos_folha_pct_ajuste', '')::numeric, NULLIF(aj->>'prov_13_pct_ajuste', '')::numeric,
         NULLIF(aj->>'prov_ferias_pct_ajuste', '')::numeric, NULLIF(aj->>'prov_rescisao_pct_ajuste', '')::numeric,
         CASE WHEN v_tem_ajuste THEN auth.uid() END, CASE WHEN v_tem_ajuste THEN now() END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'funcionario_id', v_func);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) TO authenticated, service_role;

-- reajuste: ajustes entram (null explícito = voltar ao padrão); quem/quando muda só se o ajuste mudou
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_reajustar(p_ficha_id uuid, p_dados jsonb, p_vigencia date DEFAULT current_date, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a erp_mao_obra_custo%ROWTYPE; n erp_mao_obra_custo%ROWTYPE; c jsonb := public.fn__mao_obra_ficha_campos(p_dados);
  aj jsonb := public.fn__mao_obra_ficha_ajustes(p_dados); v_vig date := COALESCE(p_vigencia, current_date);
BEGIN
  SELECT * INTO a FROM erp_mao_obra_custo WHERE id = p_ficha_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(a.company_id);
  IF a.vigencia_fim IS NOT NULL OR NOT a.ativo THEN RAISE EXCEPTION 'Esta ficha não está vigente.'; END IF;
  IF v_vig < a.vigencia_inicio THEN RAISE EXCEPTION 'A nova vigência não pode ser anterior à atual (%).', a.vigencia_inicio; END IF;
  IF c ? 'funcao_id' AND NOT EXISTS (SELECT 1 FROM erp_funcao_mao_obra WHERE id = (c->>'funcao_id')::uuid AND company_id = a.company_id AND ativo) THEN
    RAISE EXCEPTION 'Escolha uma função ativa desta empresa.';
  END IF;
  n := jsonb_populate_record(a, c || aj);
  IF n.vinculo = 'diarista' OR (n.vinculo = 'pj' AND n.forma_pagamento <> 'mensal') THEN
    IF COALESCE(n.valor_unidade, 0) <= 0 THEN RAISE EXCEPTION 'Informe o valor da diária / m² / hora.'; END IF;
  ELSIF COALESCE(n.salario, 0) <= 0 THEN RAISE EXCEPTION 'Informe o salário.';
  END IF;
  n.id := gen_random_uuid(); n.vigencia_inicio := v_vig; n.vigencia_fim := NULL; n.conferido := false; n.conferido_por := NULL; n.conferido_em := NULL;
  n.motivo := COALESCE(NULLIF(btrim(p_motivo), ''), 'reajuste'); n.created_at := now(); n.created_by := auth.uid();
  IF a.tipo = 'pessoa' THEN n.quantidade_pessoas := 1; END IF;
  IF (n.encargos_folha_pct_ajuste, n.prov_13_pct_ajuste, n.prov_ferias_pct_ajuste, n.prov_rescisao_pct_ajuste)
     IS DISTINCT FROM (a.encargos_folha_pct_ajuste, a.prov_13_pct_ajuste, a.prov_ferias_pct_ajuste, a.prov_rescisao_pct_ajuste) THEN
    IF COALESCE(n.encargos_folha_pct_ajuste, n.prov_13_pct_ajuste, n.prov_ferias_pct_ajuste, n.prov_rescisao_pct_ajuste) IS NULL THEN
      n.ajuste_por := NULL; n.ajuste_em := NULL;          -- voltou ao padrão
    ELSE n.ajuste_por := auth.uid(); n.ajuste_em := now(); END IF;
  END IF;
  IF v_vig = a.vigencia_inicio THEN
    UPDATE erp_mao_obra_custo SET vigencia_fim = v_vig, ativo = false WHERE id = a.id;
  ELSE
    UPDATE erp_mao_obra_custo SET vigencia_fim = v_vig - 1 WHERE id = a.id;
  END IF;
  INSERT INTO erp_mao_obra_custo SELECT n.*;
  IF a.tipo = 'pessoa' AND c ? 'funcao_id' THEN
    UPDATE compliance_funcionarios SET funcao = (SELECT nome FROM erp_funcao_mao_obra WHERE id = n.funcao_id), updated_at = now() WHERE id = a.funcionario_id;
  END IF;
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  IF n.funcao_id <> a.funcao_id THEN PERFORM public.fn__mao_obra_sync_catalogo(n.funcao_id); END IF;
  RETURN jsonb_build_object('ok', true, 'id', n.id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_reajustar(uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_reajustar(uuid, jsonb, date, text) TO authenticated, service_role;
