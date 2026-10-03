-- Mão de obra compartilhada (SPEC aprovada pelo CEO + correções do Eng. Chefe, 03/10). Nenhuma tabela nova, nada apagado.
--
--  • A tela da Mão de obra vira um componente só, servido em /dashboard/_compartilhado/mao-obra?area=<área> (e, como
--    sempre, em /dashboard/projetos/mao-obra para o Hub). Um item "Mão de obra" por área no module_catalog (P&M,
--    Indústria, Oficina, Odonto, Agro, Gestão Empresarial — Restaurante não existe como área), nos mesmos planos do
--    módulo principal da área; uma linha em system_screens para a tela compartilhada.
--  • compliance_funcionarios.user_id (opcional, único por empresa): liga a pessoa ao usuário do sistema. Só gestor e
--    financeiro da empresa (fn__mao_obra_pode_ver_individual) ligam, e só a um usuário que tem acesso à empresa.
--  • fn_mao_obra_funcoes_modelo(empresa, área): funções-modelo por área. Sem área: a área dos planos contratados; mais
--    de uma → a tela pergunta. Só cria o que falta (nomes), sem custo inventado.
--  • fn_mao_obra_custo_hora_usuario(empresa, usuário) — REGRA LGPD: o custo da hora DA PESSOA só para quem vê salário
--    (fn__mao_obra_pode_ver_individual) e cada entrega fica em erp_mao_obra_acesso_log; para os demais, a MÉDIA DA
--    FUNÇÃO da pessoa (nunca o individual). Devolve "individual" (true/false) dizendo qual dos dois voltou.
--  • P&M: gatilho em agency_timesheet tira o custo da hora da Mão de obra (interno, como definer — usa o valor real da
--    ficha conferida no custo e na margem do job; sem ficha conferida, a média da função). agency_equipe.custo_hora
--    deixa de ser usado (não é apagado). As colunas custo_hora/custo_total do apontamento deixam de ser lidas direto
--    pelo cliente (eram o custo de cada pessoa); as telas leem os TOTAIS por job em fn_pm_custo_jobs.
--  • Oficina: fn_oficina_custo_hora usa a Mão de obra quando o quadro está conferido (todas as fichas vigentes
--    conferidas — não existia flag "quadro conferido"; a regra é derivada das fichas). Sem isso segue o cálculo atual
--    (custo manual > custos fixos), com aviso de origem — nenhum preço de OS zera.
--  • Indústria: nenhum consumidor de custo da hora no custeio (custos_industriais é R$ do período por grupo; custeio
--    ABC e ficha técnica não usam hora) — nada a ligar aqui (relatado ao CEO).
-- RLS e guarda de empresa das tabelas atuais ficam como estão.

-- ───────────────────────────── 1) pessoa ↔ usuário do sistema ─────────────────────────────
ALTER TABLE public.compliance_funcionarios ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_compliance_funcionarios_user ON public.compliance_funcionarios (company_id, user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.compliance_funcionarios.user_id IS
  'Usuário do sistema desta pessoa (opcional, um por empresa). Liga o apontamento de horas ao custo da Mão de obra. Só gestor/financeiro liga.';

-- quem liga: só gestor/financeiro da empresa (o mesmo que vê salário); o usuário tem de ter acesso à empresa
CREATE OR REPLACE FUNCTION public.fn_trg_funcionario_usuario_guarda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id IS NULL THEN RETURN NEW; END IF;
  -- usuário apagado (ON DELETE SET NULL do FK): deixa a cascata passar
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id) THEN RETURN NEW; END IF;
  -- ligar, trocar ou desligar: só quem vê salário (sem sessão = serviço/cascata do FK)
  IF auth.uid() IS NOT NULL AND NOT public.fn__mao_obra_pode_ver_individual(NEW.company_id) THEN
    RAISE EXCEPTION 'Só gestor ou financeiro da empresa liga a pessoa a um usuário do sistema.' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = NEW.user_id AND uc.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Este usuário não tem acesso a esta empresa.';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_funcionario_usuario_guarda() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_funcionario_usuario_guarda BEFORE INSERT OR UPDATE OF user_id ON public.compliance_funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_funcionario_usuario_guarda();

-- o log de acesso ao custo individual ganha a origem "custo_hora_usuario"
ALTER TABLE public.erp_mao_obra_acesso_log DROP CONSTRAINT IF EXISTS erp_mao_obra_acesso_log_origem_check;
ALTER TABLE public.erp_mao_obra_acesso_log ADD CONSTRAINT erp_mao_obra_acesso_log_origem_check
  CHECK (origem IN ('lista', 'historico', 'custo_hora_usuario'));

-- ───────────────────────────── 2) áreas e funções-modelo ─────────────────────────────
-- funções-modelo por área (só nome e forma de pagamento — sem custo inventado). hub = as de obra de sempre.
CREATE OR REPLACE FUNCTION public.fn__mao_obra_modelos(p_area text)
 RETURNS TABLE(ordem int, nome text, forma text, unidade text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT m.ordem, m.nome, m.forma, m.unidade FROM (VALUES
    ('hub', 1, 'Servente', 'hora', NULL), ('hub', 2, 'Pedreiro', 'hora', NULL), ('hub', 3, 'Gesseiro', 'producao', 'm2'),
    ('hub', 4, 'Pintor', 'producao', 'm2'), ('hub', 5, 'Carpinteiro', 'hora', NULL), ('hub', 6, 'Eletricista', 'hora', NULL),
    ('hub', 7, 'Encanador', 'hora', NULL), ('hub', 8, 'Aplicador de piso vinílico', 'producao', 'm2'),
    ('hub', 9, 'Mestre de obras', 'mensal', NULL), ('hub', 10, 'Engenheiro', 'mensal', NULL),
    ('pm', 1, 'Designer', 'mensal', NULL), ('pm', 2, 'Social media', 'mensal', NULL), ('pm', 3, 'Redator', 'mensal', NULL),
    ('pm', 4, 'Editor de vídeo', 'mensal', NULL), ('pm', 5, 'Atendimento', 'mensal', NULL), ('pm', 6, 'Tráfego', 'mensal', NULL),
    ('industrial', 1, 'Operador', 'mensal', NULL), ('industrial', 2, 'Auxiliar de produção', 'mensal', NULL),
    ('industrial', 3, 'Desossador', 'mensal', NULL), ('industrial', 4, 'Magarefe', 'mensal', NULL), ('industrial', 5, 'Manutenção', 'mensal', NULL),
    ('oficina', 1, 'Mecânico', 'mensal', NULL), ('oficina', 2, 'Eletricista', 'mensal', NULL), ('oficina', 3, 'Funileiro', 'mensal', NULL),
    ('odonto', 1, 'Dentista', 'mensal', NULL), ('odonto', 2, 'Auxiliar de saúde bucal', 'mensal', NULL), ('odonto', 3, 'Recepcionista', 'mensal', NULL),
    ('agro', 1, 'Operador de máquinas', 'mensal', NULL), ('agro', 2, 'Tratorista', 'mensal', NULL), ('agro', 3, 'Auxiliar rural', 'mensal', NULL),
    ('ge', 1, 'Auxiliar administrativo', 'mensal', NULL), ('ge', 2, 'Vendedor', 'mensal', NULL), ('ge', 3, 'Financeiro', 'mensal', NULL)
  ) m(area, ordem, nome, forma, unidade)
  WHERE m.area = CASE WHEN lower(p_area) = 'gestao_empresarial' THEN 'ge' ELSE lower(p_area) END
  ORDER BY m.ordem
$function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_modelos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_modelos(text) TO authenticated, service_role;

-- áreas contratadas da empresa (vertical dos planos ativos), na ordem da tela
-- ci-sem-guarda: fn__mao_obra_areas_contratadas — interna e só leitura; sem EXECUTE para authenticated
CREATE OR REPLACE FUNCTION public.fn__mao_obra_areas_contratadas(p_company_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(a.area ORDER BY a.ordem), ARRAY[]::text[]) FROM (
    SELECT DISTINCT x.area, x.ordem FROM tenant_subscriptions ts
      JOIN plan_catalog pc ON pc.id = ts.plan_id
      JOIN (VALUES ('hub', 'hub', 1), ('pm', 'pm', 2), ('industrial', 'industrial', 3), ('oficina', 'oficina', 4),
                   ('odonto', 'odonto', 5), ('agro', 'agro', 6), ('gestao_empresarial', 'ge', 7)) x(vertical, area, ordem) ON x.vertical = pc.vertical
     WHERE ts.company_id = p_company_id AND ts.status = 'active') a
$function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_areas_contratadas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_areas_contratadas(uuid) TO service_role;

-- a tela: quais áreas a empresa contratou e as funções-modelo de cada área
CREATE OR REPLACE FUNCTION public.fn_mao_obra_areas_empresa(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN jsonb_build_object(
    'contratadas', to_jsonb(public.fn__mao_obra_areas_contratadas(p_company_id)),
    'areas', (SELECT jsonb_agg(jsonb_build_object('area', a.area, 'rotulo', a.rotulo,
                'modelos', (SELECT jsonb_agg(m.nome ORDER BY m.ordem) FROM public.fn__mao_obra_modelos(a.area) m)) ORDER BY a.ordem)
                FROM (VALUES ('hub', 'Obras (Hub)', 1), ('pm', 'P&M', 2), ('industrial', 'Indústria', 3), ('oficina', 'Oficina', 4),
                             ('odonto', 'Odonto', 5), ('agro', 'Agro', 6), ('ge', 'Gestão Empresarial', 7)) a(area, rotulo, ordem)));
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_areas_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_areas_empresa(uuid) TO authenticated, service_role;

-- "Usar funções-modelo" agora por área: assinatura nova (empresa, área). A antiga (só empresa) fica e passa a chamar a
-- nova sem área (tela antiga aberta durante o deploy continua funcionando); sem DEFAULT na nova = sem ambiguidade de
-- sobrecarga. Só por botão; só cria os nomes que ainda não existem; sem custo inventado.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcoes_modelo(p_company_id uuid, p_area text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_area text := lower(NULLIF(btrim(COALESCE(p_area, '')), '')); v_areas text[]; v_n int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  IF v_area = 'gestao_empresarial' THEN v_area := 'ge'; END IF;
  IF v_area IS NULL THEN
    v_areas := public.fn__mao_obra_areas_contratadas(p_company_id);
    IF cardinality(v_areas) = 1 THEN
      v_area := v_areas[1];
    ELSE
      -- nenhuma ou mais de uma área contratada: a tela pergunta
      RETURN jsonb_build_object('ok', false, 'precisa_area', true, 'areas', to_jsonb(v_areas), 'erro', 'Escolha a área das funções-modelo.');
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn__mao_obra_modelos(v_area)) THEN
    RAISE EXCEPTION 'Área sem funções-modelo: %', v_area;
  END IF;
  INSERT INTO erp_funcao_mao_obra (company_id, nome, forma_pagamento, unidade_producao)
  SELECT p_company_id, m.nome, m.forma, m.unidade FROM public.fn__mao_obra_modelos(v_area) m
   WHERE NOT EXISTS (SELECT 1 FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id AND f.ativo AND lower(btrim(f.nome)) = lower(btrim(m.nome)))
   ORDER BY m.ordem;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'area', v_area, 'criadas', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcoes_modelo(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN public.fn_mao_obra_funcoes_modelo(p_company_id, NULL::text);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcoes_modelo(uuid) TO authenticated, service_role;

-- ───────────────────────────── 3) usuários da empresa e vínculo da pessoa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mao_obra_usuarios_empresa(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'nome', COALESCE(NULLIF(btrim(u.full_name), ''), u.email), 'email', u.email,
            'pessoa', (SELECT cf.nome_completo FROM compliance_funcionarios cf WHERE cf.company_id = p_company_id AND cf.user_id = u.id))
            ORDER BY COALESCE(NULLIF(btrim(u.full_name), ''), u.email))
    FROM user_companies uc JOIN users u ON u.id = uc.user_id
   WHERE uc.company_id = p_company_id AND NOT COALESCE(u.is_robo, false)), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_usuarios_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_usuarios_empresa(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_mao_obra_pessoa_vincular_usuario(p_funcionario_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_outro text;
BEGIN
  SELECT company_id INTO v_company FROM compliance_funcionarios WHERE id = p_funcionario_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pessoa não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  PERFORM public.fn__mao_obra_exige_gestor(v_company);
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = p_user_id AND uc.company_id = v_company) THEN
      RAISE EXCEPTION 'Este usuário não tem acesso a esta empresa.';
    END IF;
    SELECT nome_completo INTO v_outro FROM compliance_funcionarios WHERE company_id = v_company AND user_id = p_user_id AND id <> p_funcionario_id;
    IF v_outro IS NOT NULL THEN RAISE EXCEPTION 'Este usuário já está ligado a %.', v_outro; END IF;
  END IF;
  UPDATE compliance_funcionarios SET user_id = p_user_id, updated_at = now() WHERE id = p_funcionario_id;
  RETURN jsonb_build_object('ok', true, 'funcionario_id', p_funcionario_id, 'user_id', p_user_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_pessoa_vincular_usuario(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_pessoa_vincular_usuario(uuid, uuid) TO authenticated, service_role;

-- ───────────────────────────── 4) custo da hora de uma pessoa ─────────────────────────────
-- interno: a ficha vigente na data (pessoa ligada ao usuário), o custo REAL da hora e a média da função. Nunca sai
-- direto para o cliente — só pelo gatilho do apontamento (definer) e por fn_mao_obra_custo_hora_usuario (com a regra LGPD).
CREATE OR REPLACE FUNCTION public.fn__mao_obra_custo_pessoa(p_company_id uuid, p_user_id uuid, p_data date DEFAULT current_date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_func uuid; v_func_funcao text; v_ficha uuid; v_grupo uuid; v_conf boolean := false; v_funcao uuid; v_nome_funcao text;
  v_d date := COALESCE(p_data, current_date); v_ind numeric; v_fn jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT id, funcao INTO v_func, v_func_funcao FROM compliance_funcionarios WHERE company_id = p_company_id AND user_id = p_user_id;
  IF v_func IS NULL THEN RETURN NULL; END IF;
  SELECT x.id, x.grupo_id, x.conferido, x.funcao_id INTO v_ficha, v_grupo, v_conf, v_funcao FROM erp_mao_obra_custo x
   WHERE x.company_id = p_company_id AND x.tipo = 'pessoa' AND x.funcionario_id = v_func
     AND x.vigencia_inicio <= v_d AND (x.vigencia_fim IS NULL OR x.vigencia_fim >= v_d)
   ORDER BY x.vigencia_inicio DESC, x.created_at DESC LIMIT 1;
  IF v_ficha IS NOT NULL THEN
    v_ind := (public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(v_ficha), public.fn_mao_obra_encargos_vigentes(p_company_id, v_d))->>'custo_hora')::numeric;
  ELSE
    -- sem ficha: a função pelo nome do cadastro compartilhado
    SELECT id INTO v_funcao FROM erp_funcao_mao_obra WHERE company_id = p_company_id AND ativo AND lower(btrim(nome)) = lower(btrim(COALESCE(v_func_funcao, '')))
     ORDER BY created_at LIMIT 1;
  END IF;
  IF v_funcao IS NOT NULL THEN
    v_fn := public.fn_funcao_custo_hora(v_funcao);
    SELECT nome INTO v_nome_funcao FROM erp_funcao_mao_obra WHERE id = v_funcao;
  END IF;
  RETURN jsonb_build_object('funcionario_id', v_func, 'ficha_id', v_ficha, 'grupo_id', v_grupo, 'conferido', COALESCE(v_conf, false),
    'funcao_id', v_funcao, 'funcao', v_nome_funcao, 'custo_hora_individual', v_ind,
    'custo_hora_funcao', (v_fn->>'custo_hora')::numeric, 'origem_funcao', COALESCE(v_fn->>'origem', 'sem_dado'));
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_custo_pessoa(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_custo_pessoa(uuid, uuid, date) TO service_role;

-- REGRA LGPD (CEO): o custo da hora DA PESSOA só para quem vê salário da empresa que emprega (owner, sócio, diretor,
-- gerente, financeiro, admin, acesso_total — fn__mao_obra_pode_ver_individual), e cada entrega vai para o log de acesso.
-- Para todos os outros: a média da FUNÇÃO da pessoa, nunca o individual. "individual" diz qual dos dois voltou.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_custo_hora_usuario(p_company_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v := public.fn__mao_obra_custo_pessoa(p_company_id, p_user_id, current_date);
  IF v IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'encontrado', false, 'individual', false, 'tipo', 'sem_cadastro', 'custo_hora', NULL);
  END IF;
  IF public.fn__mao_obra_pode_ver_individual(p_company_id) AND v->>'ficha_id' IS NOT NULL THEN
    IF auth.uid() IS NOT NULL THEN
      INSERT INTO erp_mao_obra_acesso_log (company_id, user_id, ficha_id, grupo_id, origem)
      VALUES (p_company_id, auth.uid(), (v->>'ficha_id')::uuid, (v->>'grupo_id')::uuid, 'custo_hora_usuario');
    END IF;
    RETURN jsonb_build_object('ok', true, 'encontrado', true, 'individual', true, 'tipo', 'individual',
      'custo_hora', v->'custo_hora_individual', 'conferido', v->'conferido', 'funcao', v->'funcao');
  END IF;
  RETURN jsonb_build_object('ok', true, 'encontrado', true, 'individual', false, 'tipo', 'media_funcao',
    'custo_hora', v->'custo_hora_funcao', 'origem_funcao', v->'origem_funcao', 'funcao', v->'funcao');
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_custo_hora_usuario(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_custo_hora_usuario(uuid, uuid) TO authenticated, service_role;

-- ───────────────────────────── 5) P&M: apontamento tira o custo da hora da Mão de obra ─────────────────────────────
-- ficha conferida → custo real da pessoa; senão → média da função; sem nada na Mão de obra → fica o que veio (as telas
-- novas não mandam mais custo; sem custo a margem pede o cadastro). Vale para o apontamento novo e quando muda a pessoa
-- ou a data; o que já foi apontado não é recalculado (é o custo da época).
CREATE OR REPLACE FUNCTION public.fn_trg_agency_timesheet_custo_mao_obra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_h numeric;
BEGIN
  v := public.fn__mao_obra_custo_pessoa(NEW.company_id, NEW.user_id, NEW.data);
  IF v IS NOT NULL THEN
    v_h := CASE WHEN (v->>'conferido')::boolean THEN (v->>'custo_hora_individual')::numeric END;
    v_h := COALESCE(v_h, (v->>'custo_hora_funcao')::numeric);
    IF v_h IS NOT NULL THEN NEW.custo_hora := v_h; END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_agency_timesheet_custo_mao_obra() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_agency_timesheet_custo_mao_obra BEFORE INSERT OR UPDATE OF user_id, data ON public.agency_timesheet
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_agency_timesheet_custo_mao_obra();

-- LGPD: custo_hora/custo_total de cada apontamento é o custo da pessoa — o cliente não lê mais essas colunas direto
-- (as telas usam os totais de fn_pm_custo_jobs). Coluna nova em agency_timesheet precisa entrar neste GRANT.
REVOKE SELECT ON public.agency_timesheet FROM anon, authenticated;
GRANT SELECT (id, company_id, job_id, tarefa_id, user_id, data, horas, descricao, tipo_atividade, aprovado, aprovado_por,
              created_at, inicio_em, fim_em, etapa_tipo, cliente_id) ON public.agency_timesheet TO authenticated;

-- totais por job (nunca por pessoa): horas, horas sem custo, custo do job; e quem apontou sem custo da hora
CREATE OR REPLACE FUNCTION public.fn_pm_custo_jobs(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN jsonb_build_object(
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('job_id', t.job_id, 'horas', t.horas, 'horas_sem_custo', t.horas_sem_custo, 'custo', t.custo))
      FROM (SELECT job_id, round(sum(horas), 2) horas,
                   round(COALESCE(sum(horas) FILTER (WHERE COALESCE(custo_hora, 0) <= 0), 0), 2) horas_sem_custo,
                   round(sum(COALESCE(custo_total, 0)), 2) custo
              FROM agency_timesheet WHERE company_id = p_company_id AND job_id IS NOT NULL GROUP BY job_id) t), '[]'::jsonb),
    'total_horas', (SELECT round(COALESCE(sum(horas), 0), 2) FROM agency_timesheet WHERE company_id = p_company_id),
    'total_custo', (SELECT round(COALESCE(sum(custo_total), 0), 2) FROM agency_timesheet WHERE company_id = p_company_id),
    'pessoas_sem_custo', COALESCE((SELECT jsonb_agg(DISTINCT COALESCE(NULLIF(btrim(u.full_name), ''), u.email))
      FROM agency_timesheet t JOIN users u ON u.id = t.user_id
     WHERE t.company_id = p_company_id AND t.horas > 0 AND COALESCE(t.custo_hora, 0) <= 0), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_custo_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_custo_jobs(uuid) TO authenticated, service_role;

-- ───────────────────────────── 6) a tela lista também o usuário ligado a cada pessoa ─────────────────────────────
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
      -- usuário do sistema ligado à pessoa (não é dado de salário)
      'user_id', cf.user_id,
      'usuario_nome', (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = cf.user_id),
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

-- ───────────────────────────── 7) Oficina: custo da hora pela Mão de obra quando o quadro está conferido ─────────────────────────────
-- "quadro conferido" = há fichas vigentes e TODAS estão conferidas. Custo = média das fichas conferidas, pesada pelas
-- horas produtivas × pessoas (é a média da equipe, não sai custo de uma pessoa).
-- ci-sem-guarda: fn__mao_obra_quadro_custo — interna e só leitura; sem EXECUTE para authenticated
CREATE OR REPLACE FUNCTION public.fn__mao_obra_quadro_custo(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; c jsonb; w numeric; v_num numeric := 0; v_den numeric := 0; v_fichas int := 0; v_pend int := 0; v_pessoas int := 0;
BEGIN
  FOR r IN SELECT k.id, k.conferido, k.horas_produtivas_mes, k.quantidade_pessoas FROM erp_mao_obra_custo k
            WHERE k.company_id = p_company_id AND k.ativo AND k.vigencia_fim IS NULL LOOP
    v_fichas := v_fichas + 1;
    IF NOT r.conferido THEN v_pend := v_pend + 1; CONTINUE; END IF;
    c := public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(r.id), public.fn_mao_obra_encargos_vigentes(p_company_id));
    IF (c->>'custo_hora') IS NOT NULL THEN
      w := r.horas_produtivas_mes * r.quantidade_pessoas;
      v_num := v_num + (c->>'custo_hora')::numeric * w; v_den := v_den + w; v_pessoas := v_pessoas + r.quantidade_pessoas;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('quadro_conferido', v_fichas > 0 AND v_pend = 0 AND v_den > 0, 'fichas', v_fichas, 'nao_conferidas', v_pend,
    'pessoas', v_pessoas, 'custo_hora', CASE WHEN v_den > 0 THEN round(v_num / v_den, 2) END);
END $function$;
REVOKE ALL ON FUNCTION public.fn__mao_obra_quadro_custo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_quadro_custo(uuid) TO service_role;

-- mesmo corpo de produção (03/10) + a Mão de obra. Ordem: valor manual (decisão explícita da oficina) > Mão de obra
-- com quadro conferido > custos fixos lançados. Sem quadro conferido: cálculo atual + aviso de origem.
CREATE OR REPLACE FUNCTION public.fn_oficina_custo_hora(p_company_id uuid, p_periodo_meses integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meses int := GREATEST(1, LEAST(24, COALESCE(p_periodo_meses, 3)));
  v_cats text[]; v_horas_mes numeric; v_manual numeric; v_margem_mo numeric; v_margem_peca numeric;
  v_inicio date; v_fim date; v_horas_total numeric; v_total numeric; v_detalhe jsonb;
  v_custo numeric; v_origem text; v_alerta text := NULL; v_periodo text;
  v_mo jsonb; v_mo_ok boolean; v_mo_custo numeric; v_aviso_origem text;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT
    COALESCE(categorias_custo_fixo, ARRAY['2.04.01','2.03.01','2.03.10','2.04.04','2.04.10','2.05.04']::text[]),
    COALESCE(horas_produtivas_mes, 160),
    custo_hora_manual, COALESCE(margem_alvo_mao_obra_pct, 30), COALESCE(margem_alvo_peca_pct, 40)
  INTO v_cats, v_horas_mes, v_manual, v_margem_mo, v_margem_peca
  FROM erp_oficina_parametros WHERE company_id = p_company_id;

  IF v_horas_mes IS NULL THEN
    v_cats := ARRAY['2.04.01','2.03.01','2.03.10','2.04.04','2.04.10','2.05.04']::text[];
    v_horas_mes := 160; v_margem_mo := 30; v_margem_peca := 40;
  END IF;

  IF COALESCE(v_horas_mes, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'custo_hora', NULL, 'origem', 'erro',
      'alerta', 'Horas produtivas por mês inválidas (0). Ajuste em parâmetros.');
  END IF;

  -- Mão de obra (quadro conferido) e o aviso de origem quando não está
  v_mo := public.fn__mao_obra_quadro_custo(p_company_id);
  v_mo_ok := COALESCE((v_mo->>'quadro_conferido')::boolean, false);
  v_mo_custo := (v_mo->>'custo_hora')::numeric;
  v_aviso_origem := CASE
    WHEN v_mo_ok THEN NULL
    WHEN COALESCE((v_mo->>'fichas')::int, 0) = 0 THEN 'Custo da hora pelos custos fixos lançados. Cadastre e confira a equipe em Mão de obra para usar o custo real da equipe.'
    ELSE 'A equipe em Mão de obra tem ' || (v_mo->>'nao_conferidas') || ' ficha(s) não conferida(s): enquanto o quadro não estiver todo conferido, o custo da hora segue pelos custos fixos.' END;

  v_inicio := (date_trunc('month', CURRENT_DATE) - make_interval(months => v_meses - 1))::date;
  v_fim := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_horas_total := v_horas_mes * v_meses;
  v_periodo := to_char(v_inicio, 'MM/YYYY') || '–' || to_char(v_fim, 'MM/YYYY') || ' (' || v_meses || ' meses)';

  WITH base AS (
    SELECT ep.categoria, SUM(ep.valor) AS valor
    FROM erp_pagar ep
    WHERE ep.company_id = p_company_id
      AND ep.categoria = ANY(v_cats)
      AND COALESCE(ep.data_competencia, ep.data_vencimento, ep.data_emissao) BETWEEN v_inicio AND v_fim
      AND (ep.status IS NULL OR ep.status IN ('pago','aberto','vencido'))
    GROUP BY ep.categoria
  )
  SELECT COALESCE(SUM(b.valor), 0),
    COALESCE(jsonb_agg(jsonb_build_object('categoria', b.categoria,
      'rotulo', COALESCE(pc.descricao, b.categoria), 'valor', ROUND(b.valor, 2)) ORDER BY b.valor DESC), '[]'::jsonb)
  INTO v_total, v_detalhe
  FROM base b LEFT JOIN erp_plano_contas pc ON pc.company_id = p_company_id AND pc.codigo = b.categoria;

  IF v_total > 0 THEN
    SELECT jsonb_agg(elem || jsonb_build_object('pct', ROUND((elem->>'valor')::numeric / v_total * 100, 1)))
    INTO v_detalhe FROM jsonb_array_elements(v_detalhe) elem;
  END IF;

  IF v_total <= 0 THEN
    IF v_manual IS NOT NULL AND v_manual > 0 THEN
      RETURN jsonb_build_object('ok', true, 'custo_hora', v_manual, 'custo_hora_calculado', NULL,
        'origem', 'manual', 'periodo', v_periodo, 'total_custos_fixos', 0,
        'horas_consideradas', v_horas_total, 'horas_produtivas_mes', v_horas_mes,
        'margem_mao_obra_pct', v_margem_mo, 'margem_peca_pct', v_margem_peca, 'detalhe', '[]'::jsonb,
        'alerta', 'Sem custos lançados no período — usando o valor manual que você definiu.',
        'quadro_conferido', v_mo_ok, 'custo_hora_mao_obra', CASE WHEN v_mo_ok THEN v_mo_custo END);
    END IF;
    IF v_mo_ok AND v_mo_custo IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'custo_hora', v_mo_custo, 'custo_hora_calculado', NULL,
        'origem', 'mao_obra', 'periodo', v_periodo, 'total_custos_fixos', 0,
        'horas_consideradas', v_horas_total, 'horas_produtivas_mes', v_horas_mes,
        'margem_mao_obra_pct', v_margem_mo, 'margem_peca_pct', v_margem_peca, 'detalhe', '[]'::jsonb,
        'alerta', NULL, 'quadro_conferido', true, 'custo_hora_mao_obra', v_mo_custo, 'pessoas_mao_obra', (v_mo->>'pessoas')::int);
    END IF;
    RETURN jsonb_build_object('ok', true, 'custo_hora', NULL, 'custo_hora_calculado', NULL,
      'origem', 'sem_dados', 'periodo', v_periodo, 'total_custos_fixos', 0,
      'horas_consideradas', v_horas_total, 'horas_produtivas_mes', v_horas_mes,
      'margem_mao_obra_pct', v_margem_mo, 'margem_peca_pct', v_margem_peca, 'detalhe', '[]'::jsonb,
      'alerta', 'Sem custos lançados no período. Lance as despesas em Gestão Empresarial → Financeiro, ou informe um valor manual.',
      'quadro_conferido', false, 'aviso_origem', v_aviso_origem);
  END IF;

  v_custo := ROUND(v_total / v_horas_total, 2);
  IF v_manual IS NOT NULL AND v_manual > 0 THEN
    v_origem := 'manual';
  ELSIF v_mo_ok AND v_mo_custo IS NOT NULL THEN
    v_origem := 'mao_obra';
  ELSE
    v_origem := 'calculado';
    IF v_custo < 10 OR v_custo > 1000 THEN
      v_alerta := 'Valor atípico — confira as horas produtivas e as categorias de custo.';
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true,
    'custo_hora', CASE WHEN v_origem = 'manual' THEN v_manual WHEN v_origem = 'mao_obra' THEN v_mo_custo ELSE v_custo END,
    'custo_hora_calculado', v_custo, 'origem', v_origem, 'periodo', v_periodo,
    'total_custos_fixos', ROUND(v_total, 2), 'horas_consideradas', v_horas_total,
    'horas_produtivas_mes', v_horas_mes, 'margem_mao_obra_pct', v_margem_mo,
    'margem_peca_pct', v_margem_peca, 'detalhe', v_detalhe, 'alerta', v_alerta,
    'quadro_conferido', v_mo_ok, 'custo_hora_mao_obra', CASE WHEN v_mo_ok THEN v_mo_custo END,
    'aviso_origem', CASE WHEN v_origem = 'calculado' THEN v_aviso_origem END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_custo_hora(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_custo_hora(uuid, integer) TO authenticated, service_role;

-- ───────────────────────────── 8) menu: um item "Mão de obra" por área + a tela compartilhada ─────────────────────────────
-- a rota leva a área (?area=…): cada rota é única e a tela sabe quais funções-modelo oferecer. GE usa o slug da área
-- (gestao_empresarial) porque o menu lateral lê ?area= para escolher a área.
-- Entram INATIVOS e são ativados depois dos planos: o gatilho trg_modulo_vincular_planos (AFTER INSERT, só ativo) ligaria
-- o item a todo plano que tem algum módulo do mesmo grupo (ex.: GE iria para o plano Agro) — a SPEC pede os planos do
-- módulo PRINCIPAL da área.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES
  ('pm_mao_obra', 'Mão de obra', 'pm', 'pm_producao', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=pm', 85, false,
   'Equipe e custo da hora de cada função (encargos da empresa). O apontamento de horas e a margem do job usam este custo.', '2_svc', ARRAY['pm'], false),
  ('industrial_mao_obra', 'Mão de obra', 'industrial', 'rh_ponto', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=industrial', 12, false,
   'Equipe e custo da hora de cada função (operador, desossador, magarefe…) com os encargos da empresa.', '2_svc', ARRAY['industrial'], false),
  ('oficina_mao_obra', 'Mão de obra', 'oficina', 'oficina_operacao', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=oficina', 23, false,
   'Equipe e custo da hora (mecânico, eletricista, funileiro). Com o quadro conferido, vira o custo da hora da oficina.', '2_svc', ARRAY['oficina'], false),
  ('odonto_mao_obra', 'Mão de obra', 'odonto', 'odonto_financeiro', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=odonto', 52, false,
   'Equipe e custo da hora de cada função (dentista, auxiliar, recepção) com os encargos da clínica.', '2_svc', ARRAY['odonto'], false),
  ('agro_mao_obra', 'Mão de obra', 'agro', 'visao_executiva', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=agro', 1, false,
   'Equipe e custo da hora de cada função (operador de máquinas, tratorista, auxiliar rural).', '2_svc', ARRAY['agro'], false),
  ('ge_mao_obra', 'Mão de obra', 'gestao_empresarial', 'cadastros', 'HardHat', '/dashboard/_compartilhado/mao-obra?area=gestao_empresarial', 62, false,
   'Equipe e custo da hora de cada função (administrativo, vendas, financeiro) com os encargos da empresa.', '2_svc', ARRAY['gestao_empresarial'], false)
ON CONFLICT (id) DO NOTHING;

-- nos mesmos planos do módulo principal de cada área
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, legacy)
SELECT pm.plan_id, x.novo, pm.is_default_active, pm.legacy
  FROM (VALUES ('pm_mao_obra', 'pm_jobs'), ('industrial_mao_obra', 'industrial'), ('oficina_mao_obra', 'oficina_os'),
               ('odonto_mao_obra', 'odonto_agenda'), ('agro_mao_obra', 'agro_dashboard'), ('ge_mao_obra', 'ge_painel_geral')) x(novo, principal)
  JOIN public.plan_modules pm ON pm.module_id = x.principal
 WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules p2 WHERE p2.plan_id = pm.plan_id AND p2.module_id = x.novo);
UPDATE public.module_catalog SET ativo = true
 WHERE id IN ('pm_mao_obra', 'industrial_mao_obra', 'oficina_mao_obra', 'odonto_mao_obra', 'agro_mao_obra', 'ge_mao_obra') AND NOT ativo;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento, auditavel_robo)
VALUES ('dashboard._compartilhado.mao-obra', '/dashboard/_compartilhado/mao-obra', 'compartilhado', 'Mão de obra (compartilhada)',
        'Equipe, funções e custo da hora de cada área (P&M, Indústria, Oficina, Odonto, Agro, Gestão Empresarial). Mesma tela do Hub (/dashboard/projetos/mao-obra); ?area= escolhe as funções-modelo.',
        'desconhecida', 'alta', true)   -- o robô auditor valida e muda o estado (RD-38: nada vira "pronto" sem prova)
ON CONFLICT (rota) DO NOTHING;

-- ───────────────────────────── 9) ajuda de campo ("?") dos campos novos ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/mao-obra', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.mao_obra.area.escolher', 'Funções', 'Área das funções-modelo',
   'A área da empresa: Obras, P&M, Indústria, Oficina, Odonto, Agro ou Gestão Empresarial. Vem da área do menu; quando a empresa tem mais de uma, você escolhe.',
   'Define quais nomes de função vêm prontos. Só cria o que ainda não existe e não inventa custo.',
   'P&M: Designer, Social media, Redator, Editor de vídeo, Atendimento, Tráfego.',
   'Escolher a área errada e criar funções que a empresa não usa — inative as que sobrarem.', 90),
  ('projetos.mao_obra.pessoa.usuario', 'Pessoa', 'Usuário do sistema',
   'O login da pessoa no sistema, se ela tiver. Só aparecem usuários com acesso a esta empresa.',
   'Liga as horas que a pessoa aponta (P&M) ao custo da hora dela. Sem a ligação, o apontamento fica sem custo.',
   'Maria Souza (maria@agencia.com.br)',
   'Ligar ao usuário de outra pessoa: o custo dos jobs sai errado. Cada usuário liga a uma pessoa só.', 91),
  ('projetos.mao_obra.equipe.usuario', 'Equipe', 'Usuário ligado',
   'Mostra qual login do sistema é desta pessoa. Gestor e financeiro ligam ou trocam em "Ligar usuário".',
   'É por essa ligação que o apontamento de horas pega o custo da hora da pessoa.',
   'Maria Souza',
   'Deixar sem ligação quem aponta horas: a margem do job pede o custo da hora.', 92)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
