-- Hub · Mão de obra (SPEC Hub E1+E2 rev. 15, seção 5 · recorte H1+H3 · CEO aprovou a lista em 01/10).
-- Genérico para qualquer empresa. Três peças:
--  • erp_funcao_mao_obra   — funções da empresa (gesseiro, servente…), CBO opcional, "unir" funções parecidas;
--  • erp_encargos_empresa  — encargos de QUEM EMPREGA, com vigência; padrão por regime ("provisórios") até o
--                            contador confirmar; desoneração da folha (CPRB) em reoneração gradual;
--  • erp_mao_obra_custo    — ficha de custo: PESSOA (cadastro compartilhado compliance_funcionarios) ou PERFIL
--                            padrão sem nome (só aqui, fora de compliance_funcionarios); vigência (reajuste = nova
--                            linha); conferido (não conferido não entra no custo).
-- Custo da função = média do GRUPO (company_groups) ponderada pelas horas produtivas × pessoas, só fichas
-- conferidas e vigentes; casa por CBO quando houver, senão pelo nome (sem acento/maiúscula), com "unir".
-- LGPD: salário e custo individual só para owner/sócio/diretor/gerente/financeiro/admin/adm/acesso_total DA PRÓPRIA
-- empresa que emprega (papel em outra empresa não vale — CEO 01/10); o resto vê só a média da função. Toda abertura de
-- ficha com salário fica em erp_mao_obra_acesso_log (quem, quando, qual ficha); a tabela não é lida direto pelo cliente. Escrita só pelas funções (RLS sem INSERT/UPDATE/DELETE). Nada é apagado.
-- A lista atual (projetos_mao_obra, ligada às composições) ganha funcao_id; a migração das funções antigas só com
-- prévia e OK do CEO (fn_mao_obra_migrar_aplicar exige administrador PS).

-- ───────────────────────────── quem vê custo individual ─────────────────────────────
-- só o papel NA empresa que emprega (uc.company_id = a empresa da ficha); administrador PS também vê e também fica no log
CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_individual(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total'))
$function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) TO authenticated, service_role;

-- ───────────────────────────── tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_funcao_mao_obra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  nome text NOT NULL CHECK (length(btrim(nome)) >= 2),
  cbo text CHECK (cbo IS NULL OR cbo ~ '^[0-9]{4}-?[0-9]{2}$'),
  forma_pagamento text NOT NULL DEFAULT 'hora' CHECK (forma_pagamento IN ('hora', 'm2', 'diaria')),
  custo_hora_manual numeric(12, 2) CHECK (custo_hora_manual IS NULL OR custo_hora_manual >= 0),
  unida_a_id uuid REFERENCES public.erp_funcao_mao_obra(id),
  projetos_mao_obra_id uuid,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_funcao_mao_obra_nome ON public.erp_funcao_mao_obra (company_id, lower(btrim(nome))) WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_funcao_mao_obra_company ON public.erp_funcao_mao_obra (company_id);

CREATE TABLE IF NOT EXISTS public.erp_encargos_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  regime text NOT NULL CHECK (regime IN ('simples', 'presumido', 'real')),
  simples_anexo text CHECK (simples_anexo IS NULL OR simples_anexo IN ('I', 'II', 'III', 'IV', 'V')),
  inss_patronal_pct numeric(6, 3) NOT NULL DEFAULT 20 CHECK (inss_patronal_pct BETWEEN 0 AND 100),
  rat_pct numeric(6, 3) NOT NULL DEFAULT 3 CHECK (rat_pct BETWEEN 0 AND 100),
  fap numeric(6, 4) NOT NULL DEFAULT 1 CHECK (fap BETWEEN 0 AND 3),
  terceiros_pct numeric(6, 3) NOT NULL DEFAULT 5.8 CHECK (terceiros_pct BETWEEN 0 AND 100),
  fgts_pct numeric(6, 3) NOT NULL DEFAULT 8 CHECK (fgts_pct BETWEEN 0 AND 100),
  prov_13_pct numeric(6, 3) NOT NULL DEFAULT 8.33 CHECK (prov_13_pct BETWEEN 0 AND 100),
  prov_ferias_pct numeric(6, 3) NOT NULL DEFAULT 11.11 CHECK (prov_ferias_pct BETWEEN 0 AND 100),
  prov_rescisao_pct numeric(6, 3) NOT NULL DEFAULT 4 CHECK (prov_rescisao_pct BETWEEN 0 AND 100),
  -- desoneração da folha (CPRB) com reoneração gradual: parte do INSS patronal volta à folha (fator) e parte fica
  -- sobre a receita (cprb_pct — informativa aqui: é imposto sobre a venda, não custo da hora)
  desoneracao boolean NOT NULL DEFAULT false,
  desoneracao_fator_folha numeric(5, 4) NOT NULL DEFAULT 1 CHECK (desoneracao_fator_folha BETWEEN 0 AND 1),
  cprb_pct numeric(6, 3) CHECK (cprb_pct IS NULL OR cprb_pct BETWEEN 0 AND 100),
  confirmado_por uuid,
  confirmado_em timestamptz,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (company_id, vigencia_inicio)
);

CREATE TABLE IF NOT EXISTS public.erp_mao_obra_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL DEFAULT gen_random_uuid(),   -- a mesma ficha ao longo dos reajustes
  company_id uuid NOT NULL REFERENCES public.companies(id),  -- empresa que EMPREGA
  tipo text NOT NULL CHECK (tipo IN ('pessoa', 'perfil')),
  funcionario_id uuid REFERENCES public.compliance_funcionarios(id),
  funcao_id uuid NOT NULL REFERENCES public.erp_funcao_mao_obra(id),
  descricao text,
  setor text,
  vinculo text NOT NULL DEFAULT 'clt' CHECK (vinculo IN ('clt', 'pj', 'diarista')),
  forma_pagamento text NOT NULL DEFAULT 'mensal' CHECK (forma_pagamento IN ('mensal', 'hora', 'm2', 'diaria')),
  salario numeric(12, 2) NOT NULL DEFAULT 0 CHECK (salario >= 0),
  valor_unidade numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_unidade >= 0),
  dias_mes numeric(5, 2) NOT NULL DEFAULT 22 CHECK (dias_mes > 0 AND dias_mes <= 31),
  adicional_insalubridade numeric(12, 2) NOT NULL DEFAULT 0 CHECK (adicional_insalubridade >= 0),
  adicional_periculosidade numeric(12, 2) NOT NULL DEFAULT 0 CHECK (adicional_periculosidade >= 0),
  adicional_outros numeric(12, 2) NOT NULL DEFAULT 0 CHECK (adicional_outros >= 0),
  beneficio_vt numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_vt >= 0),
  beneficio_alimentacao numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_alimentacao >= 0),
  beneficio_saude numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_saude >= 0),
  beneficio_seguro numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_seguro >= 0),
  beneficio_epi numeric(12, 2) NOT NULL DEFAULT 0 CHECK (beneficio_epi >= 0),
  quantidade_pessoas integer NOT NULL DEFAULT 1 CHECK (quantidade_pessoas >= 1),
  horas_produtivas_mes numeric(6, 2) NOT NULL DEFAULT 176 CHECK (horas_produtivas_mes > 0 AND horas_produtivas_mes <= 300),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  conferido boolean NOT NULL DEFAULT false,
  conferido_por uuid,
  conferido_em timestamptz,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT ck_mao_obra_custo_tipo CHECK (
    (tipo = 'pessoa' AND funcionario_id IS NOT NULL AND quantidade_pessoas = 1)
    OR (tipo = 'perfil' AND funcionario_id IS NULL)),
  CONSTRAINT ck_mao_obra_custo_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mao_obra_custo_pessoa_vigente ON public.erp_mao_obra_custo (funcionario_id) WHERE vigencia_fim IS NULL AND tipo = 'pessoa';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mao_obra_custo_grupo_vigente ON public.erp_mao_obra_custo (grupo_id) WHERE vigencia_fim IS NULL;
CREATE INDEX IF NOT EXISTS ix_mao_obra_custo_company ON public.erp_mao_obra_custo (company_id);
CREATE INDEX IF NOT EXISTS ix_mao_obra_custo_funcao ON public.erp_mao_obra_custo (funcao_id);

-- log de toda abertura de ficha com salário (CEO 01/10): quem, quando, qual ficha e por onde (lista ou histórico)
CREATE TABLE IF NOT EXISTS public.erp_mao_obra_acesso_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid NOT NULL,
  ficha_id uuid NOT NULL REFERENCES public.erp_mao_obra_custo(id),
  grupo_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('lista', 'historico')),
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mao_obra_acesso_log_empresa ON public.erp_mao_obra_acesso_log (company_id, em DESC);
CREATE INDEX IF NOT EXISTS ix_mao_obra_acesso_log_ficha ON public.erp_mao_obra_acesso_log (grupo_id, em DESC);

ALTER TABLE public.projetos_mao_obra ADD COLUMN IF NOT EXISTS funcao_id uuid REFERENCES public.erp_funcao_mao_obra(id);

-- RLS: leitura por empresa; ficha (salário) só pelas funções (que gravam o log); escrita só pelas funções
ALTER TABLE public.erp_funcao_mao_obra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_encargos_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_mao_obra_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_mao_obra_acesso_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funcao_mao_obra_select ON public.erp_funcao_mao_obra;
CREATE POLICY funcao_mao_obra_select ON public.erp_funcao_mao_obra FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS encargos_empresa_select ON public.erp_encargos_empresa;
CREATE POLICY encargos_empresa_select ON public.erp_encargos_empresa FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS mao_obra_custo_select ON public.erp_mao_obra_custo;
CREATE POLICY mao_obra_custo_select ON public.erp_mao_obra_custo FOR SELECT TO authenticated
  USING ((company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) AND public.fn__mao_obra_pode_ver_individual(company_id));
DROP POLICY IF EXISTS mao_obra_acesso_log_select ON public.erp_mao_obra_acesso_log;
CREATE POLICY mao_obra_acesso_log_select ON public.erp_mao_obra_acesso_log FOR SELECT TO authenticated
  USING ((company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) AND public.fn__mao_obra_pode_ver_individual(company_id));
REVOKE ALL ON public.erp_funcao_mao_obra, public.erp_encargos_empresa, public.erp_mao_obra_custo, public.erp_mao_obra_acesso_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.erp_funcao_mao_obra, public.erp_encargos_empresa, public.erp_mao_obra_custo, public.erp_mao_obra_acesso_log FROM authenticated;
-- a ficha (salário) não é lida direto: só por fn_mao_obra_listar / fn_mao_obra_ficha_historico, que gravam o log
REVOKE SELECT ON public.erp_mao_obra_custo FROM authenticated;
GRANT SELECT ON public.erp_funcao_mao_obra, public.erp_encargos_empresa, public.erp_mao_obra_acesso_log TO authenticated;

-- ───────────────────────────── encargos vigentes (padrão por regime = provisórios) ─────────────────────────────
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
      'encargos_folha_pct', round(v_total, 4), 'vigencia_inicio', e.vigencia_inicio, 'confirmado_em', e.confirmado_em);
  END IF;
  SELECT lower(COALESCE(regime_tributario, '')) INTO v_reg_raw FROM companies WHERE id = p_company_id;
  v_reg := CASE WHEN v_reg_raw LIKE '%simples%' THEN 'simples' WHEN v_reg_raw LIKE '%real%' THEN 'real' ELSE 'presumido' END;
  -- Simples sem anexo informado: assume Anexo IV (obra) — INSS patronal + RAT fora do DAS (o mais caro, até o contador dizer)
  IF v_reg = 'simples' THEN v_inss := 20; v_rat := 3; v_terc := 0;
  ELSE v_inss := 20; v_rat := 3; v_terc := 5.8; END IF;
  v_total := v_inss + v_rat + v_terc + 8;
  RETURN jsonb_build_object('fonte', 'padrao_regime', 'provisorio', true, 'regime', v_reg, 'simples_anexo', CASE WHEN v_reg = 'simples' THEN 'IV' END,
    'inss_patronal_pct', v_inss, 'rat_pct', v_rat, 'fap', 1, 'terceiros_pct', v_terc, 'fgts_pct', 8,
    'desoneracao', false, 'desoneracao_fator_folha', 1, 'cprb_pct', NULL,
    'prov_13_pct', 8.33, 'prov_ferias_pct', 11.11, 'prov_rescisao_pct', 4,
    'encargos_folha_pct', v_total, 'vigencia_inicio', NULL, 'confirmado_em', NULL);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_vigentes(uuid, date) TO authenticated, service_role;

-- ───────────────────────────── custo de uma ficha (mesma conta de src/lib/hub/custoMaoObra.ts) ─────────────────────────────
-- CLT:      base = salário + adicionais; remuneração = base × (1 + 13º + férias); encargos = remuneração × encargos da
--           folha; rescisão = base × provisão; mensal = remuneração + encargos + rescisão + benefícios.
-- PJ:       mensal = valor mensal (salário) + benefícios; hora/m² = valor da unidade quando a forma for essa.
-- Diarista: mensal = diária × dias + benefícios.
-- Hora produtiva = mensal ÷ horas produtivas. Exemplo da SPEC: R$ 2.800 → R$ 5.487 → R$ 31,18/h.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_custo_calcular(p_ficha jsonb, p_encargos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  n numeric := 0; vinc text := COALESCE(p_ficha->>'vinculo', 'clt'); forma text := COALESCE(p_ficha->>'forma_pagamento', 'mensal');
  sal numeric := COALESCE((p_ficha->>'salario')::numeric, 0);
  vu numeric := COALESCE((p_ficha->>'valor_unidade')::numeric, 0);
  dias numeric := COALESCE((p_ficha->>'dias_mes')::numeric, 22);
  horas numeric := NULLIF(COALESCE((p_ficha->>'horas_produtivas_mes')::numeric, 176), 0);
  adic numeric := COALESCE((p_ficha->>'adicional_insalubridade')::numeric, 0) + COALESCE((p_ficha->>'adicional_periculosidade')::numeric, 0) + COALESCE((p_ficha->>'adicional_outros')::numeric, 0);
  ben numeric := COALESCE((p_ficha->>'beneficio_vt')::numeric, 0) + COALESCE((p_ficha->>'beneficio_alimentacao')::numeric, 0) + COALESCE((p_ficha->>'beneficio_saude')::numeric, 0) + COALESCE((p_ficha->>'beneficio_seguro')::numeric, 0) + COALESCE((p_ficha->>'beneficio_epi')::numeric, 0);
  p13 numeric := COALESCE((p_encargos->>'prov_13_pct')::numeric, 8.33);
  pfer numeric := COALESCE((p_encargos->>'prov_ferias_pct')::numeric, 11.11);
  presc numeric := COALESCE((p_encargos->>'prov_rescisao_pct')::numeric, 4);
  encp numeric := COALESCE((p_encargos->>'encargos_folha_pct')::numeric, 36.8);
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
    'beneficios', round(ben, 2), 'custo_mensal', round(mensal, 2), 'custo_hora', round(hora, 2), 'custo_m2', round(m2, 2));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_custo_calcular(jsonb, jsonb) TO authenticated, service_role;

-- chave da função para casar no grupo: CBO (só dígitos) quando houver, senão o nome sem acento/maiúscula; "unir"
CREATE OR REPLACE FUNCTION public.fn__mao_obra_funcao_chave(p_funcao_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(regexp_replace(COALESCE(r.cbo, ''), '\D', '', 'g'), ''),
                  lower(public.unaccent(regexp_replace(btrim(r.nome), '\s+', ' ', 'g'))))
    FROM erp_funcao_mao_obra f JOIN erp_funcao_mao_obra r ON r.id = COALESCE(f.unida_a_id, f.id)
   WHERE f.id = p_funcao_id
$function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_funcao_chave(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_funcao_chave(uuid) TO service_role;

-- custo da função = média do GRUPO ponderada pelas horas produtivas × pessoas, só conferidas e vigentes
CREATE OR REPLACE FUNCTION public.fn_funcao_custo_hora(p_funcao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f record; v_chave text; v_empresas uuid[]; v_num numeric := 0; v_den numeric := 0; v_m2_num numeric := 0; v_m2_den numeric := 0;
  v_pessoas int := 0; v_emps int := 0; r record; c jsonb; w numeric; v_pend int := 0;
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
    c := public.fn_mao_obra_custo_calcular(to_jsonb(r), public.fn_mao_obra_encargos_vigentes(r.company_id));
    w := r.horas_produtivas_mes * r.quantidade_pessoas;
    IF (c->>'custo_hora') IS NOT NULL THEN v_num := v_num + (c->>'custo_hora')::numeric * w; v_den := v_den + w; END IF;
    IF (c->>'custo_m2') IS NOT NULL THEN v_m2_num := v_m2_num + (c->>'custo_m2')::numeric * r.quantidade_pessoas; v_m2_den := v_m2_den + r.quantidade_pessoas; END IF;
    v_pessoas := v_pessoas + r.quantidade_pessoas;
  END LOOP;
  SELECT count(DISTINCT k.company_id) INTO v_emps FROM erp_mao_obra_custo k JOIN erp_funcao_mao_obra fx ON fx.id = k.funcao_id
   WHERE k.company_id = ANY(v_empresas) AND k.ativo AND k.vigencia_fim IS NULL AND k.conferido AND public.fn__mao_obra_funcao_chave(fx.id) = v_chave;
  RETURN jsonb_build_object(
    'funcao_id', p_funcao_id,
    'custo_hora', CASE WHEN v_den > 0 THEN round(v_num / v_den, 2) ELSE f.custo_hora_manual END,
    'custo_m2', CASE WHEN v_m2_den > 0 THEN round(v_m2_num / v_m2_den, 2) END,
    'origem', CASE WHEN v_den > 0 OR v_m2_den > 0 THEN 'media_grupo' WHEN f.custo_hora_manual IS NOT NULL THEN 'manual' ELSE 'sem_dado' END,
    'pessoas_conferidas', v_pessoas, 'empresas', v_emps, 'nao_conferidas', v_pend, 'horas_base', v_den);
END $function$;
REVOKE ALL ON FUNCTION public.fn_funcao_custo_hora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_funcao_custo_hora(uuid) TO authenticated, service_role;

-- catálogo atual (projetos_mao_obra ligado à função) recebe o custo/hora da função quando houver conferido/manual
-- ci-sem-guarda: fn__mao_obra_sync_catalogo — interna: só as funções que já conferiram a empresa a chamam; sem EXECUTE para authenticated
CREATE OR REPLACE FUNCTION public.fn__mao_obra_sync_catalogo(p_funcao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb := public.fn_funcao_custo_hora(p_funcao_id); v_h numeric;
BEGIN
  v_h := (v->>'custo_hora')::numeric;
  IF v_h IS NULL OR v->>'origem' = 'sem_dado' THEN RETURN; END IF;
  UPDATE projetos_mao_obra SET custo_hora = v_h, custo_mes = round(v_h * 176, 2), updated_at = now()
   WHERE funcao_id = p_funcao_id AND custo_hora IS DISTINCT FROM v_h;
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_sync_catalogo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_sync_catalogo(uuid) TO service_role;

-- ───────────────────────────── leitura da tela (mascarada pela LGPD) ─────────────────────────────
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
           'migrada_de', f.projetos_mao_obra_id, 'custo', public.fn_funcao_custo_hora(f.id)) ORDER BY f.ativo DESC, f.nome), '[]'::jsonb)
    INTO v_funcoes FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb) INTO v_equipe FROM (
    SELECT jsonb_build_object('id', k.id, 'grupo_id', k.grupo_id, 'tipo', k.tipo, 'funcionario_id', k.funcionario_id,
      'nome', CASE WHEN k.tipo = 'pessoa' THEN cf.nome_completo ELSE COALESCE(k.descricao, fn.nome || ' (perfil padrão)') END,
      'funcao_id', k.funcao_id, 'funcao', fn.nome, 'vinculo', k.vinculo, 'forma_pagamento', k.forma_pagamento, 'setor', COALESCE(k.setor, cf.setor),
      'quantidade_pessoas', k.quantidade_pessoas, 'horas_produtivas_mes', k.horas_produtivas_mes,
      'vigencia_inicio', k.vigencia_inicio, 'conferido', k.conferido, 'conferido_em', k.conferido_em, 'ativo', k.ativo,
      'matricula', cf.matricula, 'data_admissao', cf.data_admissao,
      -- LGPD: valores individuais só para quem pode ver
      'ficha', CASE WHEN v_pode THEN to_jsonb(k) - ARRAY['company_id', 'created_by', 'conferido_por'] END,
      'custo', CASE WHEN v_pode THEN public.fn_mao_obra_custo_calcular(to_jsonb(k), public.fn_mao_obra_encargos_vigentes(k.company_id)) END) x
    FROM erp_mao_obra_custo k
    JOIN erp_funcao_mao_obra fn ON fn.id = k.funcao_id
    LEFT JOIN compliance_funcionarios cf ON cf.id = k.funcionario_id
   WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL) z;
  -- log: cada ficha com salário que chegou à tela (quem, quando, qual ficha)
  IF v_pode AND auth.uid() IS NOT NULL THEN
    INSERT INTO erp_mao_obra_acesso_log (company_id, user_id, ficha_id, grupo_id, origem)
    SELECT k.company_id, auth.uid(), k.id, k.grupo_id, 'lista' FROM erp_mao_obra_custo k
     WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL;
  END IF;
  RETURN jsonb_build_object('pode_ver_individual', v_pode, 'encargos', v_enc, 'funcoes', v_funcoes, 'equipe', v_equipe);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_listar(uuid) TO authenticated, service_role;

-- histórico de uma ficha (reajustes) — só quem pode ver
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
            'custo', public.fn_mao_obra_custo_calcular(to_jsonb(k), public.fn_mao_obra_encargos_vigentes(k.company_id, k.vigencia_inicio))) ORDER BY k.vigencia_inicio DESC), '[]'::jsonb)
            FROM erp_mao_obra_custo k WHERE k.grupo_id = p_grupo_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_historico(uuid) TO authenticated, service_role;

-- ───────────────────────────── escrita ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__mao_obra_exige_gestor(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RAISE EXCEPTION 'Só gestor ou financeiro da empresa (owner, sócio, diretor, gerente, financeiro, admin) cadastra e altera custo de mão de obra.' USING ERRCODE = '42501';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_exige_gestor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_exige_gestor(uuid) TO service_role;

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
    INSERT INTO erp_funcao_mao_obra (company_id, nome, cbo, forma_pagamento, custo_hora_manual)
    VALUES (p_company_id, v_nome, NULLIF(btrim(p_dados->>'cbo'), ''), COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), 'hora'),
            NULLIF(p_dados->>'custo_hora_manual', '')::numeric)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_funcao_mao_obra SET nome = v_nome, cbo = NULLIF(btrim(p_dados->>'cbo'), ''),
           forma_pagamento = COALESCE(NULLIF(p_dados->>'forma_pagamento', ''), forma_pagamento),
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

-- unir funções parecidas do grupo (ex.: "Gesseiro" e "Gesseiro montador"); p_unir_a_id NULL desfaz
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcao_unir(p_funcao_id uuid, p_unir_a_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f record; a record;
BEGIN
  SELECT * INTO f FROM erp_funcao_mao_obra WHERE id = p_funcao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Função não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(f.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(f.company_id);
  IF p_unir_a_id IS NOT NULL THEN
    SELECT * INTO a FROM erp_funcao_mao_obra WHERE id = p_unir_a_id;
    IF NOT FOUND OR a.id = f.id THEN RAISE EXCEPTION 'Escolha outra função para unir.'; END IF;
    IF a.unida_a_id IS NOT NULL THEN p_unir_a_id := a.unida_a_id; END IF;
    IF NOT EXISTS (SELECT 1 FROM companies c1 JOIN companies c2 ON c2.id = a.company_id
                    WHERE c1.id = f.company_id AND (c1.id = c2.id OR (c1.group_id IS NOT NULL AND c1.group_id = c2.group_id))) THEN
      RAISE EXCEPTION 'Só dá para unir funções da mesma empresa ou do mesmo grupo.';
    END IF;
  END IF;
  UPDATE erp_funcao_mao_obra SET unida_a_id = p_unir_a_id, updated_at = now() WHERE id = p_funcao_id;
  UPDATE erp_funcao_mao_obra SET unida_a_id = p_unir_a_id, updated_at = now() WHERE unida_a_id = p_funcao_id;
  PERFORM public.fn__mao_obra_sync_catalogo(p_funcao_id);
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcao_unir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcao_unir(uuid, uuid) TO authenticated, service_role;

-- encargos da empresa (nova vigência); p_confirmar = o contador confirmou (tira o "provisório")
CREATE OR REPLACE FUNCTION public.fn_mao_obra_encargos_salvar(p_company_id uuid, p_dados jsonb, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_vig date := COALESCE(NULLIF(p_dados->>'vigencia_inicio', '')::date, current_date); v_id uuid; v_reg text := p_dados->>'regime';
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF v_reg NOT IN ('simples', 'presumido', 'real') THEN RAISE EXCEPTION 'Informe o regime (simples, presumido ou real).'; END IF;
  INSERT INTO erp_encargos_empresa (company_id, vigencia_inicio, regime, simples_anexo, inss_patronal_pct, rat_pct, fap, terceiros_pct, fgts_pct,
         prov_13_pct, prov_ferias_pct, prov_rescisao_pct, desoneracao, desoneracao_fator_folha, cprb_pct, confirmado_por, confirmado_em, observacao)
  VALUES (p_company_id, v_vig, v_reg, NULLIF(p_dados->>'simples_anexo', ''),
          COALESCE((p_dados->>'inss_patronal_pct')::numeric, 20), COALESCE((p_dados->>'rat_pct')::numeric, 3), COALESCE((p_dados->>'fap')::numeric, 1),
          COALESCE((p_dados->>'terceiros_pct')::numeric, 0), COALESCE((p_dados->>'fgts_pct')::numeric, 8),
          COALESCE((p_dados->>'prov_13_pct')::numeric, 8.33), COALESCE((p_dados->>'prov_ferias_pct')::numeric, 11.11), COALESCE((p_dados->>'prov_rescisao_pct')::numeric, 4),
          COALESCE((p_dados->>'desoneracao')::boolean, false), COALESCE((p_dados->>'desoneracao_fator_folha')::numeric, 1), NULLIF(p_dados->>'cprb_pct', '')::numeric,
          CASE WHEN p_confirmar THEN auth.uid() END, CASE WHEN p_confirmar THEN now() END, NULLIF(btrim(p_dados->>'observacao'), ''))
  ON CONFLICT (company_id, vigencia_inicio) DO UPDATE SET
    regime = EXCLUDED.regime, simples_anexo = EXCLUDED.simples_anexo, inss_patronal_pct = EXCLUDED.inss_patronal_pct, rat_pct = EXCLUDED.rat_pct,
    fap = EXCLUDED.fap, terceiros_pct = EXCLUDED.terceiros_pct, fgts_pct = EXCLUDED.fgts_pct, prov_13_pct = EXCLUDED.prov_13_pct,
    prov_ferias_pct = EXCLUDED.prov_ferias_pct, prov_rescisao_pct = EXCLUDED.prov_rescisao_pct, desoneracao = EXCLUDED.desoneracao,
    desoneracao_fator_folha = EXCLUDED.desoneracao_fator_folha, cprb_pct = EXCLUDED.cprb_pct,
    confirmado_por = EXCLUDED.confirmado_por, confirmado_em = EXCLUDED.confirmado_em, observacao = EXCLUDED.observacao
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, auth.uid(), 'erp_encargos_empresa', v_id::text, CASE WHEN p_confirmar THEN 'ENCARGOS_CONFIRMADOS' ELSE 'ENCARGOS_SALVOS' END, p_dados);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'encargos', public.fn_mao_obra_encargos_vigentes(p_company_id));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_encargos_salvar(uuid, jsonb, boolean) TO authenticated, service_role;

-- campos da ficha aceitos do cliente (o resto é ignorado)
CREATE OR REPLACE FUNCTION public.fn__mao_obra_ficha_campos(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'descricao', p->>'descricao', 'setor', p->>'setor', 'vinculo', p->>'vinculo', 'forma_pagamento', p->>'forma_pagamento',
    'salario', p->'salario', 'valor_unidade', p->'valor_unidade', 'dias_mes', p->'dias_mes',
    'adicional_insalubridade', p->'adicional_insalubridade', 'adicional_periculosidade', p->'adicional_periculosidade', 'adicional_outros', p->'adicional_outros',
    'beneficio_vt', p->'beneficio_vt', 'beneficio_alimentacao', p->'beneficio_alimentacao', 'beneficio_saude', p->'beneficio_saude',
    'beneficio_seguro', p->'beneficio_seguro', 'beneficio_epi', p->'beneficio_epi',
    'quantidade_pessoas', p->'quantidade_pessoas', 'horas_produtivas_mes', p->'horas_produtivas_mes', 'funcao_id', p->'funcao_id'))
$function$;

-- nova ficha: pessoa (cria/atualiza o cadastro compartilhado) ou perfil padrão
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_salvar(p_company_id uuid, p_ficha jsonb, p_pessoa jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tipo text := COALESCE(p_ficha->>'tipo', 'perfil'); v_func uuid := NULLIF(p_ficha->>'funcionario_id', '')::uuid;
  v_funcao uuid := NULLIF(p_ficha->>'funcao_id', '')::uuid; v_id uuid; c jsonb := public.fn__mao_obra_ficha_campos(p_ficha);
  v_nome_funcao text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  SELECT nome INTO v_nome_funcao FROM erp_funcao_mao_obra WHERE id = v_funcao AND company_id = p_company_id AND ativo;
  IF v_nome_funcao IS NULL THEN RAISE EXCEPTION 'Escolha uma função ativa desta empresa.'; END IF;
  IF v_tipo = 'pessoa' THEN
    IF v_func IS NULL THEN
      IF length(btrim(COALESCE(p_pessoa->>'nome_completo', ''))) < 3 THEN RAISE EXCEPTION 'Informe o nome completo do funcionário.'; END IF;
      INSERT INTO compliance_funcionarios (company_id, nome_completo, cpf, rg, data_nascimento, email, telefone, cep, logradouro, numero, complemento,
             bairro, cidade, uf, matricula, cargo, setor, funcao, data_admissao, tipo_contrato, obra_nome, salario_base)
      VALUES (p_company_id, btrim(p_pessoa->>'nome_completo'), NULLIF(regexp_replace(COALESCE(p_pessoa->>'cpf', ''), '\D', '', 'g'), ''),
             NULLIF(p_pessoa->>'rg', ''), NULLIF(p_pessoa->>'data_nascimento', '')::date, NULLIF(p_pessoa->>'email', ''), NULLIF(p_pessoa->>'telefone', ''),
             NULLIF(p_pessoa->>'cep', ''), NULLIF(p_pessoa->>'logradouro', ''), NULLIF(p_pessoa->>'numero', ''), NULLIF(p_pessoa->>'complemento', ''),
             NULLIF(p_pessoa->>'bairro', ''), NULLIF(p_pessoa->>'cidade', ''), NULLIF(p_pessoa->>'uf', ''), NULLIF(p_pessoa->>'matricula', ''),
             NULLIF(p_pessoa->>'cargo', ''), NULLIF(p_pessoa->>'setor', ''), v_nome_funcao, NULLIF(p_pessoa->>'data_admissao', '')::date,
             upper(COALESCE(p_ficha->>'vinculo', 'clt')), NULLIF(p_pessoa->>'obra_nome', ''), NULLIF(p_ficha->>'salario', '')::numeric)
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
  INSERT INTO erp_mao_obra_custo (company_id, tipo, funcionario_id, funcao_id, descricao, setor, vinculo, forma_pagamento, salario, valor_unidade, dias_mes,
         adicional_insalubridade, adicional_periculosidade, adicional_outros, beneficio_vt, beneficio_alimentacao, beneficio_saude, beneficio_seguro, beneficio_epi,
         quantidade_pessoas, horas_produtivas_mes, vigencia_inicio, motivo)
  VALUES (p_company_id, v_tipo, CASE WHEN v_tipo = 'pessoa' THEN v_func END, v_funcao, c->>'descricao', c->>'setor',
         COALESCE(c->>'vinculo', 'clt'), COALESCE(c->>'forma_pagamento', 'mensal'), COALESCE((c->>'salario')::numeric, 0), COALESCE((c->>'valor_unidade')::numeric, 0),
         COALESCE((c->>'dias_mes')::numeric, 22), COALESCE((c->>'adicional_insalubridade')::numeric, 0), COALESCE((c->>'adicional_periculosidade')::numeric, 0),
         COALESCE((c->>'adicional_outros')::numeric, 0), COALESCE((c->>'beneficio_vt')::numeric, 0), COALESCE((c->>'beneficio_alimentacao')::numeric, 0),
         COALESCE((c->>'beneficio_saude')::numeric, 0), COALESCE((c->>'beneficio_seguro')::numeric, 0), COALESCE((c->>'beneficio_epi')::numeric, 0),
         CASE WHEN v_tipo = 'pessoa' THEN 1 ELSE COALESCE((c->>'quantidade_pessoas')::int, 1) END, COALESCE((c->>'horas_produtivas_mes')::numeric, 176),
         COALESCE(NULLIF(p_ficha->>'vigencia_inicio', '')::date, current_date), 'cadastro')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'funcionario_id', v_func);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_salvar(uuid, jsonb, jsonb) TO authenticated, service_role;

-- reajuste/edição = nova vigência (a anterior fecha no dia anterior); volta a "não conferido"
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_reajustar(p_ficha_id uuid, p_dados jsonb, p_vigencia date DEFAULT current_date, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a erp_mao_obra_custo%ROWTYPE; n erp_mao_obra_custo%ROWTYPE; c jsonb := public.fn__mao_obra_ficha_campos(p_dados); v_vig date := COALESCE(p_vigencia, current_date);
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
  n := jsonb_populate_record(a, c);
  n.id := gen_random_uuid(); n.vigencia_inicio := v_vig; n.vigencia_fim := NULL; n.conferido := false; n.conferido_por := NULL; n.conferido_em := NULL;
  n.motivo := COALESCE(NULLIF(btrim(p_motivo), ''), 'reajuste'); n.created_at := now(); n.created_by := auth.uid();
  IF a.tipo = 'pessoa' THEN n.quantidade_pessoas := 1; END IF;
  IF v_vig = a.vigencia_inicio THEN
    -- mesma data: corrige a vigência atual (sem criar histórico vazio de 0 dias)
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

CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_conferir(p_ficha_id uuid, p_conferido boolean DEFAULT true)
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
  IF a.vigencia_fim IS NOT NULL OR NOT a.ativo THEN RAISE EXCEPTION 'Esta ficha não está vigente.'; END IF;
  UPDATE erp_mao_obra_custo SET conferido = p_conferido, conferido_por = CASE WHEN p_conferido THEN auth.uid() END,
         conferido_em = CASE WHEN p_conferido THEN now() END WHERE id = p_ficha_id;
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  RETURN jsonb_build_object('ok', true, 'conferido', p_conferido);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_conferir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_conferir(uuid, boolean) TO authenticated, service_role;

-- excluir = desligar (pessoa: data de demissão no cadastro compartilhado) ou inativar (perfil). Nada é apagado.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_encerrar(p_ficha_id uuid, p_data date DEFAULT current_date, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; v_data date := COALESCE(p_data, current_date);
BEGIN
  SELECT * INTO a FROM erp_mao_obra_custo WHERE id = p_ficha_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(a.company_id);
  IF a.vigencia_fim IS NOT NULL OR NOT a.ativo THEN RAISE EXCEPTION 'Esta ficha já está encerrada.'; END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo (desligamento ou inativação).'; END IF;
  UPDATE erp_mao_obra_custo SET vigencia_fim = GREATEST(v_data, vigencia_inicio), ativo = false,
         motivo = concat_ws(' · ', motivo, (CASE WHEN a.tipo = 'pessoa' THEN 'desligado: ' ELSE 'inativado: ' END) || btrim(p_motivo))
   WHERE id = p_ficha_id;
  IF a.tipo = 'pessoa' THEN
    UPDATE compliance_funcionarios SET data_demissao = v_data, ativo = false, updated_at = now() WHERE id = a.funcionario_id;
  END IF;
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_encerrar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_encerrar(uuid, date, text) TO authenticated, service_role;

-- ───────────────────────────── migração das funções antigas (prévia + aplicar com OK do CEO) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_migrar_previa(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_enc jsonb := public.fn_mao_obra_encargos_vigentes(p_company_id); v_fator numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- custo mensal (hora × 176) = base × [(1+13º+férias) × (1+encargos) + rescisão] → base estimada
  v_fator := (1 + ((v_enc->>'prov_13_pct')::numeric + (v_enc->>'prov_ferias_pct')::numeric) / 100) * (1 + (v_enc->>'encargos_folha_pct')::numeric / 100)
             + (v_enc->>'prov_rescisao_pct')::numeric / 100;
  RETURN jsonb_build_object('company_id', p_company_id, 'encargos', v_enc, 'itens', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('projetos_mao_obra_id', m.id, 'funcao_atual', m.funcao, 'custo_hora_atual', m.custo_hora,
             'tipo_atual', m.tipo_contratacao, 'ja_existe_funcao', EXISTS (SELECT 1 FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id AND f.ativo AND lower(btrim(f.nome)) = lower(btrim(m.funcao))),
             'proposta', jsonb_build_object('funcao', btrim(m.funcao), 'vinculo', CASE WHEN upper(COALESCE(m.tipo_contratacao, '')) = 'PJ' THEN 'pj' ELSE 'clt' END,
               'salario_estimado', CASE WHEN upper(COALESCE(m.tipo_contratacao, '')) = 'PJ' THEN round(COALESCE(m.custo_hora, 0) * 176, 2)
                                         ELSE round(COALESCE(m.custo_hora, 0) * 176 / v_fator, 2) END,
               'custo_hora_manual', m.custo_hora, 'horas_produtivas_mes', 176, 'conferido', false)) ORDER BY m.funcao)
      FROM projetos_mao_obra m WHERE m.company_id = p_company_id AND COALESCE(m.ativo, true) AND m.funcao_id IS NULL), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_migrar_previa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_migrar_previa(uuid) TO authenticated, service_role;

-- aplica a prévia (só administrador PS, depois do OK do CEO): cria a função com o R$/h atual como custo MANUAL (as
-- composições continuam com o mesmo valor até haver ficha conferida) e liga o catálogo. p_criar_perfil = true também
-- cria um perfil padrão NÃO conferido com salário estimado (opção B — só se o CEO escolher).
CREATE OR REPLACE FUNCTION public.fn_mao_obra_migrar_aplicar(p_company_id uuid, p_criar_perfil boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prev jsonb; it jsonb; v_funcao uuid; v_n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'A migração das funções antigas só roda com o OK do CEO (administrador PS).' USING ERRCODE = '42501';
  END IF;
  v_prev := public.fn_mao_obra_migrar_previa(p_company_id);
  FOR it IN SELECT * FROM jsonb_array_elements(v_prev->'itens') LOOP
    SELECT id INTO v_funcao FROM erp_funcao_mao_obra WHERE company_id = p_company_id AND ativo AND lower(btrim(nome)) = lower(it#>>'{proposta,funcao}');
    IF v_funcao IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id, nome, forma_pagamento, custo_hora_manual, projetos_mao_obra_id)
      VALUES (p_company_id, it#>>'{proposta,funcao}', 'hora', (it#>>'{proposta,custo_hora_manual}')::numeric, (it->>'projetos_mao_obra_id')::uuid)
      RETURNING id INTO v_funcao;
    END IF;
    IF p_criar_perfil THEN
    INSERT INTO erp_mao_obra_custo (company_id, tipo, funcao_id, descricao, vinculo, forma_pagamento, salario, horas_produtivas_mes, motivo)
    VALUES (p_company_id, 'perfil', v_funcao, (it#>>'{proposta,funcao}') || ' (perfil padrão migrado)', it#>>'{proposta,vinculo}', 'mensal',
            (it#>>'{proposta,salario_estimado}')::numeric, 176, 'migrado da lista genérica — conferir antes de valer');
    END IF;
    UPDATE projetos_mao_obra SET funcao_id = v_funcao WHERE id = (it->>'projetos_mao_obra_id')::uuid;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'migradas', v_n, 'perfis_criados', p_criar_perfil);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_migrar_aplicar(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_migrar_aplicar(uuid, boolean) TO service_role;
