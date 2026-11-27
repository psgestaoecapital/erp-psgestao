-- PS EHS · M11 (/dashboard/ehs/trabalhos-risco/permissoes) — RD-98 p3/p4: a Permissão de Trabalho (PT)
-- escrevia DIRETO nas tabelas pelo client (insert/update de ehs_permissao_trabalho e, pior, um
-- supabase.from('ehs_pt_medida').delete().eq('pt_id', ...) a cada edição) — as MEDIDAS de controle
-- (prova de que o risco foi tratado) eram APAGADAS FISICAMENTE, sem quem/quando nem rastro.
-- Este PR fecha o gap exatamente como as telas irmãs (#5988 e sequência):
--   * ehs_permissao_trabalho e ehs_pt_medida ganham excluido_em/excluido_por (soft-delete; nunca DELETE físico);
--   * 2 RPCs SECURITY DEFINER com a MESMA guarda da RLS (company_id IN get_user_company_ids() OR is_admin())
--     e rastro em audit_log_global: fn_ehs_pt_salvar (cria/atualiza PT + medidas, soft-deletando as removidas)
--     e fn_ehs_pt_desativar (soft-delete da PT com motivo);
--   * system_screens desta rota passa a declarar rpcs_chamadas/views_consumidas (origem do dado).
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon. RLS inalterada.
-- Code: desenvolvedor_5_g

-- 1) Soft-delete rastreável (aditivo, idempotente) ────────────────────────────────────────────────────
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE INDEX IF NOT EXISTS idx_ehs_pt_medida_vivas ON public.ehs_pt_medida (pt_id, ordem) WHERE excluido_em IS NULL;

-- 2) CRIAR/ATUALIZAR PT + medidas (medidas removidas viram SOFT-DELETE; nunca DELETE físico) ───────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_company_id          uuid,
  p_id                  uuid    DEFAULT NULL,
  p_numero              text    DEFAULT NULL,
  p_tipo                text    DEFAULT 'geral',
  p_titulo              text    DEFAULT NULL,
  p_descricao           text    DEFAULT NULL,
  p_local               text    DEFAULT NULL,
  p_setor               text    DEFAULT NULL,
  p_data_inicio         timestamptz DEFAULT NULL,
  p_data_fim            timestamptz DEFAULT NULL,
  p_responsavel_emissao text    DEFAULT NULL,
  p_executantes         text    DEFAULT NULL,
  p_status              text    DEFAULT 'rascunho',
  p_observacoes         text    DEFAULT NULL,
  p_medidas             jsonb   DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_id      uuid := p_id;
  v_novo    boolean := (p_id IS NULL);
  v_titulo  text := nullif(btrim(p_titulo), '');
  v_removidas int := 0;
  v_inseridas int := 0;
  v_m       jsonb;
  v_ordem   int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_titulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A tarefa (título) é obrigatória'); END IF;
  IF p_data_inicio IS NOT NULL AND p_data_fim IS NOT NULL AND p_data_fim < p_data_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O fim da validade não pode ser antes do início'); END IF;

  IF v_novo THEN
    INSERT INTO ehs_permissao_trabalho
      (company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
       responsavel_emissao, executantes, status, observacoes)
    VALUES
      (p_company_id, nullif(btrim(p_numero),''), coalesce(nullif(btrim(p_tipo),''),'geral'), v_titulo,
       nullif(btrim(p_descricao),''), nullif(btrim(p_local),''), nullif(btrim(p_setor),''),
       p_data_inicio, p_data_fim, nullif(btrim(p_responsavel_emissao),''), nullif(btrim(p_executantes),''),
       coalesce(nullif(btrim(p_status),''),'rascunho'), nullif(btrim(p_observacoes),''))
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM ehs_permissao_trabalho
                    WHERE id = v_id AND company_id = p_company_id AND excluido_em IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'permissão não encontrada nesta empresa'); END IF;
    UPDATE ehs_permissao_trabalho SET
      numero = nullif(btrim(p_numero),''), tipo = coalesce(nullif(btrim(p_tipo),''),'geral'), titulo = v_titulo,
      descricao = nullif(btrim(p_descricao),''), local = nullif(btrim(p_local),''), setor = nullif(btrim(p_setor),''),
      data_inicio = p_data_inicio, data_fim = p_data_fim,
      responsavel_emissao = nullif(btrim(p_responsavel_emissao),''), executantes = nullif(btrim(p_executantes),''),
      status = coalesce(nullif(btrim(p_status),''),'rascunho'), observacoes = nullif(btrim(p_observacoes),''),
      atualizado_em = now()
    WHERE id = v_id;
  END IF;

  -- Medidas: soft-delete das vivas e recriação a partir do conjunto novo (rastro preservado).
  UPDATE ehs_pt_medida
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE pt_id = v_id AND excluido_em IS NULL;
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  IF jsonb_typeof(p_medidas) = 'array' THEN
    FOR v_m IN SELECT * FROM jsonb_array_elements(p_medidas) LOOP
      IF nullif(btrim(coalesce(v_m->>'descricao','')), '') IS NOT NULL THEN
        v_ordem := v_ordem + 1;
        INSERT INTO ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
        VALUES (p_company_id, v_id, v_ordem, btrim(v_m->>'descricao'),
                coalesce((v_m->>'atendido')::boolean, false));
        v_inseridas := v_inseridas + 1;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_id::text,
          CASE WHEN v_novo THEN 'pt_criar' ELSE 'pt_atualizar' END,
          jsonb_build_object('titulo', v_titulo, 'tipo', coalesce(nullif(btrim(p_tipo),''),'geral'),
            'status', coalesce(nullif(btrim(p_status),''),'rascunho'),
            'medidas_anteriores_soft_delete', v_removidas, 'medidas_novas', v_inseridas));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'novo', v_novo,
                            'medidas_salvas', v_inseridas, 'medidas_soft_delete', v_removidas);
END $function$;

-- 3) DESATIVAR PT rastreável (soft-delete; nunca DELETE físico) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r ehs_permissao_trabalho%ROWTYPE; v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  SELECT * INTO v_r FROM ehs_permissao_trabalho WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'permissão não encontrada'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar'); END IF;
  IF v_r.ativo = false AND v_r.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE ehs_permissao_trabalho SET
    ativo = false, excluido_em = now(), excluido_por = v_uid,
    observacoes = left(coalesce(v_r.observacoes || ' ', '') || '[desativada: ' || v_motivo || ']', 2000),
    atualizado_em = now()
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id::text, 'pt_desativar',
          jsonb_build_object('titulo', v_r.titulo, 'status', v_r.status, 'ativo', v_r.ativo),
          jsonb_build_object('excluido_em', now(), 'excluido_por', v_uid, 'motivo', v_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Trancar as RPCs (sem anon; só usuário logado / serviço) ───────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid, text) TO authenticated, service_role;

-- 5) Origem do dado (RD-98 p3): declarar as RPCs e tabelas lidas pela tela ─────────────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas   = ARRAY['fn_ehs_pt_salvar','fn_ehs_pt_desativar','fn_ajuda_campo_listar']::text[],
       views_consumidas = ARRAY['ehs_permissao_trabalho','ehs_pt_medida']::text[]
 WHERE rota = '/dashboard/ehs/trabalhos-risco/permissoes';
