-- PS EHS · M7 EPI (/dashboard/ehs/epi/catalogo) — RD-98 p4: fn_epi_excluir fazia soft-delete
-- (ativo=false) SEM gravar quem excluiu nem rastro em audit_log_global. Fecha o gap:
--   * epi_catalogo ganha excluido_em/excluido_por (rastro; o soft-delete continua por ativo=false);
--   * fn_epi_excluir passa a gravar excluido_em/por = auth.uid()/now() e um registro em
--     audit_log_global (acao 'epi_excluir'), como o DELETE de ind_turnos (apontamento).
-- Assinatura e retorno INALTERADOS (RD-97). Guarda por empresa mantida. Aditiva/idempotente.
-- Code: dev7claudeps

ALTER TABLE public.epi_catalogo ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.epi_catalogo ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE OR REPLACE FUNCTION public.fn_epi_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_co uuid; v_global boolean; v_nome text; v_achou boolean := false;
  v_ficha int := 0; v_estoque int := 0; v_mov int := 0; v_alerta int := 0; v_total int;
BEGIN
  SELECT true, company_id, is_global, nome INTO v_achou, v_co, v_global, v_nome
  FROM epi_catalogo WHERE id = p_id;
  IF NOT v_achou THEN RETURN jsonb_build_object('ok', false, 'erro', 'EPI não encontrado'); END IF;
  IF v_global IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'EPI global não pode ser excluído pela empresa'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a este EPI'); END IF;

  SELECT count(*) INTO v_ficha   FROM epi_ficha        WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_estoque FROM epi_estoque      WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_mov     FROM epi_movimentacao WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_alerta  FROM epi_alerta       WHERE catalogo_id = p_id;
  v_total := v_ficha + v_estoque + v_mov + v_alerta;

  UPDATE epi_catalogo
     SET ativo = false, excluido_em = now(), excluido_por = v_uid, updated_at = now()
   WHERE id = p_id;

  -- RD-98 p4: rastro de exclusão (quem/quando)
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid), 'epi_catalogo', p_id::text, 'epi_excluir',
          jsonb_build_object('nome', v_nome, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid,
                             'deps', jsonb_build_object('ficha', v_ficha, 'estoque', v_estoque, 'movimentacao', v_mov, 'alerta', v_alerta)));

  RETURN jsonb_build_object(
    'ok', true, 'nome', v_nome, 'tinha_historico', (v_total > 0),
    'deps', jsonb_build_object('ficha', v_ficha, 'estoque', v_estoque, 'movimentacao', v_mov, 'alerta', v_alerta));
END $function$;
