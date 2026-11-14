-- PDCA aud8 /dashboard/industrial/rh/quadro (gap 2, criterio f, desenvolvedor_4_g): contas de auditoria/teste
-- ("E2E Auditoria ...", cpf comecando em 'E2E'/'EXE') poluiam a lista de pessoas do Quadro de pessoal.
-- RD-38 (prova no dado, DEMO 005): ind_ponto_colaborador tem linhas com cpf = 'E2E587MWFAX7QK' (marca do
-- harness e2e), ao lado dos 24 colaboradores reais (cpf de 11 digitos). O harness grava direto na DEMO.
-- Correcao: excluir SO a marca do harness (cpf 'E2E%'/'EXE%') na origem de pessoas do quadro. Nenhum CPF
-- real comeca por letra, entao o filtro e seguro para TODA empresa e nao esconde pessoa de verdade.
-- Mantem o resto da funcao IDENTICO a definicao viva (lida por pg_get_functiondef em 13/11).
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_base(p_company_id uuid, p_competencia date DEFAULT NULL::date)
 RETURNS TABLE(cpf text, matricula text, nome text, funcao text, cargo_id uuid, cargo_nome text, setor_id uuid, setor_nome text, supervisor text, salario numeric, custo_mensal numeric, custo_hora numeric, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_enc numeric; v_horas numeric; v_fonte text; v_comp date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  SELECT COALESCE(pc.encargos_pct,38.35), COALESCE(pc.horas_mes,220), COALESCE(pc.fonte_custo,'folha_total')
    INTO v_enc, v_horas, v_fonte
    FROM (SELECT 1) z LEFT JOIN rh_parametro_custo pc ON pc.company_id = p_company_id;
  v_enc := COALESCE(v_enc,38.35); v_horas := COALESCE(v_horas,220); v_fonte := COALESCE(v_fonte,'folha_total');
  v_comp := COALESCE(p_competencia, (SELECT max(f.competencia) FROM folha_competencia f WHERE f.company_id = p_company_id));
  RETURN QUERY
  WITH pto AS (
    SELECT DISTINCT ON (cpf) cpf, btrim(matricula) AS matricula,
           regexp_replace(btrim(coalesce(matricula,'')),'^0+','') AS mat_norm, nome, funcao, departamento
    FROM ind_ponto_colaborador WHERE company_id = p_company_id AND cpf IS NOT NULL
      -- gap 2: fora as contas do harness e2e (cpf nao-numerico marcado 'E2E'/'EXE'); CPF real nunca comeca por letra
      AND cpf !~* '^(e2e|exe)'
    ORDER BY cpf, created_at DESC NULLS LAST ),
  fol AS (
    SELECT (f.matricula)::text AS mat_norm, max(f.cpf) AS cpf, max(f.nome) AS nome,
           sum(f.total_geral) AS total_geral, sum(f.remuneracao) AS remuneracao
    FROM folha_competencia f
    WHERE f.company_id = p_company_id AND f.competencia = v_comp AND f.matricula IS NOT NULL
    GROUP BY (f.matricula)::text ),
  pessoas AS (
    SELECT pt.cpf, pt.matricula, pt.mat_norm, pt.nome, pt.funcao, pt.departamento, 'ponto'::text AS fonte FROM pto pt
    UNION ALL
    SELECT fo.cpf, fo.mat_norm AS matricula, fo.mat_norm, fo.nome, NULL::text, NULL::text, 'so_folha'::text
      FROM fol fo WHERE NOT EXISTS (SELECT 1 FROM pto pt WHERE pt.mat_norm = fo.mat_norm) )
  SELECT p.cpf, p.matricula, COALESCE(p.nome, fo.nome) AS nome, p.funcao,
    COALESCE(cp.cargo_id, vc.cargo_id) AS cargo_id, cg.nome AS cargo_nome, cp.setor_id,
    COALESCE(st.nome, p.departamento) AS setor_nome, cp.supervisor_nome AS supervisor, sal.salario,
    CASE WHEN v_fonte = 'folha_total' THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0)) ELSE sal.salario * (1 + v_enc/100.0) END AS custo_mensal,
    (CASE WHEN v_fonte = 'folha_total' THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0)) ELSE sal.salario * (1 + v_enc/100.0) END) / NULLIF(v_horas,0) AS custo_hora,
    CASE WHEN p.fonte = 'so_folha' THEN 'so_folha' WHEN fo.mat_norm IS NOT NULL THEN 'ponto_folha' ELSE 'so_ponto' END AS origem
  FROM pessoas p
  LEFT JOIN fol fo ON fo.mat_norm = p.mat_norm
  LEFT JOIN rh_pessoa_complemento cp ON cp.company_id = p_company_id AND cp.excluido_em IS NULL
       AND ((cp.cpf IS NOT NULL AND cp.cpf = p.cpf) OR (cp.cpf IS NULL AND cp.matricula = p.matricula))
  LEFT JOIN prod_cargo_vinculo vc ON upper(vc.chave) = upper(p.funcao) AND vc.company_id = p_company_id
  LEFT JOIN prod_cargo cg ON cg.id = COALESCE(cp.cargo_id, vc.cargo_id)
  LEFT JOIN prod_setor st ON st.id = cp.setor_id
  CROSS JOIN LATERAL (SELECT COALESCE(cp.salario_base, fo.remuneracao) AS salario) sal;
END;
$function$;

-- Guarda de função (RD-30 / check-fn-guards): fn_rh_quadro_base é SECURITY DEFINER.
-- CREATE OR REPLACE preserva a ACL viva (EXECUTE só para postgres owner e service_role),
-- mas o gate estático exige a declaração explícita. Espelha a ACL viva; não amplia acesso.
REVOKE ALL ON FUNCTION public.fn_rh_quadro_base(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_base(uuid, date) TO service_role;
