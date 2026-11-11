-- HOTFIX 2 (Eng. Chefe 11/11, contexto 5472135d) — Quadro de pessoal QUEBRADO em produção.
-- Sintoma (prova do Eng. Chefe chamando COMO USUÁRIO): fn_rh_quadro_pessoas -> fn_rh_quadro_base falha com
-- 42702 "column reference \"cpf\" is ambiguous". Quebra também fn_rh_custo_por, fn_rh_custo_hora_cargo e
-- fn_prod_posto_custo_hora_cargo (herdam a base — RD-71).
--
-- Causa: fn_rh_quadro_base é RETURNS TABLE(cpf, matricula, nome, funcao, ...). Em plpgsql os nomes das colunas
-- de saída viram VARIÁVEIS; a CTE `pto` referencia esses nomes SEM qualificar
-- (SELECT DISTINCT ON (cpf) cpf, btrim(matricula) ..., nome, funcao ... ORDER BY cpf), colidindo variável×coluna.
-- O corpo foi provado antes como SELECT avulso (fora do escopo de variável do plpgsql), por isso o 42702 passou
-- despercebido — a prova agora é COMO USUÁRIO, pela função (RD-82).
--
-- Correção MÍNIMA (diff só nesta função): CREATE OR REPLACE com a MESMA assinatura e o MESMO corpo da
-- 20261113100500, acrescentando como PRIMEIRA linha do corpo a diretiva `#variable_conflict use_column`, que
-- resolve qualquer nome ambíguo para a COLUNA (é exatamente o que a CTE `pto` quer). As variáveis locais
-- (v_enc/v_horas/v_fonte/v_comp) não colidem com nada. Varredura (RD-71): entre todas as funções fn_rh_*/
-- fn_prod_posto*custo*, só fn_rh_quadro_base é RETURNS TABLE — as demais retornam jsonb/numeric com refs
-- qualificadas e variáveis v_*; só quebram por CHAMAR a base, então consertam-se com este fix. Aditivo, nada
-- destrutivo, não altera dado de cliente.

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
  WITH pto AS (  -- ponto: 1 por CPF; matrícula normalizada (texto, sem zeros à esquerda)
    SELECT DISTINCT ON (cpf) cpf, btrim(matricula) AS matricula,
           regexp_replace(btrim(coalesce(matricula,'')),'^0+','') AS mat_norm,
           nome, funcao, departamento
    FROM ind_ponto_colaborador WHERE company_id = p_company_id AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ),
  fol AS (  -- folha agregada por MATRÍCULA (a da Frioeste não tem CPF). matricula é integer -> texto.
    SELECT (f.matricula)::text AS mat_norm, max(f.cpf) AS cpf, max(f.nome) AS nome,
           sum(f.total_geral) AS total_geral, sum(f.remuneracao) AS remuneracao
    FROM folha_competencia f
    WHERE f.company_id = p_company_id AND f.competencia = v_comp AND f.matricula IS NOT NULL
    GROUP BY (f.matricula)::text
  ),
  pessoas AS (  -- ponto (todas) + folha-only (matrícula da folha sem ponto correspondente) — RD-51
    SELECT pt.cpf, pt.matricula, pt.mat_norm, pt.nome, pt.funcao, pt.departamento, 'ponto'::text AS fonte
      FROM pto pt
    UNION ALL
    SELECT fo.cpf, fo.mat_norm AS matricula, fo.mat_norm, fo.nome, NULL::text, NULL::text, 'so_folha'::text
      FROM fol fo WHERE NOT EXISTS (SELECT 1 FROM pto pt WHERE pt.mat_norm = fo.mat_norm)
  )
  SELECT
    p.cpf,
    p.matricula,
    COALESCE(p.nome, fo.nome) AS nome,
    p.funcao,
    COALESCE(cp.cargo_id, vc.cargo_id) AS cargo_id,
    cg.nome AS cargo_nome,
    cp.setor_id,
    COALESCE(st.nome, p.departamento) AS setor_nome,
    cp.supervisor_nome AS supervisor,
    sal.salario,
    CASE WHEN v_fonte = 'folha_total'
         THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0))
         ELSE sal.salario * (1 + v_enc/100.0) END AS custo_mensal,
    (CASE WHEN v_fonte = 'folha_total'
          THEN COALESCE(fo.total_geral, sal.salario * (1 + v_enc/100.0))
          ELSE sal.salario * (1 + v_enc/100.0) END) / NULLIF(v_horas,0) AS custo_hora,
    CASE WHEN p.fonte = 'so_folha' THEN 'so_folha'
         WHEN fo.mat_norm IS NOT NULL THEN 'ponto_folha' ELSE 'so_ponto' END AS origem
  FROM pessoas p
  LEFT JOIN fol fo ON fo.mat_norm = p.mat_norm
  LEFT JOIN rh_pessoa_complemento cp ON cp.company_id = p_company_id AND cp.cpf = p.cpf AND cp.excluido_em IS NULL
  LEFT JOIN prod_cargo_vinculo vc ON upper(vc.chave) = upper(p.funcao) AND vc.company_id = p_company_id
  LEFT JOIN prod_cargo cg ON cg.id = COALESCE(cp.cargo_id, vc.cargo_id)
  LEFT JOIN prod_setor st ON st.id = cp.setor_id
  CROSS JOIN LATERAL (SELECT COALESCE(cp.salario_base, fo.remuneracao) AS salario) sal;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_rh_quadro_base(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_base(uuid, date) TO service_role;
