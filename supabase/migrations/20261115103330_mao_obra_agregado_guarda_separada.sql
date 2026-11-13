-- GAP auditor · /dashboard/industrial/mao-obra (Code: rodrigo-code)
-- Problema: o custo AGREGADO de mão de obra por setor (número gerencial, não-sensível) só é
-- liberado por fn__mao_obra_pode_ver_individual, que olha APENAS user_companies.role e IGNORA o
-- escopo industrial (user_scope.papel_slug). Um Gerente de Produção (ind_ger_producao) — e todo
-- gestor cujo acesso à empresa vem pelo escopo industrial e não por role gerencial em
-- user_companies — cai em "Acesso restrito ao RH" e não vê o custo total.
--
-- AJUSTE do revisor (gilberto-revisor, RD-38): a função fn__mao_obra_pode_ver_individual é a
-- MESMA guarda do salário INDIVIDUAL (fn_compliance_funcionario_salario, fn_compliance_salarios,
-- fn_mao_obra_ficha_historico, fn_pm_equipe_custos, fn_pm_timesheet_custos e a policy
-- mao_obra_custo_select). Ampliá-la vazaria salário por pessoa (PII/LGPD). Por isso ela fica
-- INTOCADA (não é recriada aqui) e o agregado passa a usar uma GUARDA SEPARADA.
--
-- Correção (aditiva): nova fn__mao_obra_pode_ver_agregado = (guarda individual atual)
-- OR (escopo industrial ativo com camada gerencial propriedade/direção/gerência). Só
-- fn_custo_folha_setor_agregado (número gerencial, NÃO devolve nada individual) e o card do
-- agregado na tela apontam para ela. Nada que devolva valor individual usa a guarda nova.
--
-- RD-38 (provado no banco): pela guarda nova ganham o AGREGADO exatamente as camadas gerenciais
-- (propriedade/direção/gerência) — ind_ger_producao, ind_ger_administrativo, ind_ger_unidade etc.;
-- supervisão/operação/especialista seguem FORA. Salário por pessoa permanece restrito ao RH/diretoria.
-- RD-52: migration é arquivo+PR. RD-94.1: função de guarda = SENSÍVEL (revisao-eng-chefe).

-- 1) Guarda SEPARADA do agregado (não toca a guarda do individual).
CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_agregado(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- RH/diretoria (quem já vê o individual) seguem vendo o agregado…
  SELECT public.fn__mao_obra_pode_ver_individual(p_company_id)
  -- …e, além deles, gestores pelo escopo industrial nas camadas gerenciais (só o número agregado).
     OR EXISTS (
       SELECT 1 FROM user_scope us
         JOIN rbac_papel rp ON rp.slug = us.papel_slug
        WHERE us.user_id = auth.uid() AND us.company_id = p_company_id AND us.ativo
          AND rp.camada IN ('propriedade', 'direcao', 'gerencia'))
$function$;

REVOKE EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_agregado(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_agregado(uuid) TO authenticated, service_role;

-- 2) O agregado passa a usar a guarda nova (é número gerencial; não devolve salário por pessoa).
CREATE OR REPLACE FUNCTION public.fn_custo_folha_setor_agregado(p_company_id uuid)
 RETURNS TABLE(competencia date, setor text, colaboradores bigint, custo_total numeric, remuneracao_base numeric, pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- Agregado é gerencial: liberado a RH/diretoria E às camadas gerenciais do escopo industrial.
  -- Não devolve nada individual, então não há vazamento de salário por pessoa.
  IF NOT public.fn__mao_obra_pode_ver_agregado(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso ao custo de mão de obra desta empresa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT v.competencia, v.setor, v.colaboradores, v.custo_total, v.remuneracao_base
    FROM public.v_custo_folha_setor v
    WHERE v.company_id = p_company_id
  ), tot AS (
    SELECT b.competencia AS c, SUM(b.custo_total) AS t
    FROM base b GROUP BY b.competencia
  )
  SELECT b.competencia, b.setor, b.colaboradores, b.custo_total, b.remuneracao_base,
         round(100 * b.custo_total / NULLIF((SELECT t FROM tot WHERE tot.c = b.competencia), 0), 1)
  FROM base b
  ORDER BY b.competencia DESC, b.custo_total DESC;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_custo_folha_setor_agregado(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_custo_folha_setor_agregado(uuid) TO authenticated, service_role;
