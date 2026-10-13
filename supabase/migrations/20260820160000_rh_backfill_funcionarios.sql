-- Backfill RH · compliance_funcionarios a partir do ponto (Frioeste piloto, genérico).
--
-- Contexto: a ingestão de Postos (fn_rh_importar_postos) casa Nome→CPF (ind_ponto_colaborador)
-- e depois CPF→compliance_funcionarios. Colaboradores que existem no PONTO com CPF válido mas
-- ainda NÃO têm cadastro em compliance_funcionarios caem na exceção 'cpf_sem_funcionario' e a
-- alocação/remuneração não é criada. Esta função cria esses funcionários faltantes a partir do
-- ponto (fonte da verdade do CPF), enriquecendo cargo/setor com a planilha onde o nome casa.
--
-- Premissas auditadas (premissa-primeiro, RD-38) — Frioeste 975365cc-9e5a-4251-9022-68c6bfde10d8:
--  • ind_ponto_colaborador: 188 linhas, TODAS com CPF de 11 dígitos; tem nome, matricula, funcao, departamento.
--  • compliance_funcionarios exige só company_id + nome_completo (NOT NULL); cpf/matricula/cargo/setor/
--    setor_id/funcao/ativo(def true)/vinculo_tipo(def 'direto') são nullable/default.
--  • Alvo = ponto c/ CPF válido SEM funcionário (match por CPF normalizado): exatamente 30, 30 CPFs
--    distintos, zero duplicado. Projeção 161 → 191. (dry-run read-only, sem tocar dado — RD-54.)
--
-- Idempotente (NOT EXISTS por CPF normalizado → re-run não duplica) e devolve antes/depois (RD-54/55).
-- Gate LGPD (carrega CPF): RH (rh_industrial) + sócio + admin. Fail-closed — igual rh_remuneracao/import.
-- Chamada AUTENTICADA (o service-role/MCP cai no gate de propósito): o CEO roda no MCP dele.

CREATE OR REPLACE FUNCTION public.fn_rh_backfill_funcionarios(
  p_company_id uuid,
  p_linhas jsonb DEFAULT '[]'::jsonb,
  p_registrado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_antes int; v_depois int; v_criados int := 0; v_com_planilha int := 0;
  v_lista jsonb;
BEGIN
  -- Gate LGPD: só RH (rh_industrial) + sócio + admin criam funcionário (CPF é dado sensível). Fail-closed.
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    p_linhas := '[]'::jsonb;
  END IF;

  SELECT count(*) INTO v_antes FROM compliance_funcionarios WHERE company_id = p_company_id;

  -- Conjunto motriz: ponto SEM funcionário, com cargo/setor enriquecidos pela planilha onde o nome casa.
  CREATE TEMP TABLE _bf ON COMMIT DROP AS
  WITH plan AS (
    SELECT lower(btrim(x->>'nome')) AS nome_key,
           NULLIF(btrim(x->>'cargo'), '')      AS cargo,
           NULLIF(btrim(x->>'setor_nome'), '') AS setor
    FROM jsonb_array_elements(p_linhas) x
    WHERE NULLIF(btrim(x->>'nome'), '') IS NOT NULL
  ),
  plan_dedup AS (
    -- 1 linha por nome; prioriza a que traz cargo (posto principal).
    SELECT DISTINCT ON (nome_key) nome_key, cargo, setor
    FROM plan ORDER BY nome_key, (cargo IS NOT NULL) DESC, (setor IS NOT NULL) DESC
  )
  SELECT
    p.company_id,
    btrim(p.nome)                                   AS nome_completo,
    regexp_replace(p.cpf, '\D', '', 'g')            AS cpf,
    NULLIF(btrim(p.matricula), '')                  AS matricula,
    NULLIF(btrim(p.funcao), '')                     AS funcao,
    COALESCE(pd.cargo, NULLIF(btrim(p.funcao), ''))       AS cargo,       -- planilha → fallback ponto.funcao
    COALESCE(pd.setor, NULLIF(btrim(p.departamento), '')) AS setor,       -- planilha → fallback ponto.departamento
    (pd.cargo IS NOT NULL OR pd.setor IS NOT NULL)  AS veio_da_planilha
  FROM ind_ponto_colaborador p
  LEFT JOIN plan_dedup pd ON pd.nome_key = lower(btrim(p.nome))
  WHERE p.company_id = p_company_id
    AND length(regexp_replace(COALESCE(p.cpf, ''), '\D', '', 'g')) = 11
    AND NOT EXISTS (
      SELECT 1 FROM compliance_funcionarios f
       WHERE f.company_id = p.company_id
         AND regexp_replace(COALESCE(f.cpf, ''), '\D', '', 'g') = regexp_replace(p.cpf, '\D', '', 'g'));

  SELECT count(*), count(*) FILTER (WHERE veio_da_planilha)
    INTO v_criados, v_com_planilha FROM _bf;

  INSERT INTO compliance_funcionarios
    (company_id, nome_completo, cpf, matricula, funcao, cargo, setor, setor_id, ativo, vinculo_tipo)
  SELECT
    b.company_id, b.nome_completo, b.cpf, b.matricula, b.funcao, b.cargo, b.setor,
    (SELECT s.id FROM compliance_setores s
      WHERE (s.company_id = b.company_id OR s.is_global = true)
        AND b.setor IS NOT NULL
        AND (lower(s.nome) = lower(b.setor) OR lower(s.slug) = lower(b.setor))
      ORDER BY (s.company_id = b.company_id) DESC LIMIT 1),
    true, 'direto'
  FROM _bf b;

  SELECT jsonb_agg(jsonb_build_object(
           'nome', b.nome_completo,
           'cpf', left(b.cpf, 3) || '***' || right(b.cpf, 2),   -- mascarado (LGPD)
           'matricula', b.matricula,
           'cargo', b.cargo, 'setor', b.setor,
           'veio_da_planilha', b.veio_da_planilha)
         ORDER BY b.nome_completo)
    INTO v_lista FROM _bf b;

  SELECT count(*) INTO v_depois FROM compliance_funcionarios WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'antes', v_antes,
    'criados', v_criados,
    'criados_com_cargo_setor_da_planilha', v_com_planilha,
    'depois', v_depois,
    'registrado_por', COALESCE(p_registrado_por, auth.uid()),
    'lista', COALESCE(v_lista, '[]'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_backfill_funcionarios(uuid, jsonb, uuid) FROM anon;
