-- PS EHS · M11 (/dashboard/ehs/trabalhos-risco/permissoes) — RD-98 p3/p4
--
-- A Permissão de Trabalho (PT) e suas MEDIDAS de controle eram escritas DIRETO no client:
--   * ao editar uma PT, o código fazia DELETE FÍSICO de ehs_pt_medida (supabase.from('ehs_pt_medida').delete())
--     e re-inseria — a prova de que o risco foi tratado era apagada a cada edição (RD-98 p4);
--   * criar/alterar/desativar a PT ia direto na tabela pelo cliente, sem RPC com guarda, sem rastro (RD-98 p3).
-- Mesmo gap sistêmico já corrigido nas tabelas irmãs do EHS (setor de risco #5988 e sequência). Esta migration
-- replica aquele padrão para a PT:
--   * ehs_permissao_trabalho e ehs_pt_medida ganham excluido_em/excluido_por (soft-delete rastreável);
--   * 2 RPCs SECURITY DEFINER com a MESMA guarda da RLS (company_id IN get_user_company_ids() OR is_admin())
--     e rastro em audit_log_global: fn_ehs_pt_salvar (cria/atualiza PT + medidas, soft-delete das medidas
--     removidas — NUNCA DELETE físico) e fn_ehs_pt_desativar (ativo=false + excluido_em/por + motivo);
--   * system_screens desta rota passa a declarar rpcs_chamadas/views_consumidas (origem do dado — RD-98 p3).
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon. RLS inalterada.
-- Code: desenvolvedor_5_g

-- 1) Soft-delete rastreável (aditivo, idempotente) ────────────────────────────────────────────────────
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) CRIAR/ATUALIZAR PT + medidas (guarda por empresa, medida removida = soft-delete, NUNCA DELETE físico) ─
-- p_medidas: jsonb array de { id (uuid opcional), descricao (text), atendido (bool), ordem (int) }.
--   - medida com id existente desta PT → atualiza;
--   - medida sem id → insere;
--   - medida que estava viva e NÃO veio no payload → soft-delete (ativo=false, excluido_em/por).
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_company_id uuid,
  p_id uuid,
  p_tipo text,
  p_titulo text,
  p_numero text DEFAULT NULL,
  p_descricao text DEFAULT NULL,
  p_local text DEFAULT NULL,
  p_setor text DEFAULT NULL,
  p_data_inicio timestamptz DEFAULT NULL,
  p_data_fim timestamptz DEFAULT NULL,
  p_responsavel_emissao text DEFAULT NULL,
  p_executantes text DEFAULT NULL,
  p_status text DEFAULT 'rascunho',
  p_observacoes text DEFAULT NULL,
  p_medidas jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := p_id;
  v_old ehs_permissao_trabalho%ROWTYPE;
  v_ids_mantidos uuid[] := ARRAY[]::uuid[];
  v_removidas uuid[] := ARRAY[]::uuid[];
  v_m jsonb;
  v_mid uuid;
  v_desc text;
  v_ordem int := 0;
BEGIN
  -- guarda por empresa (mesma condição da RLS)
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF coalesce(btrim(p_titulo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'titulo_obrigatorio'); END IF;
  IF coalesce(p_tipo,'geral') NOT IN
     ('altura','espaco_confinado','eletricidade','inflamaveis','trabalho_quente','icamento','escavacao','geral') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido'); END IF;
  IF coalesce(p_status,'rascunho') NOT IN ('rascunho','emitida','em_andamento','encerrada','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF p_data_inicio IS NOT NULL AND p_data_fim IS NOT NULL AND p_data_fim < p_data_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido'); END IF;

  IF v_id IS NULL THEN
    INSERT INTO ehs_permissao_trabalho (
      company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
      responsavel_emissao, executantes, status, observacoes, criado_por)
    VALUES (
      p_company_id, nullif(btrim(p_numero),''), coalesce(p_tipo,'geral'), btrim(p_titulo),
      nullif(btrim(p_descricao),''), nullif(btrim(p_local),''), nullif(btrim(p_setor),''),
      p_data_inicio, p_data_fim, nullif(btrim(p_responsavel_emissao),''), nullif(btrim(p_executantes),''),
      coalesce(p_status,'rascunho'), nullif(btrim(p_observacoes),''), v_uid)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_old FROM ehs_permissao_trabalho WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'pt_nao_encontrada'); END IF;
    IF NOT (v_old.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
    IF v_old.company_id <> p_company_id THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'empresa_divergente'); END IF;

    UPDATE ehs_permissao_trabalho SET
      numero = nullif(btrim(p_numero),''), tipo = coalesce(p_tipo,'geral'), titulo = btrim(p_titulo),
      descricao = nullif(btrim(p_descricao),''), local = nullif(btrim(p_local),''), setor = nullif(btrim(p_setor),''),
      data_inicio = p_data_inicio, data_fim = p_data_fim,
      responsavel_emissao = nullif(btrim(p_responsavel_emissao),''), executantes = nullif(btrim(p_executantes),''),
      status = coalesce(p_status,'rascunho'), observacoes = nullif(btrim(p_observacoes),''), atualizado_em = now()
    WHERE id = v_id;
  END IF;

  -- medidas: upsert das que vieram no payload
  FOR v_m IN SELECT * FROM jsonb_array_elements(coalesce(p_medidas, '[]'::jsonb))
  LOOP
    v_desc := btrim(coalesce(v_m->>'descricao',''));
    CONTINUE WHEN v_desc = '';
    v_ordem := v_ordem + 1;
    v_mid := NULLIF(v_m->>'id','')::uuid;
    IF v_mid IS NOT NULL AND EXISTS (
         SELECT 1 FROM ehs_pt_medida WHERE id = v_mid AND pt_id = v_id AND company_id = p_company_id) THEN
      UPDATE ehs_pt_medida SET
        descricao = v_desc, atendido = coalesce((v_m->>'atendido')::boolean, false),
        ordem = v_ordem, ativo = true, excluido_em = NULL, excluido_por = NULL
      WHERE id = v_mid;
      v_ids_mantidos := v_ids_mantidos || v_mid;
    ELSE
      INSERT INTO ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
      VALUES (p_company_id, v_id, v_ordem, v_desc, coalesce((v_m->>'atendido')::boolean, false))
      RETURNING id INTO v_mid;
      v_ids_mantidos := v_ids_mantidos || v_mid;
    END IF;
  END LOOP;

  -- medidas vivas que não vieram no payload → soft-delete rastreável (NUNCA DELETE físico)
  SELECT array_agg(id) INTO v_removidas
    FROM ehs_pt_medida
   WHERE pt_id = v_id AND company_id = p_company_id AND ativo = true
     AND NOT (id = ANY (v_ids_mantidos));

  UPDATE ehs_pt_medida
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE pt_id = v_id AND company_id = p_company_id AND ativo = true
     AND NOT (id = ANY (v_ids_mantidos));

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_id,
          CASE WHEN p_id IS NULL THEN 'pt_criar' ELSE 'pt_alterar' END,
          CASE WHEN p_id IS NULL THEN NULL ELSE jsonb_build_object(
            'titulo', v_old.titulo, 'tipo', v_old.tipo, 'status', v_old.status,
            'data_inicio', v_old.data_inicio, 'data_fim', v_old.data_fim) END,
          jsonb_build_object(
            'titulo', btrim(p_titulo), 'tipo', coalesce(p_tipo,'geral'), 'status', coalesce(p_status,'rascunho'),
            'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
            'medidas_vivas', array_length(v_ids_mantidos,1),
            'medidas_removidas', coalesce(v_removidas, ARRAY[]::uuid[])));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3) DESATIVAR PT rastreável (soft-delete; nunca DELETE físico de documento legal) ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r ehs_permissao_trabalho%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM ehs_permissao_trabalho WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'pt_nao_encontrada'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  IF v_r.ativo = false THEN RETURN jsonb_build_object('ok', true, 'ja_desativada', true); END IF;

  UPDATE ehs_permissao_trabalho SET
    ativo = false, excluido_em = now(), excluido_por = v_uid,
    observacoes = left(coalesce(v_r.observacoes || ' ', '') || '[desativada: ' || btrim(p_motivo) || ']', 2000),
    atualizado_em = now()
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id, 'pt_desativar',
          jsonb_build_object('titulo', v_r.titulo, 'status', v_r.status, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Trancar as RPCs (sem anon; só usuário logado / serviço) ───────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid,text) TO authenticated, service_role;

-- 5) Origem do dado da tela (RD-98 p3): system_screens passa a declarar views e RPCs ───────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_permissao_trabalho','ehs_pt_medida']::text[],
       rpcs_chamadas    = ARRAY['fn_ehs_pt_salvar','fn_ehs_pt_desativar','fn_ajuda_campo_listar']::text[]
 WHERE rota = '/dashboard/ehs/trabalhos-risco/permissoes';
