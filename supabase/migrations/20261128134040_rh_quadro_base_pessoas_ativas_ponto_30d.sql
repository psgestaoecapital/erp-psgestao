-- ============================================================================================
-- RH PR 3 · ITEM 1 — "Pessoas no custo" = funcionários ATIVOS com marcação de ponto nos últimos 30 dias
-- ============================================================================================
-- Achado do auditor (indústria/RH, aba "Quadro de pessoal" e Painel de RH › Custo): o Quadro contava
-- TODO colaborador que já apareceu no ponto (ind_ponto_colaborador), incluindo DESLIGADOS / histórico, e
-- o número não batia com a folha corrente. Prova na empresa REAL (frigorífico piloto 975365cc, só leitura,
-- BEGIN…ROLLBACK, statement_timeout curto):
--   • pto_all (lógica antiga, distinct cpf no ind_ponto_colaborador, fora harness e2e) ........... 241
--   • fonte do ponto: distinct cpf com marcação em ind_ponto_dia nos últimos 30 dias .............. 159
--   • quadro ponto-ativo (241 ∩ ativos, via cadastro de colaborador) ............................. 155
--   • folha-só (matrículas na folha 2026-10 sem colaborador de ponto) ............................. +14
--   • TOTAL novo do quadro (ponto-ativo + folha-só) .............................................. 169
--   • folha 2026-10 (linhas com matrícula) = 165  → 169 ≈ 165 confirma que os ~76 removidos eram
--     desligados/histórico, não a força de trabalho corrente.
--
-- Correção (ADITIVA, mesmo contrato — mesmas colunas de retorno): o ramo que vem do PONTO passa a contar só
-- quem tem marcação de ponto nos últimos 30 dias. O anti-join da folha continua sobre o ponto COMPLETO (o
-- desligado que ainda está no ind_ponto_colaborador NÃO reaparece como "só folha"). Empresas SEM ponto (só
-- folha) e empresas com ponto porém SEM nenhuma marcação recente (sincronização parada) ficam INTACTAS:
-- o filtro só vale quando a empresa tem atividade de ponto nos últimos 30 dias (v_tem_ativo_recente), para
-- nunca esvaziar a tela por falta de dado recente.
--
-- Mantém tudo que a 20261127162430 (um número de encargo), 20261115171545 (exclui harness e2e),
-- 20261113110630/110230/100500/090000 e 20261114234545 estabeleceram: v_enc por fn_mao_obra_encargos_vigentes,
-- casamento por matrícula normalizada, setor = departamento do ponto (COALESCE), #variable_conflict use_column.
-- RD-98 preservado. Núcleo sensível (CREATE OR REPLACE de função) → revisao-eng-chefe.

CREATE OR REPLACE FUNCTION public.fn_rh_quadro_base(p_company_id uuid, p_competencia date DEFAULT NULL::date)
 RETURNS TABLE(cpf text, matricula text, nome text, funcao text, cargo_id uuid, cargo_nome text, setor_id uuid, setor_nome text, supervisor text, salario numeric, custo_mensal numeric, custo_hora numeric, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_enc numeric; v_horas numeric; v_fonte text; v_comp date; v_tem_ativo_recente boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  SELECT COALESCE(pc.encargos_pct,38.35), COALESCE(pc.horas_mes,220), COALESCE(pc.fonte_custo,'folha_total')
    INTO v_enc, v_horas, v_fonte
    FROM (SELECT 1) z LEFT JOIN rh_parametro_custo pc ON pc.company_id = p_company_id;
  v_enc := COALESCE((fn_mao_obra_encargos_vigentes(p_company_id) ->> 'encargos_folha_pct')::numeric, 38.35); v_horas := COALESCE(v_horas,220); v_fonte := COALESCE(v_fonte,'folha_total');
  v_comp := COALESCE(p_competencia, (SELECT max(f.competencia) FROM folha_competencia f WHERE f.company_id = p_company_id));
  -- ITEM 1: a empresa tem marcação de ponto nos últimos 30 dias? Só então restringimos o ramo do ponto a
  -- quem está ATIVO (evita esvaziar a tela de empresa sem ponto ou com sincronização parada).
  v_tem_ativo_recente := EXISTS (
    SELECT 1 FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data >= current_date - 30
      AND d.cpf IS NOT NULL AND d.cpf !~* '^(e2e|exe)' );
  RETURN QUERY
  WITH pto AS (
    SELECT DISTINCT ON (cpf) cpf, btrim(matricula) AS matricula,
           regexp_replace(btrim(coalesce(matricula,'')),'^0+','') AS mat_norm, nome, funcao, departamento
    FROM ind_ponto_colaborador WHERE company_id = p_company_id AND cpf IS NOT NULL
      -- gap 2: fora as contas do harness e2e (cpf nao-numerico marcado 'E2E'/'EXE'); CPF real nunca comeca por letra
      AND cpf !~* '^(e2e|exe)'
    ORDER BY cpf, created_at DESC NULLS LAST ),
  -- ITEM 1: quem tem marcação de ponto nos últimos 30 dias (funcionário ativo).
  ativos AS (
    SELECT DISTINCT d.cpf AS cpf FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data >= current_date - 30
      AND d.cpf IS NOT NULL AND d.cpf !~* '^(e2e|exe)' ),
  fol AS (
    SELECT (f.matricula)::text AS mat_norm, max(f.cpf) AS cpf, max(f.nome) AS nome,
           sum(f.total_geral) AS total_geral, sum(f.remuneracao) AS remuneracao
    FROM folha_competencia f
    WHERE f.company_id = p_company_id AND f.competencia = v_comp AND f.matricula IS NOT NULL
    GROUP BY (f.matricula)::text ),
  pessoas AS (
    -- Ramo do PONTO: só funcionários ativos (ponto <=30d), quando a empresa tem atividade recente.
    SELECT pt.cpf, pt.matricula, pt.mat_norm, pt.nome, pt.funcao, pt.departamento, 'ponto'::text AS fonte
      FROM pto pt
     WHERE NOT v_tem_ativo_recente OR pt.cpf IN (SELECT cpf FROM ativos)
    UNION ALL
    -- Ramo da FOLHA: matrícula paga que nunca apareceu no ponto (anti-join sobre o ponto COMPLETO, para o
    -- desligado que ainda consta no ind_ponto_colaborador não voltar por aqui).
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

-- Porta fechada: SECURITY DEFINER lê folha/ponto (dado sensível de pessoa). CREATE OR REPLACE preserva os grants,
-- mas reafirmamos o contrato — nunca anon; só usuário logado (a guarda get_user_company_ids()/is_admin() dentro
-- da função ainda escopa por empresa) e service_role (fn_demo_reset / rotinas).
REVOKE ALL ON FUNCTION public.fn_rh_quadro_base(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_base(uuid, date) TO authenticated, service_role;
