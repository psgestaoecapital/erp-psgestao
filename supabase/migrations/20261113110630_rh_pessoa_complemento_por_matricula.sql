-- CEO 11/11 (item 3) — rh_pessoa_complemento aceitar a pessoa pela MATRÍCULA quando não houver CPF.
-- Prova RD-38: a folha da Frioeste não tem CPF; ~38 pessoas aparecem no Quadro como origem 'so_folha' (sem CPF,
-- só matrícula) e hoje NÃO têm como receber cargo/setor/supervisor — a unique é (company,cpf) e o salvar exige
-- CPF de 11 díg; o fn_rh_quadro_base casa o complemento (cp) por cpf.
--
-- Correção ADITIVA (sem mexer no caminho por CPF, RD-97):
--  1. coluna matricula (nullable) + cpf passa a aceitar NULL + unique parcial (company,matricula) p/ cpf nulo;
--  2. fn_rh_pessoa_complemento_salvar: se não vier CPF válido mas vier matrícula, grava pela matrícula (cpf NULL);
--  3. fn_rh_pessoa_complemento_lote: repassa a matrícula;
--  4. fn_rh_quadro_base: casa cp por cpf OU (cpf nulo E matrícula) — mesmo corpo, mantém #variable_conflict.
-- Nada destrutivo; não altera dado de cliente existente.

-- 1) schema aditivo
ALTER TABLE public.rh_pessoa_complemento ADD COLUMN IF NOT EXISTS matricula text;
ALTER TABLE public.rh_pessoa_complemento ALTER COLUMN cpf DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rh_pessoa_complemento_mat_uni
  ON public.rh_pessoa_complemento (company_id, matricula)
  WHERE matricula IS NOT NULL AND excluido_em IS NULL;

-- 2) salvar por CPF (como antes) OU por matrícula (quando não há CPF válido)
CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_salvar(p_company_id uuid, p_cpf text, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cpf text; v_mat text; v_id uuid; v_cargo uuid; v_setor uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;
  v_cpf := regexp_replace(COALESCE(p_cpf,''), '\D', '', 'g');
  v_mat := NULLIF(btrim(COALESCE(p_dados->>'matricula','')), '');
  v_cargo := NULLIF(p_dados->>'cargo_id','')::uuid;
  v_setor := NULLIF(p_dados->>'setor_id','')::uuid;

  IF length(v_cpf) = 11 THEN
    -- caminho por CPF (inalterado; grava a matrícula junto quando vier)
    INSERT INTO rh_pessoa_complemento (company_id, cpf, matricula, cargo_id, setor_id, supervisor_nome, salario_base, observacao, criado_por, atualizado_por)
    VALUES (p_company_id, v_cpf, v_mat, v_cargo, v_setor,
            NULLIF(p_dados->>'supervisor_nome',''), NULLIF(p_dados->>'salario_base','')::numeric,
            NULLIF(p_dados->>'observacao',''), auth.uid(), auth.uid())
    ON CONFLICT (company_id, cpf) WHERE excluido_em IS NULL
    DO UPDATE SET
        matricula = COALESCE(EXCLUDED.matricula, rh_pessoa_complemento.matricula),
        cargo_id = COALESCE(EXCLUDED.cargo_id, rh_pessoa_complemento.cargo_id),
        setor_id = COALESCE(EXCLUDED.setor_id, rh_pessoa_complemento.setor_id),
        supervisor_nome = COALESCE(EXCLUDED.supervisor_nome, rh_pessoa_complemento.supervisor_nome),
        salario_base = COALESCE(EXCLUDED.salario_base, rh_pessoa_complemento.salario_base),
        observacao = COALESCE(EXCLUDED.observacao, rh_pessoa_complemento.observacao),
        atualizado_em = now(), atualizado_por = auth.uid()
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'cpf', v_cpf);
  ELSIF v_mat IS NOT NULL THEN
    -- caminho por MATRÍCULA (cpf nulo) — para quem só está na folha
    INSERT INTO rh_pessoa_complemento (company_id, cpf, matricula, cargo_id, setor_id, supervisor_nome, salario_base, observacao, criado_por, atualizado_por)
    VALUES (p_company_id, NULL, v_mat, v_cargo, v_setor,
            NULLIF(p_dados->>'supervisor_nome',''), NULLIF(p_dados->>'salario_base','')::numeric,
            NULLIF(p_dados->>'observacao',''), auth.uid(), auth.uid())
    ON CONFLICT (company_id, matricula) WHERE matricula IS NOT NULL AND excluido_em IS NULL
    DO UPDATE SET
        cargo_id = COALESCE(EXCLUDED.cargo_id, rh_pessoa_complemento.cargo_id),
        setor_id = COALESCE(EXCLUDED.setor_id, rh_pessoa_complemento.setor_id),
        supervisor_nome = COALESCE(EXCLUDED.supervisor_nome, rh_pessoa_complemento.supervisor_nome),
        salario_base = COALESCE(EXCLUDED.salario_base, rh_pessoa_complemento.salario_base),
        observacao = COALESCE(EXCLUDED.observacao, rh_pessoa_complemento.observacao),
        atualizado_em = now(), atualizado_por = auth.uid()
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'matricula', v_mat);
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'cpf_invalido');
  END IF;
END;
$function$;

-- 3) lote: repassa a matrícula (resto inalterado)
CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_lote(p_company_id uuid, p_linhas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l jsonb; v_res jsonb; v_ok int := 0; v_rej jsonb := '[]'::jsonb;
        v_dados jsonb; v_cargo uuid; v_setor uuid; v_motivo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas,'[]'::jsonb)) LOOP
    v_motivo := NULL; v_cargo := NULL; v_setor := NULL;
    IF NULLIF(l->>'cargo_id','') IS NOT NULL THEN v_cargo := (l->>'cargo_id')::uuid;
    ELSIF NULLIF(l->>'cargo_nome','') IS NOT NULL THEN
      SELECT id INTO v_cargo FROM prod_cargo WHERE company_id = p_company_id AND lower(nome) = lower(l->>'cargo_nome') AND ativo LIMIT 1;
      IF v_cargo IS NULL THEN v_motivo := 'cargo não encontrado: ' || (l->>'cargo_nome'); END IF;
    END IF;
    IF v_motivo IS NULL AND NULLIF(l->>'setor_id','') IS NOT NULL THEN v_setor := (l->>'setor_id')::uuid;
    ELSIF v_motivo IS NULL AND NULLIF(l->>'setor_nome','') IS NOT NULL THEN
      SELECT id INTO v_setor FROM prod_setor WHERE company_id = p_company_id AND lower(nome) = lower(l->>'setor_nome') AND ativo LIMIT 1;
      IF v_setor IS NULL THEN v_motivo := 'setor não encontrado: ' || (l->>'setor_nome'); END IF;
    END IF;
    IF v_motivo IS NOT NULL THEN
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('linha', l, 'motivo', v_motivo)); CONTINUE;
    END IF;
    v_dados := jsonb_strip_nulls(jsonb_build_object(
      'cargo_id', v_cargo, 'setor_id', v_setor,
      'matricula', NULLIF(l->>'matricula',''),
      'supervisor_nome', NULLIF(l->>'supervisor_nome',''),
      'salario_base', NULLIF(l->>'salario_base',''),
      'observacao', NULLIF(l->>'observacao','')));
    v_res := fn_rh_pessoa_complemento_salvar(p_company_id, l->>'cpf', v_dados);
    IF (v_res->>'ok')::boolean THEN v_ok := v_ok + 1;
    ELSE v_rej := v_rej || jsonb_build_array(jsonb_build_object('linha', l, 'motivo', v_res->>'erro')); END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'gravadas', v_ok, 'rejeitadas', v_rej);
END;
$function$;

-- 4) fn_rh_quadro_base: casa cp por cpf OU (cpf nulo E matrícula). Mesmo corpo, mantém #variable_conflict.
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_base(p_company_id uuid, p_competencia date DEFAULT NULL::date)
 RETURNS TABLE(cpf text, matricula text, nome text, funcao text, cargo_id uuid, cargo_nome text, setor_id uuid, setor_nome text, supervisor text, salario numeric, custo_mensal numeric, custo_hora numeric, origem text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
REVOKE ALL ON FUNCTION public.fn_rh_quadro_base(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_base(uuid, date) TO service_role;
