-- PDCA P&M · /dashboard/pm/configuracoes — RD-98 p4: exclusão rastreável (nunca DELETE físico)
-- GAP (auditor_pdca_2, reauditoria 01/11): fn_agency_config_excluir ainda fazia DELETE FROM agency_config_opcao
-- (físico). A tabela JÁ tem a coluna "ativo" e fn_agency_config_listar já filtra ativo=true, então a troca por
-- soft-delete não altera o que o usuário vê. Esta migration:
--   1) adiciona (aditiva) excluido_em/excluido_por para completar o rastro de QUANDO e QUEM excluiu;
--   2) troca o DELETE por UPDATE ativo=false (+ excluido_em/excluido_por), mantendo o audit_log_global que já existia.
-- Nada de dado de cliente é apagado/alterado; a guarda de uso (opção em uso não pode sair) permanece.
-- Code: code-desenvolvedor-3

-- 1) Colunas aditivas de rastro (idempotentes)
ALTER TABLE public.agency_config_opcao
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Soft-delete no lugar do DELETE físico (CREATE OR REPLACE preserva os grants existentes)
CREATE OR REPLACE FUNCTION public.fn_agency_config_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row agency_config_opcao%ROWTYPE; v_qtd int := 0; v_col text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM agency_config_opcao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'opcao não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- Idempotência: já excluída (inativa) → nada a fazer
  IF v_row.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluida', true);
  END IF;

  v_col := CASE v_row.lista WHEN 'area_equipe' THEN 'area' WHEN 'unidade' THEN 'unidade' WHEN 'periodicidade' THEN 'periodicidade' ELSE NULL END;
  IF v_col IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM agency_servico WHERE company_id = $1 AND %I = $2', v_col)
      INTO v_qtd USING v_row.company_id, v_row.valor;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd); END IF;
  END IF;
  IF v_row.lista = 'rede_social' THEN
    SELECT count(*) INTO v_qtd FROM agency_posts
     WHERE company_id = v_row.company_id AND v_row.valor = ANY (redes) AND excluido_em IS NULL;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd,
        'mensagem', 'Rede usada em posts. Oculte a rede em vez de remover.'); END IF;
  END IF;

  -- RD-98 p4: rastro de quem/quando excluiu + valor anterior (a opção já está comprovadamente sem uso).
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_config_opcao', p_id::text,
          'config_opcao_excluida',
          jsonb_build_object('lista', v_row.lista, 'valor', v_row.valor, 'rotulo', v_row.rotulo, 'ativo', v_row.ativo),
          jsonb_build_object('excluido', true, 'excluido_por', v_uid));

  -- RD-98 p4: soft-delete — nunca DELETE físico. A listagem (fn_agency_config_listar) filtra ativo=true.
  UPDATE agency_config_opcao
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 3) Guarda de função SECURITY DEFINER (check_fn_guards · regra 1 · revoke_anon):
-- CREATE OR REPLACE preserva os grants, mas o gate exige o REVOKE/GRANT explícito em toda
-- (re)criação de função SECURITY DEFINER (fecha IDOR via anon/PUBLIC). Casando com a ACL viva
-- em produção ({authenticated, service_role}; anon/PUBLIC já fora).
REVOKE ALL ON FUNCTION public.fn_agency_config_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_config_excluir(uuid) TO authenticated, service_role;
