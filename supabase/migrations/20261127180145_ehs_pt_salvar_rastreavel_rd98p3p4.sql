-- PS EHS · M11 Permissão de Trabalho (/dashboard/ehs/trabalhos-risco/permissoes) — RD-98 p3/p4.
-- Fecha o mesmo gap sistêmico que o #5988 (fn_epi_excluir) eliminou nas telas irmãs
-- (aprovações/incidentes/DDS/mudanças/inspeções/brigada), que ficou de fora na PT (M11):
--   * p4 — a tela editava a PT apagando FISICAMENTE as medidas de controle
--     (`ehs_pt_medida.delete().eq('pt_id', ...)`) e re-inserindo. A medida de controle é a PROVA
--     de que o risco foi tratado; apagá-la a cada edição perde o rastro. Agora medida removida vira
--     SOFT-DELETE (ativo=false + excluido_em/por), nunca DELETE físico.
--   * p3 — as escritas da PT iam direto na tabela pelo cliente, sem RPC com guarda. Duas RPCs
--     SECURITY DEFINER com guarda por empresa (get_user_company_ids() OR is_admin()) e rastro em
--     audit_log_global passam a ser a única via; system_screens registra a origem do dado.
-- ADITIVA e idempotente: ADD COLUMN IF NOT EXISTS (rastro), CREATE OR REPLACE das funções, UPDATE do
-- registro de system_screens. Sem DROP/TRUNCATE, sem UPDATE em massa, sem tocar dado de cliente real.
-- RLS das tabelas INALTERADA. Code: desenvolvedor_5_g

-- 1) Rastro de exclusão nas duas tabelas (soft-delete continua por ativo=false) ───────────────────────
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) fn_ehs_pt_salvar — cria/atualiza a PT + medidas com SOFT-DELETE das removidas (p4) ───────────────
--    p_pt_id NULL = nova PT (usa p_company_id); preenchido = edição (empresa vem da PT existente).
--    p_dados: numero,tipo,titulo,descricao,local,setor,data_inicio,data_fim,responsavel_emissao,
--             executantes,status,observacoes.
--    p_medidas: array [{id?:uuid, descricao:text, atendido:bool, ordem:int}].
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_pt_id      uuid,
  p_company_id uuid,
  p_dados      jsonb,
  p_medidas    jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_company   uuid;
  v_pt_id     uuid := p_pt_id;
  v_novo      boolean := (p_pt_id IS NULL);
  v_titulo    text := trim(coalesce(p_dados->>'titulo',''));
  v_tipo      text := coalesce(nullif(trim(p_dados->>'tipo'),''),'geral');
  v_status    text := coalesce(nullif(trim(p_dados->>'status'),''),'rascunho');
  v_di        timestamptz := nullif(p_dados->>'data_inicio','')::timestamptz;
  v_df        timestamptz := nullif(p_dados->>'data_fim','')::timestamptz;
  v_salvas    int := 0;
  v_novas     int := 0;
  v_removidas int := 0;
  v_ids       uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Faça login para salvar a permissão de trabalho.');
  END IF;

  -- resolve a empresa: edição usa a da PT existente; nova usa o parâmetro
  IF v_novo THEN
    v_company := p_company_id;
  ELSE
    SELECT company_id INTO v_company FROM ehs_permissao_trabalho WHERE id = p_pt_id;
    IF v_company IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Permissão de trabalho não encontrada.');
    END IF;
  END IF;

  -- guarda por empresa (mesma regra da RLS / do #5988)
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.');
  END IF;

  IF v_titulo = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe a tarefa (título) da permissão de trabalho.');
  END IF;
  IF v_tipo NOT IN ('altura','espaco_confinado','eletricidade','inflamaveis','trabalho_quente','icamento','escavacao','geral') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de trabalho inválido.');
  END IF;
  IF v_status NOT IN ('rascunho','emitida','em_andamento','encerrada','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Situação inválida.');
  END IF;
  IF v_di IS NOT NULL AND v_df IS NOT NULL AND v_df < v_di THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O fim da validade não pode ser antes do início.');
  END IF;

  IF v_novo THEN
    INSERT INTO ehs_permissao_trabalho
      (company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
       responsavel_emissao, executantes, status, observacoes, criado_por)
    VALUES
      (v_company, nullif(trim(p_dados->>'numero'),''), v_tipo, v_titulo,
       nullif(trim(p_dados->>'descricao'),''), nullif(trim(p_dados->>'local'),''),
       nullif(trim(p_dados->>'setor'),''), v_di, v_df,
       nullif(trim(p_dados->>'responsavel_emissao'),''), nullif(trim(p_dados->>'executantes'),''),
       v_status, nullif(trim(p_dados->>'observacoes'),''), v_uid)
    RETURNING id INTO v_pt_id;
  ELSE
    UPDATE ehs_permissao_trabalho SET
      numero = nullif(trim(p_dados->>'numero'),''),
      tipo = v_tipo,
      titulo = v_titulo,
      descricao = nullif(trim(p_dados->>'descricao'),''),
      local = nullif(trim(p_dados->>'local'),''),
      setor = nullif(trim(p_dados->>'setor'),''),
      data_inicio = v_di,
      data_fim = v_df,
      responsavel_emissao = nullif(trim(p_dados->>'responsavel_emissao'),''),
      executantes = nullif(trim(p_dados->>'executantes'),''),
      status = v_status,
      observacoes = nullif(trim(p_dados->>'observacoes'),''),
      atualizado_em = now()
    WHERE id = v_pt_id;
  END IF;

  -- medidas recebidas (só com descrição)
  CREATE TEMP TABLE _med_in ON COMMIT DROP AS
  SELECT
    nullif(trim(elem->>'id'),'')::uuid                          AS id,
    trim(elem->>'descricao')                                    AS descricao,
    coalesce((elem->>'atendido')::boolean, false)               AS atendido,
    coalesce(nullif(elem->>'ordem','')::int, rn::int)           AS ordem
  FROM jsonb_array_elements(coalesce(p_medidas,'[]'::jsonb)) WITH ORDINALITY AS t(elem, rn)
  WHERE trim(coalesce(elem->>'descricao','')) <> '';

  -- UPDATE das existentes (reativa se estava soft-deletada)
  UPDATE ehs_pt_medida m SET
    descricao = i.descricao, atendido = i.atendido, ordem = i.ordem,
    ativo = true, excluido_em = NULL, excluido_por = NULL
  FROM _med_in i
  WHERE m.id = i.id AND m.pt_id = v_pt_id;

  -- SOFT-DELETE das removidas (p4: nunca DELETE físico) — ANTES do INSERT, para não
  -- apanhar as medidas novas (que ainda não têm id no conjunto recebido).
  SELECT array_agg(id) INTO v_ids FROM _med_in WHERE id IS NOT NULL;
  UPDATE ehs_pt_medida SET ativo = false, excluido_em = now(), excluido_por = v_uid
  WHERE pt_id = v_pt_id AND ativo = true
    AND (v_ids IS NULL OR id <> ALL (v_ids));
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  -- INSERT das novas (sem id)
  INSERT INTO ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
  SELECT v_company, v_pt_id, i.ordem, i.descricao, i.atendido
  FROM _med_in i WHERE i.id IS NULL;
  GET DIAGNOSTICS v_novas = ROW_COUNT;

  SELECT count(*) INTO v_salvas FROM ehs_pt_medida WHERE pt_id = v_pt_id AND ativo = true;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_pt_id::text,
          CASE WHEN v_novo THEN 'ehs_pt_criar' ELSE 'ehs_pt_salvar' END,
          jsonb_build_object('novo', v_novo),
          jsonb_build_object('titulo', v_titulo, 'status', v_status,
                             'medidas_ativas', v_salvas, 'medidas_novas', v_novas,
                             'medidas_removidas', v_removidas));

  RETURN jsonb_build_object('ok', true, 'pt_id', v_pt_id, 'novo', v_novo,
                            'medidas_salvas', v_salvas, 'medidas_novas', v_novas,
                            'medidas_removidas', v_removidas);
END $function$;

-- 3) fn_ehs_pt_desativar — soft-delete rastreável da PT (exige motivo) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(
  p_id     uuid,
  p_motivo text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_titulo  text;
  v_obs     text;
  v_motivo  text := trim(coalesce(p_motivo,''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Faça login para desativar a permissão de trabalho.');
  END IF;
  IF v_motivo = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar (fica registrado).');
  END IF;

  SELECT company_id, titulo, observacoes INTO v_company, v_titulo, v_obs
  FROM ehs_permissao_trabalho WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Permissão de trabalho não encontrada.');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.');
  END IF;

  UPDATE ehs_permissao_trabalho SET
    ativo = false,
    excluido_em = now(),
    excluido_por = v_uid,
    observacoes = left(coalesce(nullif(v_obs,'') || ' ', '') || '[desativada: ' || v_motivo || ']', 2000),
    atualizado_em = now()
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id::text, 'ehs_pt_desativar',
          jsonb_build_object('titulo', v_titulo, 'ativo', true),
          jsonb_build_object('ativo', false, 'motivo', v_motivo,
                             'excluido_em', now(), 'excluido_por', v_uid));

  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo);
END $function$;

-- 4) RD-97 · guarda de acesso: SECURITY DEFINER nunca aberta ao anon ──────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid, text)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid, text)           TO authenticated;

-- 5) Origem do dado da rota (p3): registra as RPCs e as tabelas consumidas ────────────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas  = ARRAY['fn_ehs_pt_salvar','fn_ehs_pt_desativar'],
       views_consumidas = ARRAY['ehs_permissao_trabalho','ehs_pt_medida']
 WHERE id = 'dashboard.ehs_permissao_trabalho';
