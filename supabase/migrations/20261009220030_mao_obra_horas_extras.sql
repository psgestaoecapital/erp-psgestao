-- Mão de obra · HORAS EXTRAS (pedido do CEO 09/10, dúvida da FC Pisos). Aditivo e compatível: nenhuma ficha tem hora extra hoje
-- (0 componentes 'hora_extra' no banco em 09/10), então nenhum custo existente muda.
--  • Função ganha o PADRÃO de horas extras/mês a 50% e a 100% e a ESCOLHA do custo da hora que a obra usa (sem|com HE).
--  • O cálculo (fn_mao_obra_custo_calcular) passa a devolver, além do custo de sempre, o custo SEM horas extras
--    (a mesma conta sem os componentes de HE: DSR, 13º, férias, encargos e rescisão saem junto) e COM horas extras
--    (custo mensal ÷ (horas produtivas + horas extras)). HE = salário ÷ 220 × (1 + adicional); reflexos pelas chaves
--    de incidência já existentes (DSR, 13º, férias, encargos, rescisão) com os MESMOS % de "Configurar padrões".
--  • A média da função (fn_funcao_custo_hora) usa o custo que a função escolheu e mostra os dois lado a lado.
-- Mesmo cálculo no TypeScript (src/lib/hub/custoMaoObra.ts), conferido por scripts/gates/check-mao-obra-horas-extras.ts.
ALTER TABLE public.erp_funcao_mao_obra ADD COLUMN IF NOT EXISTS he50_horas_padrao numeric NOT NULL DEFAULT 0 CHECK (he50_horas_padrao >= 0);
ALTER TABLE public.erp_funcao_mao_obra ADD COLUMN IF NOT EXISTS he100_horas_padrao numeric NOT NULL DEFAULT 0 CHECK (he100_horas_padrao >= 0);
ALTER TABLE public.erp_funcao_mao_obra ADD COLUMN IF NOT EXISTS custo_hora_usa_he text NOT NULL DEFAULT 'sem' CHECK (custo_hora_usa_he IN ('sem', 'com'));

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
  he_h numeric := 0; he_v numeric := 0; sem jsonb; mensal_sem numeric; vol numeric := 0; uni text; val_prod numeric; dias_diaria numeric := 0; estimado boolean := false; alertas jsonb := '[]'::jsonb;
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
    IF tipo = 'hora_extra' THEN he_h := he_h + COALESCE((c->>'quantidade')::numeric, 0); he_v := he_v + v; END IF;
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
  -- custo SEM horas extras: a mesma conta sem os componentes de hora extra (DSR, 13º, férias, encargos e rescisão saem junto)
  mensal_sem := mensal;
  IF he_v > 0 AND mensal IS NOT NULL THEN
    sem := public.fn_mao_obra_custo_calcular(p_ficha || jsonb_build_object('componentes', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(comps) x WHERE x->>'tipo' <> 'hora_extra')), p_encargos);
    mensal_sem := (sem->>'custo_mensal')::numeric;
  END IF;
  IF vinc = 'diarista' AND dias_diaria > 8 THEN alertas := alertas || '"diarista_mais_8_dias"'::jsonb; END IF;
  IF estimado THEN alertas := alertas || '"volume_estimado"'::jsonb; END IF;
  RETURN jsonb_build_object('base', round(a, 2), 'dsr', round(d, 2), 'provisoes', round(p, 2), 'remuneracao', round(a + d + p, 2),
    'encargos', round(e, 2), 'rescisao', round(r, 2), 'beneficios', round(ben, 2),
    'custo_mensal', round(mensal, 2), 'custo_hora', round(CASE WHEN mensal IS NULL OR horas IS NULL THEN NULL ELSE mensal / horas END, 2),
    'custo_unidade', round(CASE WHEN vol > 0 THEN mensal / vol WHEN val_prod IS NOT NULL THEN val_prod END, 2), 'unidade', uni,
    'custo_m2', round(CASE WHEN vol > 0 AND COALESCE(uni, 'm2') = 'm2' THEN mensal / vol WHEN val_prod IS NOT NULL AND COALESCE(uni, 'm2') = 'm2' AND vol = 0 THEN val_prod END, 2),
    'encargos_folha_pct', encp, 'prov_13_pct', p13, 'prov_ferias_pct', pfer, 'prov_rescisao_pct', presc, 'dsr_fator', dsrf, 'rpa_inss_pct', rpa,
    'horas_extras', round(he_h, 2), 'custo_he', round(CASE WHEN mensal IS NULL THEN NULL ELSE mensal - mensal_sem END, 2),
    'custo_mensal_sem_he', round(mensal_sem, 2),
    'custo_hora_sem_he', round(CASE WHEN mensal_sem IS NULL OR horas IS NULL THEN NULL ELSE mensal_sem / horas END, 2),
    'custo_hora_com_he', round(CASE WHEN mensal IS NULL OR horas IS NULL THEN NULL ELSE mensal / (horas + he_h) END, 2),
    'alertas', alertas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_funcao_custo_hora(p_funcao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f record; v_chave text; v_empresas uuid[]; v_num numeric := 0; v_den numeric := 0; v_u_num numeric := 0; v_u_den numeric := 0;
  v_sem numeric := 0; v_com numeric := 0; v_den_sem numeric := 0; v_den_com numeric := 0; v_hx numeric; v_pessoas int := 0; v_emps int := 0; r record; c jsonb; w numeric; v_pend int := 0; v_uni text;
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
    v_hx := COALESCE((c->>'horas_extras')::numeric, 0);
    -- sem HE: peso = horas produtivas × pessoas; com HE: peso = (horas produtivas + horas extras) × pessoas
    IF (c->>'custo_hora_sem_he') IS NOT NULL THEN v_sem := v_sem + (c->>'custo_hora_sem_he')::numeric * r.horas_produtivas_mes * r.quantidade_pessoas; v_den_sem := v_den_sem + r.horas_produtivas_mes * r.quantidade_pessoas; END IF;
    IF (c->>'custo_hora_com_he') IS NOT NULL THEN v_com := v_com + (c->>'custo_hora_com_he')::numeric * (r.horas_produtivas_mes + v_hx) * r.quantidade_pessoas; v_den_com := v_den_com + (r.horas_produtivas_mes + v_hx) * r.quantidade_pessoas; END IF;
    IF f.custo_hora_usa_he = 'com' THEN
      IF (c->>'custo_hora_com_he') IS NOT NULL THEN v_num := v_num + (c->>'custo_hora_com_he')::numeric * (r.horas_produtivas_mes + v_hx) * r.quantidade_pessoas; v_den := v_den + (r.horas_produtivas_mes + v_hx) * r.quantidade_pessoas; END IF;
    ELSE
      IF (c->>'custo_hora_sem_he') IS NOT NULL THEN v_num := v_num + (c->>'custo_hora_sem_he')::numeric * r.horas_produtivas_mes * r.quantidade_pessoas; v_den := v_den + r.horas_produtivas_mes * r.quantidade_pessoas; END IF;
    END IF;
    IF (c->>'custo_unidade') IS NOT NULL THEN v_u_num := v_u_num + (c->>'custo_unidade')::numeric * r.quantidade_pessoas; v_u_den := v_u_den + r.quantidade_pessoas; v_uni := COALESCE(v_uni, c->>'unidade'); END IF;
    v_pessoas := v_pessoas + r.quantidade_pessoas;
  END LOOP;
  SELECT count(DISTINCT k.company_id) INTO v_emps FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
   WHERE k.company_id = ANY(v_empresas) AND k.ativo AND k.vigencia_fim IS NULL AND k.conferido AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave;
  RETURN jsonb_build_object(
    'funcao_id', p_funcao_id,
    'custo_hora', CASE WHEN v_den > 0 THEN round(v_num / v_den, 2) ELSE f.custo_hora_manual END,
    'usa_he', f.custo_hora_usa_he,
    'custo_hora_sem_he', CASE WHEN v_den_sem > 0 THEN round(v_sem / v_den_sem, 2) END,
    'custo_hora_com_he', CASE WHEN v_den_com > 0 THEN round(v_com / v_den_com, 2) END,
    'custo_unidade', CASE WHEN v_u_den > 0 THEN round(v_u_num / v_u_den, 2) END, 'unidade', v_uni,
    'custo_m2', CASE WHEN v_u_den > 0 AND COALESCE(v_uni, 'm2') = 'm2' THEN round(v_u_num / v_u_den, 2) END,
    'origem', CASE WHEN v_den > 0 OR v_u_den > 0 THEN 'media_grupo' WHEN f.custo_hora_manual IS NOT NULL THEN 'manual' ELSE 'sem_dado' END,
    'pessoas_conferidas', v_pessoas, 'empresas', v_emps, 'nao_conferidas', v_pend, 'horas_base', v_den);
END $function$;
REVOKE ALL ON FUNCTION public.fn_funcao_custo_hora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_funcao_custo_hora(uuid) TO authenticated, service_role;

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
    INSERT INTO erp_funcao_mao_obra (company_id, nome, cbo, forma_pagamento, unidade_producao, custo_hora_manual, he50_horas_padrao, he100_horas_padrao, custo_hora_usa_he)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'cbo'), ''), COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), 'hora'),
            NULLIF(btrim(p_dados->>'unidade_producao'), ''), NULLIF(p_dados->>'custo_hora_manual', '')::numeric,
            GREATEST(COALESCE(NULLIF(p_dados->>'he50_horas_padrao', '')::numeric, 0), 0), GREATEST(COALESCE(NULLIF(p_dados->>'he100_horas_padrao', '')::numeric, 0), 0),
            CASE WHEN p_dados->>'custo_hora_usa_he' = 'com' THEN 'com' ELSE 'sem' END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_funcao_mao_obra SET nome = v_nome, cbo = NULLIF(btrim(p_dados->>'cbo'), ''),
           forma_pagamento = COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), forma_pagamento),
           unidade_producao = NULLIF(btrim(p_dados->>'unidade_producao'), ''),
           custo_hora_manual = NULLIF(p_dados->>'custo_hora_manual', '')::numeric,
           he50_horas_padrao = CASE WHEN p_dados ? 'he50_horas_padrao' THEN GREATEST(COALESCE(NULLIF(p_dados->>'he50_horas_padrao', '')::numeric, 0), 0) ELSE he50_horas_padrao END,
           he100_horas_padrao = CASE WHEN p_dados ? 'he100_horas_padrao' THEN GREATEST(COALESCE(NULLIF(p_dados->>'he100_horas_padrao', '')::numeric, 0), 0) ELSE he100_horas_padrao END,
           custo_hora_usa_he = CASE WHEN p_dados->>'custo_hora_usa_he' IN ('sem', 'com') THEN p_dados->>'custo_hora_usa_he' ELSE custo_hora_usa_he END,
           ativo = COALESCE((p_dados->>'ativo')::boolean, ativo), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Função não encontrada nesta empresa.'; END IF;
  END IF;
  PERFORM public.fn__mao_obra_sync_catalogo(v_id);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcao_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcao_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

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
           'custo_hora_manual', f.custo_hora_manual, 'he50_horas_padrao', f.he50_horas_padrao, 'he100_horas_padrao', f.he100_horas_padrao, 'custo_hora_usa_he', f.custo_hora_usa_he, 'unida_a_id', f.unida_a_id, 'ativo', f.ativo,
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

-- RD-95: "?" dos campos novos (só texto; ON CONFLICT DO NOTHING)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/mao-obra', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.mao_obra.funcao.he50', 'Funções', 'Horas extras a 50% (padrão da função)', 'Quantas horas extras por mês, em média, quem faz essa função costuma fazer a 50% (dias úteis). Deixe 0 se não há.', 'Vem preenchido na ficha de cada pessoa nova dessa função; na ficha dá para mudar.', '10 horas por mês', 'Colocar o total do ano: aqui é a média de UM mês.', 60),
 ('projetos.mao_obra.funcao.he100', 'Funções', 'Horas extras a 100% (padrão da função)', 'Média mensal de horas extras a 100% (domingos e feriados). Deixe 0 se não há.', 'Vem preenchido na ficha de cada pessoa nova dessa função; na ficha dá para mudar.', '4 horas por mês', 'Somar aqui as horas de 50%: cada adicional tem o seu campo.', 61),
 ('projetos.mao_obra.funcao.usa_he', 'Funções', 'Custo da hora que a obra usa', 'Escolha qual custo da hora entra nos orçamentos e nas composições dessa função: sem horas extras ou com horas extras.', 'Sem HE = custo mensal ÷ horas produtivas. Com HE = (custo mensal + custo das HE) ÷ (horas produtivas + horas extras). A lista mostra os dois lado a lado.', 'Equipe que sempre faz hora extra: escolha "com horas extras"', 'Usar "com" sem lançar horas extras nas fichas: os dois custos ficam iguais.', 62),
 ('projetos.mao_obra.ficha.he50', 'Ficha', 'Horas extras a 50% por mês', 'A média de horas extras por mês a 50% desta pessoa. Vazio = não faz.', 'Valor da hora extra = salário ÷ 220 × 1,5. Entra no custo com reflexo no DSR, 13º, férias, encargos e rescisão, pelos mesmos % de "Configurar padrões".', '10 h × (R$ 2.200 ÷ 220) × 1,5 = R$ 150', 'Lançar uma hora extra rara: só entra o que se repete todo mês.', 63),
 ('projetos.mao_obra.ficha.he100', 'Ficha', 'Horas extras a 100% por mês', 'A média de horas extras por mês a 100% (domingos e feriados). Vazio = não faz.', 'Valor da hora extra = salário ÷ 220 × 2. Entra no custo com os mesmos reflexos da hora extra a 50%.', '4 h × (R$ 2.200 ÷ 220) × 2 = R$ 80', 'Contar a mesma hora nos dois campos.', 64),
 ('projetos.mao_obra.ficha.he_custo', 'Ficha', 'Custo das horas extras no mês', 'Não se preenche. É o resultado.', 'Diferença entre o custo mensal COM e SEM horas extras: já inclui DSR, 13º, férias, encargos e rescisão sobre a hora extra.', 'R$ 230 de hora extra → R$ 410 de custo com os reflexos', 'Comparar com o valor da hora extra pura: o custo é maior por causa dos reflexos.', 65),
 ('projetos.mao_obra.resultado.hora_sem_he', 'Resultado', 'Custo da hora SEM horas extras', 'Não se preenche. É o resultado.', 'Custo mensal sem as horas extras ÷ horas produtivas.', 'R$ 4.800 ÷ 176 h = R$ 27,27', 'Usar este custo para uma equipe que faz hora extra todo mês.', 66),
 ('projetos.mao_obra.resultado.hora_com_he', 'Resultado', 'Custo da hora COM horas extras', 'Não se preenche. É o resultado.', '(Custo mensal + custo das horas extras) ÷ (horas produtivas + horas extras): a hora extra também entra como hora trabalhada.', 'R$ 5.210 ÷ 190 h = R$ 27,42', 'Dividir só pelas horas produtivas e achar que a hora ficou muito mais cara.', 67)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
