-- PS EHS · Brigada de incêndio (NR-23) — /dashboard/ehs/brigada
-- PDCA auditor_pdca_1 (23/11, DEMO EHS b0700000-...) — RD-98 p3 (origem do dado) + rastro de escrita (audit).
--
-- PARCIAL (menor que as irmãs): o "Desativar" da tela JÁ gravava excluido_em/excluido_por/excluido_motivo
--   (RD-98 p4 do registro principal OK; não há subtabela nem DELETE físico). FALTAVA:
--   1) a tela gravava direto na tabela pelo cliente (insert/update/UPDATE de desativação) SEM RPC guardada e
--      SEM audit_log_global;
--   2) system_screens da rota com views_consumidas/rpcs_chamadas = null e estado_real = 'desconhecida'.
-- Fecha espelhando o padrão da PR #5988:
--   * fn_ehs_brigada_salvar(uuid,uuid,jsonb): cria (p_id null) ou atualiza o brigadista, guardado por empresa,
--     com registro em audit_log_global;
--   * fn_ehs_brigada_desativar(uuid,text): soft-delete com quem/quando/motivo (colunas já existentes) + audit;
--   * system_screens da rota ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (CREATE OR REPLACE, UPDATE por rota). Sem DROP/TRUNCATE e sem UPDATE em massa de dado
-- de cliente; nenhuma coluna nova (excluido_* já existem). Guarda por empresa (get_user_company_ids()/is_admin()).
-- Code: desenvolvedor_5_g

-- 1) Criar/atualizar rastreável ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_brigada_salvar(p_id uuid, p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_co    uuid;
  v_nome  text := btrim(coalesce(p_dados->>'nome', ''));
  v_id    uuid;
  v_modo  text;
BEGIN
  IF v_nome = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O nome do brigadista é obrigatório.');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT company_id INTO v_co FROM ehs_brigada WHERE id = p_id;
    IF v_co IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Brigadista não encontrado'); END IF;
  ELSE
    v_co := p_company_id;
  END IF;

  IF v_co IS NULL OR NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa'); END IF;

  IF p_id IS NOT NULL THEN
    UPDATE ehs_brigada
       SET nome                 = v_nome,
           matricula            = nullif(btrim(coalesce(p_dados->>'matricula','')), ''),
           funcao_brigada       = coalesce(nullif(btrim(coalesce(p_dados->>'funcao_brigada','')), ''), 'brigadista'),
           setor                = nullif(btrim(coalesce(p_dados->>'setor','')), ''),
           turno                = nullif(btrim(coalesce(p_dados->>'turno','')), ''),
           data_treinamento     = nullif(btrim(coalesce(p_dados->>'data_treinamento','')), '')::date,
           validade_treinamento = nullif(btrim(coalesce(p_dados->>'validade_treinamento','')), '')::date,
           carga_horaria_h      = nullif(btrim(coalesce(p_dados->>'carga_horaria_h','')), '')::numeric,
           certificado          = nullif(btrim(coalesce(p_dados->>'certificado','')), ''),
           apto                 = coalesce((p_dados->>'apto')::boolean, true),
           observacao           = nullif(btrim(coalesce(p_dados->>'observacao','')), ''),
           atualizado_em        = now()
     WHERE id = p_id;
    v_id := p_id; v_modo := 'atualizar';
  ELSE
    INSERT INTO ehs_brigada (company_id, nome, matricula, funcao_brigada, setor, turno,
                             data_treinamento, validade_treinamento, carga_horaria_h, certificado, apto, observacao)
    VALUES (v_co, v_nome,
            nullif(btrim(coalesce(p_dados->>'matricula','')), ''),
            coalesce(nullif(btrim(coalesce(p_dados->>'funcao_brigada','')), ''), 'brigadista'),
            nullif(btrim(coalesce(p_dados->>'setor','')), ''),
            nullif(btrim(coalesce(p_dados->>'turno','')), ''),
            nullif(btrim(coalesce(p_dados->>'data_treinamento','')), '')::date,
            nullif(btrim(coalesce(p_dados->>'validade_treinamento','')), '')::date,
            nullif(btrim(coalesce(p_dados->>'carga_horaria_h','')), '')::numeric,
            nullif(btrim(coalesce(p_dados->>'certificado','')), ''),
            coalesce((p_dados->>'apto')::boolean, true),
            nullif(btrim(coalesce(p_dados->>'observacao','')), ''))
    RETURNING id INTO v_id;
    v_modo := 'criar';
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_brigada', v_id::text, 'ehs_brigada_' || v_modo,
          jsonb_build_object('modo', v_modo),
          jsonb_build_object('nome', v_nome, 'funcao_brigada', coalesce(nullif(btrim(coalesce(p_dados->>'funcao_brigada','')), ''), 'brigadista')));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'modo', v_modo);
END $function$;

-- 2) Desativação rastreável (colunas excluido_* já existem) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_brigada_desativar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_co    uuid;
  v_nome  text;
  v_achou boolean := false;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar.');
  END IF;

  SELECT true, company_id, nome INTO v_achou, v_co, v_nome FROM ehs_brigada WHERE id = p_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Brigadista não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este brigadista'); END IF;

  UPDATE ehs_brigada
     SET ativo           = false,
         excluido_em     = now(),
         excluido_por    = v_uid,
         excluido_motivo = btrim(p_motivo),
         atualizado_em   = now()
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_brigada', p_id::text, 'ehs_brigada_desativar',
          jsonb_build_object('nome', v_nome, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'nome', v_nome);
END $function$;

-- 3) RD-97 · guarda de acesso: SECURITY DEFINER não pode ficar aberta ao anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_brigada_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_brigada_desativar(uuid, text)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_brigada_salvar(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_brigada_desativar(uuid, text)     TO authenticated;

-- 4) RD-98 p3 · origem do dado da tela ────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_brigada'],
       rpcs_chamadas    = ARRAY['fn_ehs_brigada_salvar','fn_ehs_brigada_desativar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/brigada';
