-- PS EHS · EHS-7 / M11 — Permissão de Trabalho (PT): RPCs com guarda + fim do DELETE físico (RD-98 p3/p4)
--
-- Base legal (RD-104): NR-01 (GRO/PGR, rastreabilidade das medidas de controle), NR-33, NR-35, NR-10, NR-20
-- (permissão de entrada/trabalho e registro das medidas conferidas). A PROVA de que o risco foi tratado — as
-- MEDIDAS de controle da PT — não pode ser apagada: precisa ficar rastreável (quem removeu e quando).
--
-- GAP corrigido (auditoria de jornada auditor_pdca_1, main 3c3603a, provado no código vivo — RD-38):
--   p4) a tela fazia DELETE FÍSICO de ehs_pt_medida a cada edição da PT (prova apagada sem rastro);
--   p3) escritas de PT e medidas iam direto na tabela pelo cliente, sem RPC com guarda (company/RLS/audit);
--       e a rota tinha system_screens.rpcs_chamadas/views_consumidas = NULL (origem do dado não registrada).
-- Replica o padrão das telas irmãs (soft-delete rastreável + guarda + audit_log_global, como #5988 nas irmãs).
--
-- ADITIVA e idempotente: só ADD COLUMN IF NOT EXISTS (rastro de exclusão) + CREATE OR REPLACE de 2 RPCs novas
-- + preenchimento de system_screens. Nada de DROP/TRUNCATE/UPDATE em massa; RLS e policies inalteradas.

-- 1) Rastro de exclusão (soft-delete) nas duas tabelas — colunas novas, nulas (aditivo) ────────────────
ALTER TABLE public.ehs_permissao_trabalho
  ADD COLUMN IF NOT EXISTS excluido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por    uuid,
  ADD COLUMN IF NOT EXISTS excluido_motivo text;

ALTER TABLE public.ehs_pt_medida
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) RPC: criar/atualizar PT + reconciliar medidas com SOFT-DELETE (nunca DELETE físico) ───────────────
--    p_medidas: jsonb array de { id?: uuid, descricao: text, atendido: bool, ordem: int }.
--    Medida que existia e não veio na lista → soft-delete (ativo=false + excluido_em/por), não é apagada.
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_company_id          uuid,
  p_id                  uuid,
  p_numero              text,
  p_tipo                text,
  p_titulo              text,
  p_descricao           text        DEFAULT NULL,
  p_local               text        DEFAULT NULL,
  p_setor               text        DEFAULT NULL,
  p_data_inicio         timestamptz DEFAULT NULL,
  p_data_fim            timestamptz DEFAULT NULL,
  p_responsavel_emissao text        DEFAULT NULL,
  p_executantes         text        DEFAULT NULL,
  p_status              text        DEFAULT 'rascunho',
  p_observacoes         text        DEFAULT NULL,
  p_medidas             jsonb       DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_pt        uuid;
  v_acao      text;
  v_keep      uuid[];
  v_removidas integer := 0;
  v_insere    integer := 0;
  v_atualiza  integer := 0;
  r           jsonb;
  v_mid       uuid;
  v_hit       uuid;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);

  IF COALESCE(btrim(p_titulo), '') = '' THEN RAISE EXCEPTION 'titulo_obrigatorio'; END IF;
  IF COALESCE(p_tipo, 'geral') NOT IN
     ('altura','espaco_confinado','eletricidade','inflamaveis','trabalho_quente','icamento','escavacao','geral')
     THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF COALESCE(p_status, 'rascunho') NOT IN
     ('rascunho','emitida','em_andamento','encerrada','cancelada')
     THEN RAISE EXCEPTION 'status_invalido'; END IF;
  IF p_data_inicio IS NOT NULL AND p_data_fim IS NOT NULL AND p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'periodo_invalido'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.ehs_permissao_trabalho (
      company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
      responsavel_emissao, executantes, status, observacoes, criado_por)
    VALUES (
      p_company_id, NULLIF(btrim(p_numero),''), COALESCE(p_tipo,'geral'), btrim(p_titulo),
      NULLIF(btrim(p_descricao),''), NULLIF(btrim(p_local),''), NULLIF(btrim(p_setor),''),
      p_data_inicio, p_data_fim, NULLIF(btrim(p_responsavel_emissao),''),
      NULLIF(btrim(p_executantes),''), COALESCE(p_status,'rascunho'), NULLIF(btrim(p_observacoes),''), v_uid)
    RETURNING id INTO v_pt;
    v_acao := 'pt_criar';
  ELSE
    UPDATE public.ehs_permissao_trabalho SET
      numero = NULLIF(btrim(p_numero),''), tipo = COALESCE(p_tipo,'geral'), titulo = btrim(p_titulo),
      descricao = NULLIF(btrim(p_descricao),''), local = NULLIF(btrim(p_local),''),
      setor = NULLIF(btrim(p_setor),''), data_inicio = p_data_inicio, data_fim = p_data_fim,
      responsavel_emissao = NULLIF(btrim(p_responsavel_emissao),''), executantes = NULLIF(btrim(p_executantes),''),
      status = COALESCE(p_status,'rascunho'), observacoes = NULLIF(btrim(p_observacoes),''), atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id AND ativo = true
    RETURNING id INTO v_pt;
    IF v_pt IS NULL THEN RAISE EXCEPTION 'pt_invalida'; END IF;
    v_acao := 'pt_atualizar';
  END IF;

  -- ids das medidas que a tela manteve (as que têm id); as demais serão soft-deletadas
  SELECT COALESCE(array_agg((e->>'id')::uuid), ARRAY[]::uuid[])
    INTO v_keep
  FROM jsonb_array_elements(COALESCE(p_medidas, '[]'::jsonb)) e
  WHERE NULLIF(btrim(COALESCE(e->>'id','')), '') IS NOT NULL;

  -- SOFT-DELETE (não DELETE físico) das medidas ativas que saíram da lista
  UPDATE public.ehs_pt_medida
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE pt_id = v_pt AND company_id = p_company_id AND ativo = true
     AND NOT (id = ANY (v_keep));
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  -- upsert das medidas informadas (descrição não vazia); id existente da MESMA PT = update, senão insert
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_medidas, '[]'::jsonb)) WITH ORDINALITY t(value, ord)
  LOOP
    IF COALESCE(btrim(r->>'descricao'), '') = '' THEN CONTINUE; END IF;
    v_mid := NULLIF(btrim(COALESCE(r->>'id','')), '')::uuid;
    v_hit := NULL;
    IF v_mid IS NOT NULL THEN
      UPDATE public.ehs_pt_medida
         SET descricao = btrim(r->>'descricao'),
             atendido  = COALESCE((r->>'atendido')::boolean, false),
             ordem     = COALESCE((r->>'ordem')::integer, 1),
             ativo     = true, excluido_em = NULL, excluido_por = NULL
       WHERE id = v_mid AND pt_id = v_pt AND company_id = p_company_id
      RETURNING id INTO v_hit;
      IF v_hit IS NOT NULL THEN v_atualiza := v_atualiza + 1; END IF;
    END IF;
    IF v_hit IS NULL THEN
      INSERT INTO public.ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
      VALUES (p_company_id, v_pt, COALESCE((r->>'ordem')::integer, 1),
              btrim(r->>'descricao'), COALESCE((r->>'atendido')::boolean, false));
      v_insere := v_insere + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_pt, v_acao,
          NULL,
          jsonb_build_object('titulo', btrim(p_titulo), 'tipo', COALESCE(p_tipo,'geral'),
                             'status', COALESCE(p_status,'rascunho'),
                             'medidas_removidas', v_removidas, 'medidas_inseridas', v_insere,
                             'medidas_atualizadas', v_atualiza));
  RETURN v_pt;
END $function$;

-- 3) RPC: desativar PT (soft-delete rastreável + audit) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r public.ehs_permissao_trabalho%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN RAISE EXCEPTION 'motivo_obrigatorio'; END IF;
  SELECT * INTO v_r FROM public.ehs_permissao_trabalho WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'pt_nao_encontrada'); END IF;
  PERFORM public.fn_compliance_assert(v_r.company_id);
  IF v_r.ativo = false THEN RETURN jsonb_build_object('ok', true, 'ja_desativada', true); END IF;

  UPDATE public.ehs_permissao_trabalho
     SET ativo = false, excluido_em = now(), excluido_por = v_uid, excluido_motivo = btrim(p_motivo),
         observacoes = LEFT(COALESCE(v_r.observacoes || ' ', '') || '[desativada: ' || btrim(p_motivo) || ']', 2000),
         atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id, 'pt_desativar',
          jsonb_build_object('titulo', v_r.titulo, 'status', v_r.status, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Guarda de acesso às funções: só usuário autenticado (nunca anon) ─────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid,text) TO authenticated;

-- 5) Origem do dado registrada na rota (RD-98 p3) ─────────────────────────────────────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas   = ARRAY['fn_ehs_pt_salvar','fn_ehs_pt_desativar']::text[],
       views_consumidas = ARRAY[]::text[]  -- leitura direta de ehs_permissao_trabalho/ehs_pt_medida sob RLS; sem views
 WHERE id = 'dashboard.ehs_permissao_trabalho';
