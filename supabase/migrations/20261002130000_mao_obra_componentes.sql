-- Hub · Mão de obra v2 — REMUNERAÇÃO POR COMPONENTES (SPEC Hub E1+E2 rev. 16, seção 5.1; lista do banco aprovada pelo
-- CEO em 01/10, com os valores-padrão dele, todos "a confirmar com o contador").
--  1) A ficha deixa de ter um "salário" único: tem COMPONENTES (fixo mensal/hora, produção por unidade com volume médio,
--     empreitada por obra, diária, comissão % sobre base média, bônus/prêmio, horas extras habituais, adicionais legais),
--     cada um com as chaves de incidência (gera DSR, entra em 13º/férias, incide INSS/FGTS, integra a remuneração)
--     pré-preenchidas pelo tipo e vínculo, editáveis e "a confirmar com o contador". Volume estimado fica marcado.
--  2) Vínculos: CLT, CLT intermitente, autônomo (RPA), MEI/PJ/empreiteiro (chave "MEI em serviço de obra") e diarista
--     (calculado como autônomo, com alerta de risco trabalhista acima de 8 dias no mês).
--  3) Regras-padrão do CEO: DSR 1/6 sobre produção, comissão e hora extra (editável); INSS do RPA 20% (0% no Simples
--     Anexo III/V — já está no DAS); MEI em serviço de obra: 20% de INSS patronal (LC 123); empreitada = valor × 30 ÷ dias
--     da obra; insalubridade = % do salário mínimo; periculosidade = 30% do fixo.
--  4) Obrigatórios: nome completo, CPF válido (dígito), função, vínculo, PELO MENOS UM COMPONENTE COM VALOR e data de
--     admissão (pessoa); perfil padrão: função, vínculo e um componente. O resto é opcional.
--  5) Ajuste por ficha de encargos %, 13º %, férias + 1/3 %, rescisão % e DSR (quem/quando; "voltar ao padrão").
--  6) Padrões da empresa ("Configurar padrões"): horas, vínculo, forma, benefícios, DSR, INSS do RPA, salário mínimo de
--     referência e chaves de incidência por tipo de componente (CLT) — confirmados pelo contador junto com os encargos.
--  7) Resultados: custo mensal, custo da hora produtiva e custo por unidade produzida. Nada é apagado.

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
  ADD COLUMN IF NOT EXISTS vinculo_padrao text NOT NULL DEFAULT 'clt' CHECK (vinculo_padrao IN ('clt', 'clt_intermitente', 'rpa', 'pj', 'diarista')),
  ADD COLUMN IF NOT EXISTS forma_padrao text NOT NULL DEFAULT 'mensal' CHECK (forma_padrao IN ('mensal', 'hora', 'producao', 'diaria', 'm2')),
  ADD COLUMN IF NOT EXISTS beneficio_vt_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_vt_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_alimentacao_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_alimentacao_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_saude_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_saude_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_seguro_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_seguro_padrao >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_epi_padrao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_epi_padrao >= 0),
  ADD COLUMN IF NOT EXISTS dsr_fator numeric(6, 5) NOT NULL DEFAULT 0.16667 CHECK (dsr_fator BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS rpa_inss_pct numeric(6, 3) CHECK (rpa_inss_pct IS NULL OR rpa_inss_pct BETWEEN 0 AND 100),  -- null = regra do regime
  ADD COLUMN IF NOT EXISTS salario_minimo_ref numeric(12, 2) NOT NULL DEFAULT 1518 CHECK (salario_minimo_ref > 0),
  ADD COLUMN IF NOT EXISTS incidencia_padrao jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {"tipo" | "tipo:subtipo": {gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao}}

ALTER TABLE public.erp_mao_obra_custo DROP CONSTRAINT IF EXISTS erp_mao_obra_custo_vinculo_check;
ALTER TABLE public.erp_mao_obra_custo ADD CONSTRAINT erp_mao_obra_custo_vinculo_check CHECK (vinculo IN ('clt', 'clt_intermitente', 'rpa', 'pj', 'diarista'));
ALTER TABLE public.erp_mao_obra_custo DROP CONSTRAINT IF EXISTS erp_mao_obra_custo_forma_pagamento_check;
ALTER TABLE public.erp_mao_obra_custo ADD CONSTRAINT erp_mao_obra_custo_forma_pagamento_check CHECK (forma_pagamento IN ('mensal', 'hora', 'producao', 'diaria', 'm2'));
ALTER TABLE public.erp_mao_obra_custo
  ADD COLUMN IF NOT EXISTS mei_servico_obra boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dsr_fator_ajuste numeric(6, 5) CHECK (dsr_fator_ajuste IS NULL OR dsr_fator_ajuste BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS encargos_folha_pct_ajuste numeric(7, 4) CHECK (encargos_folha_pct_ajuste IS NULL OR encargos_folha_pct_ajuste BETWEEN 0 AND 150),
  ADD COLUMN IF NOT EXISTS prov_13_pct_ajuste numeric(6, 3) CHECK (prov_13_pct_ajuste IS NULL OR prov_13_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS prov_ferias_pct_ajuste numeric(6, 3) CHECK (prov_ferias_pct_ajuste IS NULL OR prov_ferias_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS prov_rescisao_pct_ajuste numeric(6, 3) CHECK (prov_rescisao_pct_ajuste IS NULL OR prov_rescisao_pct_ajuste BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ajuste_por uuid,
  ADD COLUMN IF NOT EXISTS ajuste_em timestamptz,
  ADD COLUMN IF NOT EXISTS chaves_confirmadas_por uuid,
  ADD COLUMN IF NOT EXISTS chaves_confirmadas_em timestamptz;

ALTER TABLE public.erp_funcao_mao_obra DROP CONSTRAINT IF EXISTS erp_funcao_mao_obra_forma_pagamento_check;
ALTER TABLE public.erp_funcao_mao_obra ADD CONSTRAINT erp_funcao_mao_obra_forma_pagamento_check CHECK (forma_pagamento IN ('mensal', 'hora', 'producao', 'diaria', 'm2'));
ALTER TABLE public.erp_funcao_mao_obra ADD COLUMN IF NOT EXISTS unidade_producao text;

-- componentes da remuneração (um por linha; cada reajuste copia para a nova vigência)
CREATE TABLE IF NOT EXISTS public.erp_mao_obra_componente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id uuid NOT NULL REFERENCES public.erp_mao_obra_custo(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ordem int NOT NULL DEFAULT 0,
  tipo text NOT NULL CHECK (tipo IN ('fixo', 'producao', 'empreitada', 'diaria', 'comissao', 'bonus', 'hora_extra', 'adicional')),
  subtipo text,          -- fixo: mensal|hora · adicional: insalubridade|periculosidade|noturno|outro
  descricao text,
  valor numeric(14, 4) NOT NULL DEFAULT 0 CHECK (valor >= 0),          -- R$ (mês, hora, unidade, obra, dia, bônus)
  quantidade numeric(14, 4) NOT NULL DEFAULT 0 CHECK (quantidade >= 0), -- volume/mês, horas, dias, dias da obra, base da comissão
  percentual numeric(8, 4) CHECK (percentual IS NULL OR percentual BETWEEN 0 AND 1000),  -- comissão %, adicional da HE, % do adicional
  unidade text,          -- m2, m, ponto, peca… (produção)
  estimado boolean NOT NULL DEFAULT false,
  gera_dsr boolean NOT NULL DEFAULT false,
  integra_13_ferias boolean NOT NULL DEFAULT false,
  incide_encargos boolean NOT NULL DEFAULT false,
  integra_remuneracao boolean NOT NULL DEFAULT false,
  chaves_ajustadas boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mao_obra_componente_ficha ON public.erp_mao_obra_componente (ficha_id, ordem);
ALTER TABLE public.erp_mao_obra_componente ENABLE ROW LEVEL SECURITY;
-- salário por componente: só pelas funções (que gravam o log de abertura); nada de leitura direta
REVOKE ALL ON public.erp_mao_obra_componente FROM anon, authenticated;

-- ───────────────────────────── chaves de incidência padrão ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_chaves_padrao(p_vinculo text, p_tipo text, p_subtipo text DEFAULT NULL, p_empresa jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE k text := p_tipo || COALESCE(':' || NULLIF(p_subtipo, ''), '');
BEGIN
  IF COALESCE(p_vinculo, 'clt') NOT IN ('clt', 'clt_intermitente') THEN
    -- terceiros: cada componente usa a regra do vínculo (RPA, MEI/PJ, empreiteiro, diarista) — sem chaves de folha
    RETURN jsonb_build_object('gera_dsr', false, 'integra_13_ferias', false, 'incide_encargos', false, 'integra_remuneracao', false);
  END IF;
  IF p_empresa ? k THEN RETURN p_empresa->k; END IF;               -- padrão da empresa (confirmado pelo contador)
  IF p_empresa ? p_tipo THEN RETURN p_empresa->p_tipo; END IF;
  RETURN CASE
    WHEN p_tipo = 'bonus' THEN jsonb_build_object('gera_dsr', false, 'integra_13_ferias', false, 'incide_encargos', false, 'integra_remuneracao', false)
    WHEN p_tipo = 'fixo' AND COALESCE(p_subtipo, 'mensal') = 'mensal' THEN jsonb_build_object('gera_dsr', false, 'integra_13_ferias', true, 'incide_encargos', true, 'integra_remuneracao', true)
    WHEN p_tipo = 'adicional' AND COALESCE(p_subtipo, 'outro') <> 'noturno' THEN jsonb_build_object('gera_dsr', false, 'integra_13_ferias', true, 'incide_encargos', true, 'integra_remuneracao', true)
    ELSE jsonb_build_object('gera_dsr', true, 'integra_13_ferias', true, 'incide_encargos', true, 'integra_remuneracao', true)
  END;
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_chaves_padrao(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_chaves_padrao(text, text, text, jsonb) TO authenticated, service_role;

-- ───────────────────────────── padrões da empresa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_encargos_vigentes(p_company_id uuid, p_data date DEFAULT current_date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e record; v_reg text; v_reg_raw text; v_inss numeric; v_rat numeric; v_terc numeric; v_total numeric; v_anexo text;
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
        'beneficio_seguro', e.beneficio_seguro_padrao, 'beneficio_epi', e.beneficio_epi_padrao, 'dsr_fator', e.dsr_fator,
        -- INSS do RPA: 0% no Simples Anexo III/V (já no DAS); 20% no Anexo IV, Real e Presumido — salvo valor da empresa
        'rpa_inss_pct', COALESCE(e.rpa_inss_pct, CASE WHEN e.regime = 'simples' AND e.simples_anexo IN ('III', 'V') THEN 0 ELSE 20 END),
        'salario_minimo', e.salario_minimo_ref, 'incidencia', e.incidencia_padrao));
  END IF;
  SELECT lower(COALESCE(regime_tributario, '')) INTO v_reg_raw FROM companies WHERE id = p_company_id;
  v_reg := CASE WHEN v_reg_raw LIKE '%simples%' THEN 'simples' WHEN v_reg_raw LIKE '%real%' THEN 'real' ELSE 'presumido' END;
  v_anexo := CASE WHEN v_reg = 'simples' THEN 'IV' END;   -- Simples sem anexo informado: assume Anexo IV (obra)
  IF v_reg = 'simples' THEN v_inss := 20; v_rat := 3; v_terc := 0;
  ELSE v_inss := 20; v_rat := 3; v_terc := 5.8; END IF;
  v_total := v_inss + v_rat + v_terc + 8;
  RETURN jsonb_build_object('fonte', 'padrao_regime', 'provisorio', true, 'regime', v_reg, 'simples_anexo', v_anexo,
    'inss_patronal_pct', v_inss, 'rat_pct', v_rat, 'fap', 1, 'terceiros_pct', v_terc, 'fgts_pct', 8,
    'desoneracao', false, 'desoneracao_fator_folha', 1, 'cprb_pct', NULL,
    'prov_13_pct', 8.33, 'prov_ferias_pct', 11.11, 'prov_rescisao_pct', 4,
    'encargos_folha_pct', v_total, 'vigencia_inicio', NULL, 'confirmado_em', NULL,
    'padroes', jsonb_build_object('horas_produtivas_mes', 176, 'vinculo', 'clt', 'forma_pagamento', 'mensal',
      'beneficio_vt', 0, 'beneficio_alimentacao', 0, 'beneficio_saude', 0, 'beneficio_seguro', 0, 'beneficio_epi', 0,
      'dsr_fator', 0.16667, 'rpa_inss_pct', 20, 'salario_minimo', 1518, 'incidencia', '{}'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) TO authenticated, service_role;

-- salvar padrões: mudar só os padrões da ficha não derruba a confirmação do contador (percentuais iguais à vigente)
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
  n_rpa numeric := NULLIF(p_dados->>'rpa_inss_pct', '')::numeric;
  n_inc jsonb := COALESCE(p_dados->'incidencia_padrao', '{}'::jsonb);
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF v_reg NOT IN ('simples', 'presumido', 'real') THEN RAISE EXCEPTION 'Informe o regime (simples, presumido ou real).'; END IF;
  IF p_confirmar THEN v_conf_por := auth.uid(); v_conf_em := now();
  ELSE
    SELECT * INTO a FROM erp_encargos_empresa WHERE company_id = p_company_id AND vigencia_inicio <= v_vig ORDER BY vigencia_inicio DESC LIMIT 1;
    IF FOUND AND a.confirmado_em IS NOT NULL AND a.regime = v_reg AND a.inss_patronal_pct = n_inss AND a.rat_pct = n_rat AND a.fap = n_fap
       AND a.terceiros_pct = n_terc AND a.fgts_pct = n_fgts AND a.prov_13_pct = n_13 AND a.prov_ferias_pct = n_fer AND a.prov_rescisao_pct = n_resc
       AND a.desoneracao = n_des AND a.desoneracao_fator_folha = n_fator AND a.cprb_pct IS NOT DISTINCT FROM n_cprb
       AND a.rpa_inss_pct IS NOT DISTINCT FROM n_rpa AND a.incidencia_padrao = n_inc THEN
      v_conf_por := a.confirmado_por; v_conf_em := a.confirmado_em;  -- só padrões da ficha mudaram: a confirmação continua
    END IF;
  END IF;
  INSERT INTO erp_encargos_empresa (company_id, vigencia_inicio, regime, simples_anexo, inss_patronal_pct, rat_pct, fap, terceiros_pct, fgts_pct,
         prov_13_pct, prov_ferias_pct, prov_rescisao_pct, desoneracao, desoneracao_fator_folha, cprb_pct, confirmado_por, confirmado_em, observacao,
         horas_produtivas_padrao, vinculo_padrao, forma_padrao, beneficio_vt_padrao, beneficio_alimentacao_padrao, beneficio_saude_padrao,
         beneficio_seguro_padrao, beneficio_epi_padrao, dsr_fator, rpa_inss_pct, salario_minimo_ref, incidencia_padrao)
  VALUES (p_company_id, v_vig, v_reg, NULLIF(p_dados->>'simples_anexo', ''), n_inss, n_rat, n_fap, n_terc, n_fgts, n_13, n_fer, n_resc, n_des, n_fator, n_cprb,
          v_conf_por, v_conf_em, NULLIF(btrim(p_dados->>'observacao'), ''),
          COALESCE(NULLIF(p_dados->>'horas_produtivas_padrao', '')::numeric, 176), COALESCE(NULLIF(p_dados->>'vinculo_padrao', ''), 'clt'),
          COALESCE(NULLIF(p_dados->>'forma_padrao', ''), 'mensal'), COALESCE(NULLIF(p_dados->>'beneficio_vt_padrao', '')::numeric, 0),
          COALESCE(NULLIF(p_dados->>'beneficio_alimentacao_padrao', '')::numeric, 0), COALESCE(NULLIF(p_dados->>'beneficio_saude_padrao', '')::numeric, 0),
          COALESCE(NULLIF(p_dados->>'beneficio_seguro_padrao', '')::numeric, 0), COALESCE(NULLIF(p_dados->>'beneficio_epi_padrao', '')::numeric, 0),
          COALESCE(NULLIF(p_dados->>'dsr_fator', '')::numeric, 0.16667), n_rpa,
          COALESCE(NULLIF(p_dados->>'salario_minimo_ref', '')::numeric, 1518), n_inc)
  ON CONFLICT (company_id, vigencia_inicio) DO UPDATE SET
    regime = EXCLUDED.regime, simples_anexo = EXCLUDED.simples_anexo, inss_patronal_pct = EXCLUDED.inss_patronal_pct, rat_pct = EXCLUDED.rat_pct,
    fap = EXCLUDED.fap, terceiros_pct = EXCLUDED.terceiros_pct, fgts_pct = EXCLUDED.fgts_pct, prov_13_pct = EXCLUDED.prov_13_pct,
    prov_ferias_pct = EXCLUDED.prov_ferias_pct, prov_rescisao_pct = EXCLUDED.prov_rescisao_pct, desoneracao = EXCLUDED.desoneracao,
    desoneracao_fator_folha = EXCLUDED.desoneracao_fator_folha, cprb_pct = EXCLUDED.cprb_pct,
    confirmado_por = EXCLUDED.confirmado_por, confirmado_em = EXCLUDED.confirmado_em, observacao = EXCLUDED.observacao,
    horas_produtivas_padrao = EXCLUDED.horas_produtivas_padrao, vinculo_padrao = EXCLUDED.vinculo_padrao, forma_padrao = EXCLUDED.forma_padrao,
    beneficio_vt_padrao = EXCLUDED.beneficio_vt_padrao, beneficio_alimentacao_padrao = EXCLUDED.beneficio_alimentacao_padrao,
    beneficio_saude_padrao = EXCLUDED.beneficio_saude_padrao, beneficio_seguro_padrao = EXCLUDED.beneficio_seguro_padrao,
    beneficio_epi_padrao = EXCLUDED.beneficio_epi_padrao, dsr_fator = EXCLUDED.dsr_fator, rpa_inss_pct = EXCLUDED.rpa_inss_pct,
    salario_minimo_ref = EXCLUDED.salario_minimo_ref, incidencia_padrao = EXCLUDED.incidencia_padrao
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, auth.uid(), 'erp_encargos_empresa', v_id::text, CASE WHEN p_confirmar THEN 'ENCARGOS_CONFIRMADOS' ELSE 'ENCARGOS_SALVOS' END, p_dados);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'encargos', public.fn_mao_obra_encargos_vigentes(p_company_id));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) TO authenticated, service_role;

-- ───────────────────────────── o cálculo (a mesma conta de src/lib/hub/custoMaoObra.ts) ─────────────────────────────
-- Para cada componente, o valor do mês: fixo mensal = valor; fixo por hora = valor × horas; produção = R$/unidade × volume;
-- empreitada = valor × 30 ÷ dias da obra; diária = R$ × dias; comissão = % × base; bônus = valor; hora extra = horas ×
-- valor da hora (fixo ÷ 220, ou o informado) × (1 + adicional); insalubridade = % do salário mínimo; periculosidade = %
-- (30) do fixo; noturno = horas × hora × % (20).
-- CLT/intermitente: DSR = fator × (componentes que geram DSR); provisões = (que entram em 13º/férias + DSR) × (13º + férias);
-- encargos = (que incidem INSS/FGTS + DSR + provisões) × encargos %; rescisão = (que integram + DSR) × rescisão %.
-- RPA e diarista (autônomo): + INSS do RPA sobre o valor. MEI/PJ/empreiteiro: sem encargos, salvo MEI em serviço de obra
-- (+20%). Componente que NÃO integra a remuneração entra só pelo valor. Benefícios somam no fim.
-- Exemplo da SPEC 5.1: fixo 2.000 + 3,00/m² × 500 → 7.077,27/mês → 40,21/h ou 14,15/m².
CREATE OR REPLACE FUNCTION public.fn_mao_obra_custo_calcular(p_ficha jsonb, p_encargos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  vinc text := COALESCE(p_ficha->>'vinculo', 'clt'); forma text := COALESCE(p_ficha->>'forma_pagamento', 'mensal');
  pad jsonb := COALESCE(p_encargos->'padroes', '{}'::jsonb);
  horas numeric := NULLIF(COALESCE((p_ficha->>'horas_produtivas_mes')::numeric, 176), 0);
  ben numeric := COALESCE((p_ficha->>'beneficio_vt')::numeric, 0) + COALESCE((p_ficha->>'beneficio_alimentacao')::numeric, 0) + COALESCE((p_ficha->>'beneficio_saude')::numeric, 0) + COALESCE((p_ficha->>'beneficio_seguro')::numeric, 0) + COALESCE((p_ficha->>'beneficio_epi')::numeric, 0);
  p13 numeric := COALESCE((p_ficha->>'prov_13_pct_ajuste')::numeric, (p_encargos->>'prov_13_pct')::numeric, 8.33);
  pfer numeric := COALESCE((p_ficha->>'prov_ferias_pct_ajuste')::numeric, (p_encargos->>'prov_ferias_pct')::numeric, 11.11);
  presc numeric := COALESCE((p_ficha->>'prov_rescisao_pct_ajuste')::numeric, (p_encargos->>'prov_rescisao_pct')::numeric, 4);
  encp numeric := COALESCE((p_ficha->>'encargos_folha_pct_ajuste')::numeric, (p_encargos->>'encargos_folha_pct')::numeric, 36.8);
  dsrf numeric := COALESCE((p_ficha->>'dsr_fator_ajuste')::numeric, (pad->>'dsr_fator')::numeric, 1.0 / 6);
  rpa numeric := COALESCE((pad->>'rpa_inss_pct')::numeric, 20);
  sm numeric := COALESCE((pad->>'salario_minimo')::numeric, 1518);
  comps jsonb := COALESCE(p_ficha->'componentes', '[]'::jsonb);
  c jsonb; v numeric; tipo text; sub text; integ boolean;
  fixo_mes numeric := 0; hora_fixa numeric := 0; hora_base numeric;
  a numeric := 0; s_dsr numeric := 0; s_13 numeric := 0; s_enc numeric := 0; s_int numeric := 0;
  d numeric := 0; p numeric := 0; e numeric := 0; r numeric := 0; mensal numeric;
  vol numeric := 0; uni text; val_prod numeric; dias_diaria numeric := 0; estimado boolean := false; alertas jsonb := '[]'::jsonb;
BEGIN
  -- ficha antiga (sem componentes): vira componentes equivalentes (mesmo resultado de antes)
  IF jsonb_typeof(comps) <> 'array' OR jsonb_array_length(comps) = 0 THEN
    comps := '[]'::jsonb;
    IF vinc = 'diarista' THEN
      comps := comps || jsonb_build_object('tipo', 'diaria', 'valor', COALESCE((p_ficha->>'valor_unidade')::numeric, 0), 'quantidade', COALESCE((p_ficha->>'dias_mes')::numeric, 22));
    ELSIF vinc = 'pj' AND forma = 'hora' THEN
      comps := comps || jsonb_build_object('tipo', 'fixo', 'subtipo', 'hora', 'valor', COALESCE((p_ficha->>'valor_unidade')::numeric, 0), 'quantidade', COALESCE(horas, 0));
    ELSIF vinc = 'pj' AND forma IN ('m2', 'producao') THEN
      comps := comps || jsonb_build_object('tipo', 'producao', 'valor', COALESCE((p_ficha->>'valor_unidade')::numeric, 0), 'quantidade', 0, 'unidade', 'm2');
    ELSE
      comps := comps || (jsonb_build_object('tipo', 'fixo', 'subtipo', 'mensal', 'valor', COALESCE((p_ficha->>'salario')::numeric, 0)) || public.fn_mao_obra_chaves_padrao(vinc, 'fixo', 'mensal'));
      IF vinc IN ('clt', 'clt_intermitente') THEN
        comps := comps || (jsonb_build_object('tipo', 'adicional', 'subtipo', 'outro', 'valor', COALESCE((p_ficha->>'adicional_insalubridade')::numeric, 0) + COALESCE((p_ficha->>'adicional_periculosidade')::numeric, 0) + COALESCE((p_ficha->>'adicional_outros')::numeric, 0)) || public.fn_mao_obra_chaves_padrao(vinc, 'adicional', 'outro'));
      END IF;
    END IF;
  END IF;
  -- 1ª passada: o fixo (base da hora, da periculosidade e da hora extra)
  FOR c IN SELECT * FROM jsonb_array_elements(comps) LOOP
    IF c->>'tipo' = 'fixo' THEN
      IF COALESCE(c->>'subtipo', 'mensal') = 'hora' THEN hora_fixa := hora_fixa + COALESCE((c->>'valor')::numeric, 0);
      ELSE fixo_mes := fixo_mes + COALESCE((c->>'valor')::numeric, 0); END IF;
    END IF;
  END LOOP;
  hora_base := fixo_mes / 220 + hora_fixa;
  -- 2ª passada: valor do mês de cada componente e as somas por chave
  FOR c IN SELECT * FROM jsonb_array_elements(comps) LOOP
    tipo := c->>'tipo'; sub := c->>'subtipo';
    v := CASE tipo
      WHEN 'fixo' THEN CASE WHEN COALESCE(sub, 'mensal') = 'hora' THEN COALESCE((c->>'valor')::numeric, 0) * COALESCE((c->>'quantidade')::numeric, 0) ELSE COALESCE((c->>'valor')::numeric, 0) END
      WHEN 'producao' THEN COALESCE((c->>'valor')::numeric, 0) * COALESCE((c->>'quantidade')::numeric, 0)
      WHEN 'empreitada' THEN COALESCE((c->>'valor')::numeric, 0) * 30 / GREATEST(COALESCE((c->>'quantidade')::numeric, 0), 1)
      WHEN 'diaria' THEN COALESCE((c->>'valor')::numeric, 0) * COALESCE((c->>'quantidade')::numeric, 0)
      WHEN 'comissao' THEN COALESCE((c->>'percentual')::numeric, 0) / 100 * COALESCE((c->>'quantidade')::numeric, 0)
      WHEN 'bonus' THEN COALESCE((c->>'valor')::numeric, 0)
      WHEN 'hora_extra' THEN COALESCE((c->>'quantidade')::numeric, 0) * COALESCE(NULLIF((c->>'valor')::numeric, 0), hora_base) * (1 + COALESCE((c->>'percentual')::numeric, 50) / 100)
      WHEN 'adicional' THEN CASE COALESCE(sub, 'outro')
        WHEN 'insalubridade' THEN COALESCE((c->>'percentual')::numeric, 20) / 100 * sm
        WHEN 'periculosidade' THEN COALESCE((c->>'percentual')::numeric, 30) / 100 * fixo_mes
        WHEN 'noturno' THEN COALESCE((c->>'quantidade')::numeric, 0) * hora_base * COALESCE((c->>'percentual')::numeric, 20) / 100
        ELSE COALESCE((c->>'valor')::numeric, 0) END
      ELSE 0 END;
    a := a + v;
    integ := COALESCE((c->>'integra_remuneracao')::boolean, false);
    IF integ THEN
      s_int := s_int + v;
      IF COALESCE((c->>'gera_dsr')::boolean, false) THEN s_dsr := s_dsr + v; END IF;
      IF COALESCE((c->>'integra_13_ferias')::boolean, false) THEN s_13 := s_13 + v; END IF;
      IF COALESCE((c->>'incide_encargos')::boolean, false) THEN s_enc := s_enc + v; END IF;
    END IF;
    IF tipo = 'producao' THEN
      vol := vol + COALESCE((c->>'quantidade')::numeric, 0);
      uni := COALESCE(uni, NULLIF(c->>'unidade', ''), 'm2'); val_prod := COALESCE(val_prod, (c->>'valor')::numeric);
    END IF;
    IF tipo = 'diaria' THEN dias_diaria := dias_diaria + COALESCE((c->>'quantidade')::numeric, 0); END IF;
    IF COALESCE((c->>'estimado')::boolean, false) THEN estimado := true; END IF;
  END LOOP;

  IF vinc IN ('clt', 'clt_intermitente') THEN
    d := s_dsr * dsrf;
    p := (s_13 + d) * (p13 + pfer) / 100;
    e := (s_enc + d + p) * encp / 100;
    r := (s_int + d) * presc / 100;
  ELSIF vinc IN ('rpa', 'diarista') THEN
    e := a * rpa / 100;                          -- diarista: calculado como autônomo (CEO 01/10)
  ELSIF vinc = 'pj' AND COALESCE((p_ficha->>'mei_servico_obra')::boolean, false) THEN
    e := a * 20 / 100;                           -- MEI em serviço de obra: contratante paga 20% de INSS (LC 123)
  END IF;
  mensal := a + d + p + e + r + ben;
  IF a = 0 AND val_prod IS NOT NULL THEN mensal := NULL; END IF;   -- só produção, sem volume: não inventa custo mensal
  IF vinc = 'diarista' AND dias_diaria > 8 THEN alertas := alertas || '"diarista_mais_8_dias"'::jsonb; END IF;
  IF estimado THEN alertas := alertas || '"volume_estimado"'::jsonb; END IF;
  RETURN jsonb_build_object('base', round(a, 2), 'dsr', round(d, 2), 'provisoes', round(p, 2), 'remuneracao', round(a + d + p, 2),
    'encargos', round(e, 2), 'rescisao', round(r, 2), 'beneficios', round(ben, 2),
    'custo_mensal', round(mensal, 2), 'custo_hora', round(CASE WHEN mensal IS NULL OR horas IS NULL THEN NULL ELSE mensal / horas END, 2),
    'custo_unidade', round(CASE WHEN vol > 0 THEN mensal / vol WHEN val_prod IS NOT NULL THEN val_prod END, 2), 'unidade', uni,
    'custo_m2', round(CASE WHEN vol > 0 AND COALESCE(uni, 'm2') = 'm2' THEN mensal / vol WHEN val_prod IS NOT NULL AND COALESCE(uni, 'm2') = 'm2' AND vol = 0 THEN val_prod END, 2),
    'encargos_folha_pct', encp, 'prov_13_pct', p13, 'prov_ferias_pct', pfer, 'prov_rescisao_pct', presc, 'dsr_fator', dsrf, 'rpa_inss_pct', rpa,
    'alertas', alertas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) TO authenticated, service_role;

-- ficha + componentes, para o cálculo (interna)
-- ci-sem-guarda: fn__mao_obra_ficha_json — interna e só leitura; sem EXECUTE para authenticated
CREATE OR REPLACE FUNCTION public.fn__mao_obra_ficha_json(p_ficha_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(k) || jsonb_build_object('componentes', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) - ARRAY['ficha_id', 'company_id', 'created_at'] ORDER BY x.ordem, x.created_at)
             FROM erp_mao_obra_componente x WHERE x.ficha_id = k.id), '[]'::jsonb))
    FROM erp_mao_obra_custo k WHERE k.id = p_ficha_id
$function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_ficha_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_ficha_json(uuid) TO service_role;

-- grava a lista de componentes de uma ficha (chaves vêm do padrão quando não informadas)
-- ci-sem-guarda: fn__mao_obra_componentes_gravar — interna; só as funções de ficha (já guardadas) a chamam; sem EXECUTE para authenticated
CREATE OR REPLACE FUNCTION public.fn__mao_obra_componentes_gravar(p_ficha_id uuid, p_company_id uuid, p_vinculo text, p_comps jsonb)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb; ch jsonb; i int := 0; v_inc jsonb := COALESCE(public.fn_mao_obra_encargos_vigentes(p_company_id)->'padroes'->'incidencia', '{}'::jsonb);
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_comps, '[]'::jsonb)) LOOP
    IF c->>'tipo' NOT IN ('fixo', 'producao', 'empreitada', 'diaria', 'comissao', 'bonus', 'hora_extra', 'adicional') THEN
      RAISE EXCEPTION 'Tipo de componente inválido: %', c->>'tipo';
    END IF;
    ch := public.fn_mao_obra_chaves_padrao(p_vinculo, c->>'tipo', c->>'subtipo', v_inc);
    INSERT INTO erp_mao_obra_componente (ficha_id, company_id, ordem, tipo, subtipo, descricao, valor, quantidade, percentual, unidade, estimado,
           gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao, chaves_ajustadas)
    VALUES (p_ficha_id, p_company_id, i, c->>'tipo', NULLIF(c->>'subtipo', ''), NULLIF(btrim(c->>'descricao'), ''),
            COALESCE(NULLIF(c->>'valor', '')::numeric, 0), COALESCE(NULLIF(c->>'quantidade', '')::numeric, 0), NULLIF(c->>'percentual', '')::numeric,
            NULLIF(c->>'unidade', ''), COALESCE((c->>'estimado')::boolean, false),
            COALESCE((c->>'gera_dsr')::boolean, (ch->>'gera_dsr')::boolean), COALESCE((c->>'integra_13_ferias')::boolean, (ch->>'integra_13_ferias')::boolean),
            COALESCE((c->>'incide_encargos')::boolean, (ch->>'incide_encargos')::boolean), COALESCE((c->>'integra_remuneracao')::boolean, (ch->>'integra_remuneracao')::boolean),
            COALESCE((c->>'gera_dsr')::boolean, (ch->>'gera_dsr')::boolean) IS DISTINCT FROM (ch->>'gera_dsr')::boolean
            OR COALESCE((c->>'integra_13_ferias')::boolean, (ch->>'integra_13_ferias')::boolean) IS DISTINCT FROM (ch->>'integra_13_ferias')::boolean
            OR COALESCE((c->>'incide_encargos')::boolean, (ch->>'incide_encargos')::boolean) IS DISTINCT FROM (ch->>'incide_encargos')::boolean
            OR COALESCE((c->>'integra_remuneracao')::boolean, (ch->>'integra_remuneracao')::boolean) IS DISTINCT FROM (ch->>'integra_remuneracao')::boolean);
    i := i + 1;
  END LOOP;
  RETURN i;
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_componentes_gravar(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_componentes_gravar(uuid, uuid, text, jsonb) TO service_role;

-- valor do mês dos componentes da lista (para "pelo menos um componente com valor")
CREATE OR REPLACE FUNCTION public.fn__mao_obra_componentes_tem_valor(p_ficha jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(bool_or(
           COALESCE(NULLIF(c->>'valor', '')::numeric, 0) > 0
           OR (c->>'tipo' = 'comissao' AND COALESCE(NULLIF(c->>'percentual', '')::numeric, 0) > 0 AND COALESCE(NULLIF(c->>'quantidade', '')::numeric, 0) > 0)
           OR (c->>'tipo' = 'adicional' AND c->>'subtipo' IN ('insalubridade', 'periculosidade') AND COALESCE(NULLIF(c->>'percentual', '')::numeric, 0) > 0)),
         false)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_ficha->'componentes') = 'array' THEN p_ficha->'componentes' ELSE '[]'::jsonb END) c
$function$;

-- ───────────────────────────── custo da função (média do grupo, só conferidas) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_funcao_custo_hora(p_funcao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f record; v_chave text; v_empresas uuid[]; v_num numeric := 0; v_den numeric := 0; v_u_num numeric := 0; v_u_den numeric := 0;
  v_pessoas int := 0; v_emps int := 0; r record; c jsonb; w numeric; v_pend int := 0; v_uni text;
BEGIN
  SELECT * INTO f FROM erp_funcao_mao_obra WHERE id = p_funcao_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND f.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_chave := public.fn__mao_obra_funcao_chave(p_funcao_id);
  SELECT array_agg(c2.id) INTO v_empresas FROM companies c1 JOIN companies c2
    ON (c1.group_id IS NOT NULL AND c2.group_id = c1.group_id) OR c2.id = c1.id
   WHERE c1.id = f.company_id;
  FOR r IN
    SELECT k.* FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
     WHERE k.company_id = ANY(v_empresas) AND k.ativo AND k.vigencia_fim IS NULL
       AND fx.ativo AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave
  LOOP
    IF NOT r.conferido THEN v_pend := v_pend + 1; CONTINUE; END IF;
    c := public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(r.id), public.fn_mao_obra_encargos_vigentes(r.company_id));
    w := r.horas_produtivas_mes * r.quantidade_pessoas;
    IF (c->>'custo_hora') IS NOT NULL THEN v_num := v_num + (c->>'custo_hora')::numeric * w; v_den := v_den + w; END IF;
    IF (c->>'custo_unidade') IS NOT NULL THEN v_u_num := v_u_num + (c->>'custo_unidade')::numeric * r.quantidade_pessoas; v_u_den := v_u_den + r.quantidade_pessoas; v_uni := COALESCE(v_uni, c->>'unidade'); END IF;
    v_pessoas := v_pessoas + r.quantidade_pessoas;
  END LOOP;
  SELECT count(DISTINCT k.company_id) INTO v_emps FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
   WHERE k.company_id = ANY(v_empresas) AND k.ativo AND k.vigencia_fim IS NULL AND k.conferido AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave;
  RETURN jsonb_build_object(
    'funcao_id', p_funcao_id,
    'custo_hora', CASE WHEN v_den > 0 THEN round(v_num / v_den, 2) ELSE f.custo_hora_manual END,
    'custo_unidade', CASE WHEN v_u_den > 0 THEN round(v_u_num / v_u_den, 2) END, 'unidade', v_uni,
    'custo_m2', CASE WHEN v_u_den > 0 AND COALESCE(v_uni, 'm2') = 'm2' THEN round(v_u_num / v_u_den, 2) END,
    'origem', CASE WHEN v_den > 0 OR v_u_den > 0 THEN 'media_grupo' WHEN f.custo_hora_manual IS NOT NULL THEN 'manual' ELSE 'sem_dado' END,
    'pessoas_conferidas', v_pessoas, 'empresas', v_emps, 'nao_conferidas', v_pend, 'horas_base', v_den);
END $function$;
REVOKE ALL ON FUNCTION public.fn_funcao_custo_hora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_funcao_custo_hora(uuid) TO authenticated, service_role;

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
  -- média do fixo mensal das fichas CLT conferidas do grupo (componente fixo; ficha antiga: coluna salário)
  SELECT round(sum(x.fixo * x.quantidade_pessoas) / NULLIF(sum(x.quantidade_pessoas), 0), 2), sum(x.quantidade_pessoas)::int INTO v_media, v_n
    FROM (
      SELECT k.quantidade_pessoas,
             COALESCE((SELECT sum(cp.valor) FROM erp_mao_obra_componente cp WHERE cp.ficha_id = k.id AND cp.tipo = 'fixo' AND COALESCE(cp.subtipo, 'mensal') = 'mensal'), k.salario) fixo
        FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
        JOIN companies c1 ON c1.id = f.company_id JOIN companies c2 ON c2.id = k.company_id AND (c2.id = c1.id OR (c1.group_id IS NOT NULL AND c2.group_id = c1.group_id))
       WHERE k.ativo AND k.vigencia_fim IS NULL AND k.conferido AND k.vinculo IN ('clt', 'clt_intermitente') AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave
    ) x WHERE x.fixo > 0;
  IF v_media IS NOT NULL THEN RETURN jsonb_build_object('valor', v_media, 'origem', 'media_conferida', 'pessoas', v_n, 'forma', f.forma_pagamento, 'unidade', f.unidade_producao); END IF;
  IF f.custo_hora_manual IS NOT NULL THEN
    v_fator := (1 + ((p_enc->>'prov_13_pct')::numeric + (p_enc->>'prov_ferias_pct')::numeric) / 100) * (1 + (p_enc->>'encargos_folha_pct')::numeric / 100)
               + (p_enc->>'prov_rescisao_pct')::numeric / 100;
    RETURN jsonb_build_object('valor', round(f.custo_hora_manual * 176 / v_fator, 2), 'origem', 'estimado_custo_hora', 'pessoas', 0, 'forma', f.forma_pagamento, 'unidade', f.unidade_producao);
  END IF;
  RETURN jsonb_build_object('valor', NULL, 'origem', 'sem_dado', 'pessoas', 0, 'forma', f.forma_pagamento, 'unidade', f.unidade_producao);
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'cbo', f.cbo, 'forma_pagamento', f.forma_pagamento, 'unidade_producao', f.unidade_producao,
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
      'matricula', cf.matricula, 'data_admissao', cf.data_admissao, 'chaves_confirmadas', k.chaves_confirmadas_em IS NOT NULL,
      'ficha', CASE WHEN v_pode THEN public.fn__mao_obra_ficha_json(k.id) - ARRAY['company_id', 'created_by', 'conferido_por', 'ajuste_por', 'chaves_confirmadas_por'] END,
      'ajuste_por_nome', CASE WHEN v_pode AND k.ajuste_por IS NOT NULL THEN (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = k.ajuste_por) END,
      'custo', CASE WHEN v_pode THEN public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(k.id), public.fn_mao_obra_encargos_vigentes(k.company_id)) END) x
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

CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_historico(p_grupo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_mao_obra_custo WHERE grupo_id = p_grupo_id LIMIT 1;
  IF v_company IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF NOT public.fn__mao_obra_pode_ver_individual(v_company) THEN RAISE EXCEPTION 'Só gestor ou financeiro da empresa vê o histórico de custo.' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO erp_mao_obra_acesso_log (company_id, user_id, ficha_id, grupo_id, origem)
    SELECT k.company_id, auth.uid(), k.id, k.grupo_id, 'historico' FROM erp_mao_obra_custo k WHERE k.grupo_id = p_grupo_id;
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('vigencia_inicio', k.vigencia_inicio, 'vigencia_fim', k.vigencia_fim, 'salario', k.salario,
            'valor_unidade', k.valor_unidade, 'motivo', k.motivo, 'conferido', k.conferido,
            'custo', public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(k.id), public.fn_mao_obra_encargos_vigentes(k.company_id, k.vigencia_inicio))) ORDER BY k.vigencia_inicio DESC), '[]'::jsonb)
            FROM erp_mao_obra_custo k WHERE k.grupo_id = p_grupo_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_historico(uuid) TO authenticated, service_role;

-- ajustes de percentuais (aceita null explícito = "voltar ao padrão")
CREATE OR REPLACE FUNCTION public.fn__mao_obra_ficha_ajustes(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(jsonb_object_agg(k, p->k), '{}'::jsonb)
    FROM unnest(ARRAY['encargos_folha_pct_ajuste', 'prov_13_pct_ajuste', 'prov_ferias_pct_ajuste', 'prov_rescisao_pct_ajuste', 'dsr_fator_ajuste']) k
   WHERE p ? k
$function$;

-- ───────────────────────────── salvar ficha ─────────────────────────────
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
  -- componentes; tela antiga (ainda aberta no navegador durante o deploy) manda salário/valor: vira componente equivalente
  v_comps jsonb := CASE
    WHEN jsonb_typeof(p_ficha->'componentes') = 'array' THEN p_ficha->'componentes'
    WHEN COALESCE(NULLIF(p_ficha->>'salario', '')::numeric, 0) > 0 THEN jsonb_build_array(jsonb_build_object('tipo', 'fixo', 'subtipo', 'mensal', 'valor', (p_ficha->>'salario')::numeric))
    WHEN COALESCE(NULLIF(p_ficha->>'valor_unidade', '')::numeric, 0) > 0 THEN jsonb_build_array(jsonb_build_object(
      'tipo', CASE WHEN p_ficha->>'vinculo' = 'diarista' THEN 'diaria' WHEN p_ficha->>'forma_pagamento' = 'hora' THEN 'fixo' ELSE 'producao' END,
      'subtipo', CASE WHEN p_ficha->>'vinculo' <> 'diarista' AND p_ficha->>'forma_pagamento' = 'hora' THEN 'hora' END,
      'valor', (p_ficha->>'valor_unidade')::numeric,
      'quantidade', CASE WHEN p_ficha->>'vinculo' = 'diarista' THEN COALESCE(NULLIF(p_ficha->>'dias_mes', '')::numeric, 22)
                         WHEN p_ficha->>'forma_pagamento' = 'hora' THEN COALESCE(NULLIF(p_ficha->>'horas_produtivas_mes', '')::numeric, 176) ELSE 0 END,
      'unidade', CASE WHEN p_ficha->>'vinculo' <> 'diarista' AND p_ficha->>'forma_pagamento' IN ('m2', 'producao') THEN 'm2' END))
    ELSE '[]'::jsonb END;
  v_fixo numeric := (SELECT sum(NULLIF(x->>'valor', '')::numeric) FROM jsonb_array_elements(v_comps) x
                     WHERE x->>'tipo' = 'fixo' AND COALESCE(x->>'subtipo', 'mensal') = 'mensal');
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  SELECT nome INTO v_nome_funcao FROM erp_funcao_mao_obra WHERE id = v_funcao AND company_id = p_company_id AND ativo;
  IF v_nome_funcao IS NULL THEN RAISE EXCEPTION 'Escolha uma função ativa desta empresa.'; END IF;
  IF v_vinc IS NULL OR v_vinc NOT IN ('clt', 'clt_intermitente', 'rpa', 'pj', 'diarista') THEN RAISE EXCEPTION 'Informe o vínculo.'; END IF;
  IF NOT public.fn__mao_obra_componentes_tem_valor(jsonb_build_object('componentes', v_comps)) THEN RAISE EXCEPTION 'Informe pelo menos um componente da remuneração com valor.'; END IF;
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
             upper(v_vinc), NULLIF(p_pessoa->>'obra_nome', ''), v_fixo)
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
         beneficio_vt, beneficio_alimentacao, beneficio_saude, beneficio_seguro, beneficio_epi,
         quantidade_pessoas, horas_produtivas_mes, vigencia_inicio, motivo, mei_servico_obra,
         encargos_folha_pct_ajuste, prov_13_pct_ajuste, prov_ferias_pct_ajuste, prov_rescisao_pct_ajuste, dsr_fator_ajuste, ajuste_por, ajuste_em,
         chaves_confirmadas_por, chaves_confirmadas_em)
  VALUES (p_company_id, v_tipo, CASE WHEN v_tipo = 'pessoa' THEN v_func END, v_funcao, c->>'descricao', c->>'setor', v_vinc, v_forma,
         COALESCE(v_fixo, 0), 0, 22,
         COALESCE((c->>'beneficio_vt')::numeric, 0), COALESCE((c->>'beneficio_alimentacao')::numeric, 0),
         COALESCE((c->>'beneficio_saude')::numeric, 0), COALESCE((c->>'beneficio_seguro')::numeric, 0), COALESCE((c->>'beneficio_epi')::numeric, 0),
         CASE WHEN v_tipo = 'pessoa' THEN 1 ELSE COALESCE((c->>'quantidade_pessoas')::int, 1) END, COALESCE((c->>'horas_produtivas_mes')::numeric, 176),
         COALESCE(NULLIF(p_ficha->>'vigencia_inicio', '')::date, current_date), 'cadastro', COALESCE((p_ficha->>'mei_servico_obra')::boolean, false),
         NULLIF(aj->>'encargos_folha_pct_ajuste', '')::numeric, NULLIF(aj->>'prov_13_pct_ajuste', '')::numeric,
         NULLIF(aj->>'prov_ferias_pct_ajuste', '')::numeric, NULLIF(aj->>'prov_rescisao_pct_ajuste', '')::numeric, NULLIF(aj->>'dsr_fator_ajuste', '')::numeric,
         CASE WHEN v_tem_ajuste THEN auth.uid() END, CASE WHEN v_tem_ajuste THEN now() END,
         CASE WHEN COALESCE((p_ficha->>'chaves_confirmadas')::boolean, false) THEN auth.uid() END, CASE WHEN COALESCE((p_ficha->>'chaves_confirmadas')::boolean, false) THEN now() END)
  RETURNING id INTO v_id;
  PERFORM public.fn__mao_obra_componentes_gravar(v_id, p_company_id, v_vinc, v_comps);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'funcionario_id', v_func);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) TO authenticated, service_role;

-- reajuste = nova vigência com os componentes informados (ou os anteriores, copiados); volta a "não conferido"
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_reajustar(p_ficha_id uuid, p_dados jsonb, p_vigencia date DEFAULT current_date, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a erp_mao_obra_custo%ROWTYPE; n erp_mao_obra_custo%ROWTYPE; c jsonb := public.fn__mao_obra_ficha_campos(p_dados);
  aj jsonb := public.fn__mao_obra_ficha_ajustes(p_dados); v_vig date := COALESCE(p_vigencia, current_date); v_comps jsonb;
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
  -- componentes: os informados, ou os da vigência anterior
  v_comps := CASE WHEN jsonb_typeof(p_dados->'componentes') = 'array' THEN p_dados->'componentes'
                  ELSE (SELECT COALESCE(jsonb_agg(to_jsonb(x) - ARRAY['id', 'ficha_id', 'company_id', 'created_at', 'chaves_ajustadas'] ORDER BY x.ordem), '[]'::jsonb)
                          FROM erp_mao_obra_componente x WHERE x.ficha_id = a.id) END;
  IF jsonb_array_length(v_comps) = 0 AND a.salario > 0 THEN
    v_comps := jsonb_build_array(jsonb_build_object('tipo', 'fixo', 'subtipo', 'mensal', 'valor', a.salario));  -- ficha antiga
  END IF;
  IF NOT public.fn__mao_obra_componentes_tem_valor(jsonb_build_object('componentes', v_comps)) THEN
    RAISE EXCEPTION 'Informe pelo menos um componente da remuneração com valor.';
  END IF;
  n := jsonb_populate_record(a, c || aj || jsonb_strip_nulls(jsonb_build_object('vinculo', p_dados->>'vinculo', 'mei_servico_obra', p_dados->'mei_servico_obra')));
  n.id := gen_random_uuid(); n.vigencia_inicio := v_vig; n.vigencia_fim := NULL; n.conferido := false; n.conferido_por := NULL; n.conferido_em := NULL;
  n.motivo := COALESCE(NULLIF(btrim(p_motivo), ''), 'reajuste'); n.created_at := now(); n.created_by := auth.uid();
  n.salario := COALESCE((SELECT sum(NULLIF(x->>'valor', '')::numeric) FROM jsonb_array_elements(v_comps) x WHERE x->>'tipo' = 'fixo' AND COALESCE(x->>'subtipo', 'mensal') = 'mensal'), 0);
  n.chaves_confirmadas_por := CASE WHEN COALESCE((p_dados->>'chaves_confirmadas')::boolean, false) THEN auth.uid() END;
  n.chaves_confirmadas_em := CASE WHEN COALESCE((p_dados->>'chaves_confirmadas')::boolean, false) THEN now() END;
  IF a.tipo = 'pessoa' THEN n.quantidade_pessoas := 1; END IF;
  IF (n.encargos_folha_pct_ajuste, n.prov_13_pct_ajuste, n.prov_ferias_pct_ajuste, n.prov_rescisao_pct_ajuste, n.dsr_fator_ajuste)
     IS DISTINCT FROM (a.encargos_folha_pct_ajuste, a.prov_13_pct_ajuste, a.prov_ferias_pct_ajuste, a.prov_rescisao_pct_ajuste, a.dsr_fator_ajuste) THEN
    IF COALESCE(n.encargos_folha_pct_ajuste, n.prov_13_pct_ajuste, n.prov_ferias_pct_ajuste, n.prov_rescisao_pct_ajuste, n.dsr_fator_ajuste) IS NULL THEN
      n.ajuste_por := NULL; n.ajuste_em := NULL;          -- voltou ao padrão
    ELSE n.ajuste_por := auth.uid(); n.ajuste_em := now(); END IF;
  END IF;
  IF v_vig = a.vigencia_inicio THEN
    UPDATE erp_mao_obra_custo SET vigencia_fim = v_vig, ativo = false WHERE id = a.id;
  ELSE
    UPDATE erp_mao_obra_custo SET vigencia_fim = v_vig - 1 WHERE id = a.id;
  END IF;
  INSERT INTO erp_mao_obra_custo SELECT n.*;
  PERFORM public.fn__mao_obra_componentes_gravar(n.id, a.company_id, n.vinculo, v_comps);
  IF a.tipo = 'pessoa' AND c ? 'funcao_id' THEN
    UPDATE compliance_funcionarios SET funcao = (SELECT nome FROM erp_funcao_mao_obra WHERE id = n.funcao_id), updated_at = now() WHERE id = a.funcionario_id;
  END IF;
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  IF n.funcao_id <> a.funcao_id THEN PERFORM public.fn__mao_obra_sync_catalogo(n.funcao_id); END IF;
  RETURN jsonb_build_object('ok', true, 'id', n.id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_reajustar(uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_reajustar(uuid, jsonb, date, text) TO authenticated, service_role;

-- ───────────────────────────── função: forma e unidade de produção ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcao_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := p_id; v_nome text := btrim(COALESCE(p_dados->>'nome', ''));
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o nome da função.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_funcao_mao_obra (company_id, nome, cbo, forma_pagamento, unidade_producao, custo_hora_manual)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'cbo'), ''), COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), 'hora'),
            NULLIF(btrim(p_dados->>'unidade_producao'), ''), NULLIF(p_dados->>'custo_hora_manual', '')::numeric)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_funcao_mao_obra SET nome = v_nome, cbo = NULLIF(btrim(p_dados->>'cbo'), ''),
           forma_pagamento = COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), forma_pagamento),
           unidade_producao = NULLIF(btrim(p_dados->>'unidade_producao'), ''),
           custo_hora_manual = NULLIF(p_dados->>'custo_hora_manual', '')::numeric,
           ativo = COALESCE((p_dados->>'ativo')::boolean, ativo), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Função não encontrada nesta empresa.'; END IF;
  END IF;
  PERFORM public.fn__mao_obra_sync_catalogo(v_id);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcao_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcao_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- "Usar funções-modelo" (empresa sem funções; CEO: não criar automaticamente) — só os nomes, sem custo inventado
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcoes_modelo(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF EXISTS (SELECT 1 FROM erp_funcao_mao_obra WHERE company_id = p_company_id AND ativo) THEN
    RAISE EXCEPTION 'A empresa já tem funções — use "Nova função".';
  END IF;
  INSERT INTO erp_funcao_mao_obra (company_id, nome, forma_pagamento, unidade_producao)
  SELECT p_company_id, m.nome, m.forma, m.unidade FROM (VALUES
    ('Servente', 'hora', NULL), ('Pedreiro', 'hora', NULL), ('Gesseiro', 'producao', 'm2'), ('Pintor', 'producao', 'm2'),
    ('Carpinteiro', 'hora', NULL), ('Eletricista', 'hora', NULL), ('Encanador', 'hora', NULL),
    ('Aplicador de piso vinílico', 'producao', 'm2'), ('Mestre de obras', 'mensal', NULL), ('Engenheiro', 'mensal', NULL)) m(nome, forma, unidade);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'criadas', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid) TO authenticated, service_role;

-- confirmar com o contador as chaves de incidência de uma ficha (sem nova vigência)
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_confirmar_chaves(p_ficha_id uuid, p_confirmar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM erp_mao_obra_custo WHERE id = p_ficha_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(a.company_id);
  UPDATE erp_mao_obra_custo SET chaves_confirmadas_por = CASE WHEN p_confirmar THEN auth.uid() END,
         chaves_confirmadas_em = CASE WHEN p_confirmar THEN now() END WHERE id = p_ficha_id;
  RETURN jsonb_build_object('ok', true, 'confirmadas', p_confirmar);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_confirmar_chaves(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_confirmar_chaves(uuid, boolean) TO authenticated, service_role;

-- ───────────────────────────── fichas que já existem viram componentes (mesmo custo) ─────────────────────────────
INSERT INTO public.erp_mao_obra_componente (ficha_id, company_id, ordem, tipo, subtipo, valor, quantidade, unidade,
       gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao)
SELECT k.id, k.company_id, 0,
       CASE WHEN k.vinculo = 'diarista' THEN 'diaria' WHEN k.vinculo = 'pj' AND k.forma_pagamento IN ('m2', 'producao') THEN 'producao' ELSE 'fixo' END,
       CASE WHEN k.vinculo = 'pj' AND k.forma_pagamento = 'hora' THEN 'hora' WHEN k.vinculo = 'clt' OR (k.vinculo = 'pj' AND k.forma_pagamento NOT IN ('m2', 'producao')) THEN 'mensal' END,
       CASE WHEN k.vinculo = 'diarista' OR (k.vinculo = 'pj' AND k.forma_pagamento <> 'mensal') THEN k.valor_unidade ELSE k.salario END,
       CASE WHEN k.vinculo = 'diarista' THEN k.dias_mes WHEN k.vinculo = 'pj' AND k.forma_pagamento = 'hora' THEN k.horas_produtivas_mes ELSE 0 END,
       CASE WHEN k.vinculo = 'pj' AND k.forma_pagamento IN ('m2', 'producao') THEN 'm2' END,
       false, k.vinculo = 'clt', k.vinculo = 'clt', k.vinculo = 'clt'
  FROM public.erp_mao_obra_custo k
 WHERE NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_componente x WHERE x.ficha_id = k.id);
INSERT INTO public.erp_mao_obra_componente (ficha_id, company_id, ordem, tipo, subtipo, descricao, valor, gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao)
SELECT k.id, k.company_id, 1, 'adicional', 'outro', 'Adicionais (ficha antiga)', k.adicional_insalubridade + k.adicional_periculosidade + k.adicional_outros, false, true, true, true
  FROM public.erp_mao_obra_custo k
 WHERE k.vinculo = 'clt' AND (k.adicional_insalubridade + k.adicional_periculosidade + k.adicional_outros) > 0
   AND NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_componente x WHERE x.ficha_id = k.id AND x.tipo = 'adicional');
