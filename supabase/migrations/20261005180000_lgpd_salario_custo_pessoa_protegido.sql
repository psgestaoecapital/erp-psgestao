-- =====================================================================================================================
-- LGPD · salário e custo por pessoa só para quem vê salário (CEO 04/10, opção A; regra aprovada em 02/10) — tarefa ee360ddc
-- =====================================================================================================================
-- Alvo: compliance_funcionarios.salario_base e agency_timesheet.custo_hora (+ custo_total, que é horas × custo_hora e,
-- por apontamento de uma pessoa, devolve o custo/hora dela).
-- Mesmo desenho da agency_equipe (migration 20261003107000) e da Mão de obra (#2000), sem criar regra nova (RD-65):
--   · "quem vê salário" = fn__mao_obra_pode_ver_individual(empresa) (owner, socio, diretor, gerente, financeiro, admin,
--     adm, acesso_total) — função de guarda existente, NÃO alterada aqui (RD-91);
--   · direito por COLUNA: o logado lê/grava todas as colunas MENOS as sensíveis (select * / select direto da coluna →
--     42501 em qualquer caminho PostgREST); anon sem direito nenhum;
--   · o valor individual só sai por função SECURITY DEFINER que confere empresa + permissão e REGISTRA o acesso;
--   · quem não vê salário recebe a MÉDIA DA FUNÇÃO (grupo com 3+ pessoas; grupo menor devolve nulo — média de 1 ou 2
--     pessoas revelaria o salário de alguém);
--   · funções SECURITY DEFINER já existentes que leem as colunas (folha/RH/Mão de obra/seed) seguem iguais: rodam como
--     dono do banco e já têm a própria guarda.
-- Só aditivo para dado: nenhum valor é alterado ou apagado. O que muda são direitos (GRANT/REVOKE), funções novas,
-- uma tabela de registro de acesso e um gatilho que preenche o custo/hora do apontamento no servidor.
-- =====================================================================================================================

-- ─────────────────────────────── registro de acesso (LGPD) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_custo_pessoa_acesso_log (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid        NOT NULL REFERENCES public.companies(id),
  user_id    uuid        NOT NULL,
  fonte      text        NOT NULL CHECK (fonte IN ('compliance_funcionarios.salario_base', 'agency_timesheet.custo')),
  origem     text        NOT NULL CHECK (origem IN ('leitura', 'gravacao')),
  registros  integer     NOT NULL,
  em         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_custo_pessoa_acesso_log IS
  'Quem leu/gravou salário ou custo por pessoa (compliance_funcionarios.salario_base, agency_timesheet.custo_*) e quando. '
  'Só as funções fn_compliance_* / fn_pm_timesheet_* gravam. Migration 20261005180000 (LGPD, CEO 04/10).';
CREATE INDEX IF NOT EXISTS ix_erp_custo_pessoa_acesso_log_empresa ON public.erp_custo_pessoa_acesso_log (company_id, em DESC);
ALTER TABLE public.erp_custo_pessoa_acesso_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_custo_pessoa_acesso_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_custo_pessoa_acesso_log TO authenticated;
DROP POLICY IF EXISTS erp_custo_pessoa_acesso_log_ler ON public.erp_custo_pessoa_acesso_log;
CREATE POLICY erp_custo_pessoa_acesso_log_ler ON public.erp_custo_pessoa_acesso_log FOR SELECT TO authenticated
  USING ((company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
         AND public.fn__mao_obra_pode_ver_individual(company_id));

-- ─────────────────────────────── direito por coluna ───────────────────────────────
-- Montado pela lista real de colunas (menos as sensíveis): não depende de uma lista copiada que envelheça.
DO $col$
DECLARE v_cf text; v_ts text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cf
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'compliance_funcionarios' AND column_name <> 'salario_base';
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_ts
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'agency_timesheet' AND column_name NOT IN ('custo_hora', 'custo_total');

  REVOKE ALL ON TABLE public.compliance_funcionarios FROM PUBLIC, anon, authenticated;
  EXECUTE format('GRANT SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s) ON public.compliance_funcionarios TO authenticated', v_cf);
  GRANT DELETE ON public.compliance_funcionarios TO authenticated;

  REVOKE ALL ON TABLE public.agency_timesheet FROM PUBLIC, anon, authenticated;
  -- custo_total é coluna GERADA: não entra em INSERT/UPDATE de ninguém
  EXECUTE format('GRANT SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s) ON public.agency_timesheet TO authenticated', v_ts);
  GRANT DELETE ON public.agency_timesheet TO authenticated;
END $col$;

-- ─────────────────────────────── Compliance: salario_base ───────────────────────────────
-- Salário individual de uma pessoa. Só a empresa EMPREGADORA (company_id) — a tomadora nunca vê. Quem não vê salário
-- recebe a média da função (cargo) da empresa, quando o grupo tem 3+ pessoas.
CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_salario(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_cargo text; v_sal numeric; v_pode boolean; v_n int; v_media numeric;
BEGIN
  SELECT f.company_id, f.cargo, f.salario_base INTO v_emp, v_cargo, v_sal FROM compliance_funcionarios f WHERE f.id = p_id;
  IF v_emp IS NULL THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND v_emp NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN NULL; -- tomadora (ou outra empresa) não vê salário
  END IF;
  v_pode := public.fn__mao_obra_pode_ver_individual(v_emp);
  IF v_pode THEN
    IF auth.uid() IS NOT NULL THEN
      INSERT INTO erp_custo_pessoa_acesso_log (company_id, user_id, fonte, origem, registros)
      VALUES (v_emp, auth.uid(), 'compliance_funcionarios.salario_base', 'leitura', 1);
    END IF;
    RETURN jsonb_build_object('pode_ver', true, 'salario_base', v_sal);
  END IF;
  SELECT count(*), avg(f.salario_base) INTO v_n, v_media
    FROM compliance_funcionarios f
   WHERE f.company_id = v_emp AND f.ativo AND f.salario_base IS NOT NULL
     AND lower(btrim(coalesce(f.cargo, ''))) = lower(btrim(coalesce(v_cargo, '')));
  RETURN jsonb_build_object('pode_ver', false, 'cargo', v_cargo, 'pessoas_no_cargo', v_n,
                            'media_funcao', CASE WHEN v_n >= 3 THEN round(v_media, 2) END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_salario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_salario(uuid) TO authenticated, service_role;

-- Lista: salário por pessoa só para quem vê salário (registra o acesso).
CREATE OR REPLACE FUNCTION public.fn_compliance_salarios(p_company_id uuid)
 RETURNS TABLE(id uuid, salario_base numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM compliance_funcionarios f WHERE f.company_id = p_company_id;
    INSERT INTO erp_custo_pessoa_acesso_log (company_id, user_id, fonte, origem, registros)
    VALUES (p_company_id, auth.uid(), 'compliance_funcionarios.salario_base', 'leitura', v_n);
  END IF;
  RETURN QUERY SELECT f.id, f.salario_base FROM compliance_funcionarios f WHERE f.company_id = p_company_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_compliance_salarios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_salarios(uuid) TO authenticated, service_role;

-- Média por função (cargo): qualquer um da empresa; grupo com menos de 3 pessoas não mostra média.
CREATE OR REPLACE FUNCTION public.fn_compliance_salario_media_funcao(p_company_id uuid)
 RETURNS TABLE(cargo text, pessoas integer, media numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT lower(btrim(coalesce(f.cargo, ''))) AS cargo, count(*)::int AS pessoas,
           CASE WHEN count(*) >= 3 THEN round(avg(f.salario_base), 2) END AS media
      FROM compliance_funcionarios f
     WHERE f.company_id = p_company_id AND f.ativo AND f.salario_base IS NOT NULL
     GROUP BY lower(btrim(coalesce(f.cargo, '')));
END $function$;
REVOKE ALL ON FUNCTION public.fn_compliance_salario_media_funcao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_salario_media_funcao(uuid) TO authenticated, service_role;

-- Gravação: só quem vê salário (e fica registrado). Recusa os demais — nunca grava em silêncio.
CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_salario_salvar(p_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF p_valor IS NOT NULL AND p_valor < 0 THEN
    RAISE EXCEPTION 'Salário não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  SELECT f.company_id INTO v_emp FROM compliance_funcionarios f WHERE f.id = p_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND v_emp NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn__mao_obra_pode_ver_individual(v_emp) THEN
    RAISE EXCEPTION 'Sem permissão para gravar salário' USING ERRCODE = '42501';
  END IF;
  UPDATE compliance_funcionarios SET salario_base = p_valor WHERE id = p_id;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO erp_custo_pessoa_acesso_log (company_id, user_id, fonte, origem, registros)
    VALUES (v_emp, auth.uid(), 'compliance_funcionarios.salario_base', 'gravacao', 1);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_salario_salvar(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_salario_salvar(uuid, numeric) TO authenticated, service_role;

-- ─────────────────────────────── P&M: custo do apontamento ───────────────────────────────
-- (1) O custo/hora do apontamento nasce no servidor: ninguém grava custo_hora direto (direito por coluna).
--     Preenche pela equipe (mesma empresa, mesmo usuário) quando o INSERT não traz custo.
CREATE OR REPLACE FUNCTION public.fn__agency_timesheet_custo_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.custo_hora IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT e.custo_hora INTO NEW.custo_hora FROM agency_equipe e
     WHERE e.company_id = NEW.company_id AND e.user_id = NEW.user_id AND e.custo_hora > 0
     ORDER BY e.ativo DESC, e.created_at LIMIT 1;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn__agency_timesheet_custo_auto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_timesheet_custo_auto ON public.agency_timesheet;
CREATE TRIGGER trg_agency_timesheet_custo_auto BEFORE INSERT ON public.agency_timesheet
  FOR EACH ROW EXECUTE FUNCTION public.fn__agency_timesheet_custo_auto();

-- (2) Apontar horas: o custo/hora vem da pessoa escolhida (agency_equipe) NO SERVIDOR; quem não vê salário apontou e
--     nunca viu o valor. Devolve o custo do apontamento só para quem vê salário.
CREATE OR REPLACE FUNCTION public.fn_pm_timesheet_apontar(
  p_company_id uuid, p_job_id uuid, p_membro_id uuid, p_data date, p_horas numeric,
  p_descricao text DEFAULT NULL, p_inicio timestamptz DEFAULT NULL, p_fim timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_custo numeric; v_total numeric; v_pode boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_horas IS NULL OR p_horas <= 0 THEN RAISE EXCEPTION 'Informe as horas' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agency_jobs j WHERE j.id = p_job_id AND j.company_id = p_company_id) THEN
    RAISE EXCEPTION 'Job não pertence a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_membro_id IS NOT NULL THEN
    SELECT e.custo_hora INTO v_custo FROM agency_equipe e WHERE e.id = p_membro_id AND e.company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não pertence a esta empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  INSERT INTO agency_timesheet (company_id, job_id, user_id, data, horas, descricao, custo_hora, inicio_em, fim_em)
  VALUES (p_company_id, p_job_id, auth.uid(), COALESCE(p_data, current_date), p_horas, p_descricao,
          CASE WHEN v_custo > 0 THEN v_custo END, p_inicio, p_fim)
  RETURNING id, custo_total INTO v_id, v_total;
  v_pode := public.fn__mao_obra_pode_ver_individual(p_company_id);
  RETURN jsonb_build_object('id', v_id, 'tem_custo', COALESCE(v_custo, 0) > 0, 'custo_total', CASE WHEN v_pode THEN v_total END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_timesheet_apontar(uuid, uuid, uuid, date, numeric, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_timesheet_apontar(uuid, uuid, uuid, date, numeric, text, timestamptz, timestamptz) TO authenticated, service_role;

-- (3) Custo por apontamento (por pessoa): só quem vê salário, com registro.
CREATE OR REPLACE FUNCTION public.fn_pm_timesheet_custos(p_company_id uuid, p_limite integer DEFAULT 200)
 RETURNS TABLE(id uuid, custo_hora numeric, custo_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_lim int := LEAST(GREATEST(COALESCE(p_limite, 200), 1), 1000); v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM (SELECT 1 FROM agency_timesheet t WHERE t.company_id = p_company_id LIMIT v_lim) s;
    INSERT INTO erp_custo_pessoa_acesso_log (company_id, user_id, fonte, origem, registros)
    VALUES (p_company_id, auth.uid(), 'agency_timesheet.custo', 'leitura', v_n);
  END IF;
  RETURN QUERY
    SELECT t.id, t.custo_hora, t.custo_total FROM agency_timesheet t
     WHERE t.company_id = p_company_id ORDER BY t.data DESC, t.created_at DESC LIMIT v_lim;
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_timesheet_custos(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_timesheet_custos(uuid, integer) TO authenticated, service_role;

-- (4) Margem por job: AGREGADO por job (não por pessoa), para qualquer um da empresa. Duas linhas por job no máximo:
--     as horas COM custo (soma de horas e do custo) e as horas SEM custo. Não devolve custo/hora de ninguém.
CREATE OR REPLACE FUNCTION public.fn_pm_job_custos(p_company_id uuid)
 RETURNS TABLE(job_id uuid, horas numeric, tem_custo boolean, custo_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.job_id, sum(t.horas), (COALESCE(t.custo_hora, 0) > 0) AS tem_custo, sum(t.custo_total)
      FROM agency_timesheet t
     WHERE t.company_id = p_company_id
     GROUP BY t.job_id, (COALESCE(t.custo_hora, 0) > 0);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_job_custos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_custos(uuid) TO authenticated, service_role;

-- ─────────────────────────────── auditoria da própria regra (RD-79/RD-90) ───────────────────────────────
-- Lista as colunas de salário/custo por pessoa que o logado (ou o anon) ainda consegue LER. Tem de voltar vazia.
-- Só serviço (a prova @pos-migration e o gate de segurança chamam; membro comum não).
CREATE OR REPLACE FUNCTION public.fn_seguranca_colunas_pessoa_legiveis()
 RETURNS TABLE(tabela text, coluna text, papel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.tabela, c.coluna, r.papel
    FROM (VALUES ('compliance_funcionarios', 'salario_base'),
                 ('agency_timesheet', 'custo_hora'),
                 ('agency_timesheet', 'custo_total'),
                 ('agency_equipe', 'custo_hora')) AS c(tabela, coluna)
    CROSS JOIN (VALUES ('authenticated'), ('anon')) AS r(papel)
   WHERE has_column_privilege(r.papel, format('public.%I', c.tabela), c.coluna, 'SELECT')
$function$;
REVOKE ALL ON FUNCTION public.fn_seguranca_colunas_pessoa_legiveis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seguranca_colunas_pessoa_legiveis() TO service_role;
