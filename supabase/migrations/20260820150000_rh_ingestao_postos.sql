-- Ingestão RH · Postos de Trabalho — carga da planilha (Frioeste piloto, genérico).
-- Recebe as linhas JÁ EXTRAÍDAS/VALIDADAS (jsonb) e popula posto/alocação/remuneração + baseline.
-- Match EXATO Nome→CPF (ind_ponto_colaborador → compliance_funcionarios). Não-casados → exceções.
-- RD-54/55: idempotente (não duplica em re-run) e devolve contagem antes/depois + exceções.
--
-- Forma de cada linha em p_linhas (o extrator da planilha mapeia as colunas → estas chaves):
--   codigo_po, setor_nome, centro_custo, categoria_produto, tipo, atividade, supervisao,
--   qtd_proj_t1, qtd_proj_t2, qtd_proj_t3, qtd_proj_total, cargo, custo_projetado (jsonb opcional),
--   nome, funcao_real, qtd_real,
--   salario_base, insalubridade, vale, outros, encargos_valor   (encargos_valor = valor R$ da planilha)

-- ── Tabela de exceções (não-casados). Carrega a linha inteira (com salário) → LGPD (RH-only). ──
CREATE TABLE IF NOT EXISTS public.rh_importacao_excecao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome       text,
  codigo_po  text,
  motivo     text NOT NULL,                       -- nome_nao_casou_ponto | cpf_sem_funcionario
  dados      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- linha crua (inclui salário) → sensível
  resolvido  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_rh_exc_company ON public.rh_importacao_excecao(company_id);
ALTER TABLE public.rh_importacao_excecao ENABLE ROW LEVEL SECURITY;
-- Mesmo gate do rh_remuneracao (dados carregam salário): RH (rh_industrial) + sócio + admin.
DROP POLICY IF EXISTS rh_exc_rh_only ON public.rh_importacao_excecao;
CREATE POLICY rh_exc_rh_only ON public.rh_importacao_excecao FOR ALL
  USING (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
    WHERE uc.company_id = rh_importacao_excecao.company_id AND uc.user_id = auth.uid()
      AND uc.role IN ('rh_industrial','socio')))
  WITH CHECK (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
    WHERE uc.company_id = rh_importacao_excecao.company_id AND uc.user_id = auth.uid()
      AND uc.role IN ('rh_industrial','socio')));
REVOKE ALL ON public.rh_importacao_excecao FROM anon;

-- ── Função de ingestão ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rh_importar_postos(
  p_company_id uuid,
  p_linhas jsonb,
  p_registrado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l jsonb; v_reg uuid := COALESCE(p_registrado_por, auth.uid());
  v_codigo text; v_setor_in text; v_setor_id uuid; v_posto_id uuid;
  v_nome text; v_vaga boolean; v_cpf text; v_func_id uuid;
  v_base numeric; v_insal numeric; v_vale numeric; v_outros numeric; v_enc_val numeric; v_pct numeric;
  v_aloc_id uuid; v_remun_id uuid;
  n_posto int := 0; n_aloc int := 0; n_remun int := 0; n_exc int := 0; n_vaga int := 0; n_skip int := 0;
  v_sum_base numeric := 0; v_sum_exc numeric := 0;
  v_ant_posto int; v_ant_aloc int; v_ant_remun int;
BEGIN
  -- Gate: só RH (rh_industrial) + sócio + admin rodam a carga (consistente com o LGPD do rh_remuneracao).
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'p_linhas_deve_ser_array');
  END IF;

  SELECT count(*) INTO v_ant_posto FROM rh_posto_trabalho WHERE company_id = p_company_id;
  SELECT count(*) INTO v_ant_aloc  FROM rh_alocacao       WHERE company_id = p_company_id;
  SELECT count(*) INTO v_ant_remun FROM rh_remuneracao    WHERE company_id = p_company_id;

  FOR l IN SELECT jsonb_array_elements(p_linhas) LOOP
    v_codigo  := NULLIF(btrim(l->>'codigo_po'), '');
    v_setor_in := NULLIF(btrim(l->>'setor_nome'), '');
    v_nome    := NULLIF(btrim(l->>'nome'), '');
    v_vaga    := (v_nome IS NULL OR upper(v_nome) LIKE '%VAGA%');

    -- Setor: por nome OU slug (empresa ou global). Não achou → null (posto ainda entra).
    v_setor_id := NULL;
    IF v_setor_in IS NOT NULL THEN
      SELECT id INTO v_setor_id FROM compliance_setores
       WHERE (company_id = p_company_id OR is_global = true)
         AND (lower(nome) = lower(v_setor_in) OR lower(slug) = lower(v_setor_in))
       ORDER BY (company_id = p_company_id) DESC LIMIT 1;
    END IF;

    -- Posto (idempotente por codigo_po quando houver; senão sempre cria).
    v_posto_id := NULL;
    IF v_codigo IS NOT NULL THEN
      SELECT id INTO v_posto_id FROM rh_posto_trabalho WHERE company_id = p_company_id AND codigo_po = v_codigo LIMIT 1;
    END IF;
    IF v_posto_id IS NULL THEN
      INSERT INTO rh_posto_trabalho (company_id, codigo_po, setor_id, centro_custo, categoria_produto, tipo,
        atividade, supervisao, qtd_proj_t1, qtd_proj_t2, qtd_proj_t3, qtd_proj_total, cargo, custo_projetado, created_by)
      VALUES (p_company_id, v_codigo, v_setor_id, NULLIF(btrim(l->>'centro_custo'),''), NULLIF(btrim(l->>'categoria_produto'),''),
        NULLIF(btrim(l->>'tipo'),''), NULLIF(btrim(l->>'atividade'),''), NULLIF(btrim(l->>'supervisao'),''),
        COALESCE((l->>'qtd_proj_t1')::int,0), COALESCE((l->>'qtd_proj_t2')::int,0), COALESCE((l->>'qtd_proj_t3')::int,0),
        COALESCE((l->>'qtd_proj_total')::int,0), NULLIF(btrim(l->>'cargo'),''),
        COALESCE(l->'custo_projetado', '{}'::jsonb), v_reg)
      RETURNING id INTO v_posto_id;
      n_posto := n_posto + 1;
    END IF;

    IF v_vaga THEN n_vaga := n_vaga + 1; CONTINUE; END IF;

    -- Match EXATO Nome→CPF (ponto) → funcionário por CPF.
    v_cpf := NULL; v_func_id := NULL;
    SELECT cpf INTO v_cpf FROM ind_ponto_colaborador
     WHERE company_id = p_company_id AND lower(btrim(nome)) = lower(v_nome) LIMIT 1;
    IF v_cpf IS NOT NULL THEN
      SELECT id INTO v_func_id FROM compliance_funcionarios
       WHERE company_id = p_company_id
         AND regexp_replace(COALESCE(cpf,''),'\D','','g') = regexp_replace(v_cpf,'\D','','g')
       ORDER BY (ativo IS TRUE) DESC LIMIT 1;
    END IF;

    v_base   := COALESCE((l->>'salario_base')::numeric, 0);
    v_insal  := COALESCE((l->>'insalubridade')::numeric, 0);
    v_vale   := COALESCE((l->>'vale')::numeric, 0);
    v_outros := COALESCE((l->>'outros')::numeric, 0);
    v_enc_val := COALESCE((l->>'encargos_valor')::numeric, 0);

    IF v_func_id IS NULL THEN
      -- Não-casado: vai pra exceções (idempotente por nome+codigo). Salário fica na exceção p/ conciliar.
      IF NOT EXISTS (SELECT 1 FROM rh_importacao_excecao WHERE company_id = p_company_id
                       AND COALESCE(nome,'') = COALESCE(v_nome,'') AND COALESCE(codigo_po,'') = COALESCE(v_codigo,'')) THEN
        INSERT INTO rh_importacao_excecao (company_id, nome, codigo_po, motivo, dados, created_by)
        VALUES (p_company_id, v_nome, v_codigo, CASE WHEN v_cpf IS NULL THEN 'nome_nao_casou_ponto' ELSE 'cpf_sem_funcionario' END, l, v_reg);
        n_exc := n_exc + 1; v_sum_exc := v_sum_exc + v_base;
      END IF;
      CONTINUE;
    END IF;

    -- Casado: alocação (idempotente por posto+funcionário).
    IF EXISTS (SELECT 1 FROM rh_alocacao WHERE posto_id = v_posto_id AND funcionario_id = v_func_id) THEN
      n_skip := n_skip + 1; CONTINUE;
    END IF;
    INSERT INTO rh_alocacao (company_id, posto_id, funcionario_id, funcao_real, qtd_real, turno, ativo, created_by)
    VALUES (p_company_id, v_posto_id, v_func_id, NULLIF(btrim(l->>'funcao_real'),''), COALESCE((l->>'qtd_real')::int,1), 'T1', true, v_reg)
    RETURNING id INTO v_aloc_id;
    n_aloc := n_aloc + 1;

    v_remun_id := NULL;
    IF (v_base + v_insal + v_vale + v_outros + v_enc_val) > 0 THEN
      -- encargos_pct por linha contra a MESMA base do GENERATED (base+insal) → reproduz o R$ TOTAL.
      v_pct := CASE WHEN (v_base + v_insal) > 0 THEN round(v_enc_val / (v_base + v_insal) * 100, 4) ELSE 0 END;
      INSERT INTO rh_remuneracao (company_id, alocacao_id, salario_base, insalubridade, vale, outros, encargos_pct, created_by)
      VALUES (p_company_id, v_aloc_id, v_base, v_insal, v_vale, v_outros, v_pct, v_reg)
      RETURNING id INTO v_remun_id;
      n_remun := n_remun + 1; v_sum_base := v_sum_base + v_base;
    END IF;

    -- Baseline do histórico.
    INSERT INTO rh_movimentacao (company_id, alocacao_id, remuneracao_id, tipo, motivo, dados, registrado_por)
    VALUES (p_company_id, v_aloc_id, v_remun_id, 'importacao_inicial', 'carga planilha 20/08', l, v_reg);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'antes',  jsonb_build_object('postos', v_ant_posto, 'alocacoes', v_ant_aloc, 'remuneracoes', v_ant_remun),
    'criados', jsonb_build_object('postos', n_posto, 'vagas', n_vaga, 'alocacoes', n_aloc, 'remuneracoes', n_remun,
                                  'excecoes', n_exc, 'ja_existiam', n_skip),
    'depois', jsonb_build_object(
      'postos',      (SELECT count(*) FROM rh_posto_trabalho WHERE company_id = p_company_id),
      'alocacoes',   (SELECT count(*) FROM rh_alocacao       WHERE company_id = p_company_id),
      'remuneracoes',(SELECT count(*) FROM rh_remuneracao    WHERE company_id = p_company_id)),
    'soma_base_importada', v_sum_base,
    'soma_base_excecoes',  v_sum_exc,
    'soma_base_total',     v_sum_base + v_sum_exc
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_importar_postos(uuid, jsonb, uuid) FROM anon;
