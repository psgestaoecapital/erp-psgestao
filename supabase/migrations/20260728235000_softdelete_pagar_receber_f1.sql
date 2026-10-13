-- SOFT-DELETE em erp_pagar/erp_receber (F1) — resolve o bug 754e122d (dados sumindo no "excluir e relançar").
-- Antes: fn_pagar_excluir/fn_receber_excluir faziam DELETE FÍSICO (o dado sumia). Agora: deleted_at (aditivo,
-- RD-30/55). "Excluir" vira soft-delete; toda leitura esconde os deletados; dá pra restaurar. RD-54: backup antes.
-- RD-57: converte TODOS os caminhos (as 2 RPCs aqui; o API route no código). Trilha em erp_lancamento_log (já existe).

-- RD-54 · BACKUP antes de mutar (7.935 pagar / 1.969 receber)
CREATE TABLE IF NOT EXISTS public._bkp_erp_pagar_20260728 AS SELECT * FROM public.erp_pagar;
CREATE TABLE IF NOT EXISTS public._bkp_erp_receber_20260728 AS SELECT * FROM public.erp_receber;

-- colunas de soft-delete (aditivas)
ALTER TABLE public.erp_pagar   ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid;
CREATE INDEX IF NOT EXISTS ix_pagar_vivos   ON public.erp_pagar(company_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_receber_vivos ON public.erp_receber(company_id) WHERE deleted_at IS NULL;

-- RLS: esconde soft-deletados de TODA leitura direta (.from) — defesa em profundidade
DROP POLICY IF EXISTS erp_pagar_select_strict ON public.erp_pagar;
CREATE POLICY erp_pagar_select_strict ON public.erp_pagar FOR SELECT
  USING (((company_id IN (SELECT get_user_company_ids())) OR is_admin()) AND deleted_at IS NULL);
DROP POLICY IF EXISTS erp_receber_select_strict ON public.erp_receber;
CREATE POLICY erp_receber_select_strict ON public.erp_receber FOR SELECT
  USING (((company_id IN (SELECT get_user_company_ids())) OR is_admin()) AND deleted_at IS NULL);

-- "Excluir" agora é SOFT-DELETE (converte as 2 RPCs; mantém as travas de negócio e a trilha)
CREATE OR REPLACE FUNCTION public.fn_pagar_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_registro jsonb; v_status text; v_conciliado boolean; v_company_id uuid; v_del timestamptz;
        v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(p.*), p.status, p.conciliado, p.company_id, p.deleted_at
    INTO v_registro, v_status, v_conciliado, v_company_id, v_del
  FROM public.erp_pagar p WHERE p.id = p_id;
  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'ja_excluido', true); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_pagar');

  UPDATE public.erp_pagar SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;  -- soft-delete
  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_receber_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_registro jsonb; v_status text; v_conciliado boolean; v_company_id uuid; v_del timestamptz;
        v_boleto_emitido timestamptz; v_boleto_status text; v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.conciliado, r.company_id, r.deleted_at, r.boleto_emitido_em, r.boleto_status
    INTO v_registro, v_status, v_conciliado, v_company_id, v_del, v_boleto_emitido, v_boleto_status
  FROM public.erp_receber r WHERE r.id = p_id;
  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'ja_excluido', true); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;
  IF v_boleto_emitido IS NOT NULL
     AND COALESCE(lower(v_boleto_status), '') NOT IN ('cancelado','cancelada','baixado','baixada','expirado','expirada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_boleto_ativo',
      'orientacao', 'Este título tem boleto emitido no banco. Cancele o boleto primeiro — senão o banco continua cobrando um título que não existe mais no sistema. Depois exclua.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_receber');

  UPDATE public.erp_receber SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;  -- soft-delete
  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

-- RESTAURAR um lançamento soft-deletado (desfazer)
CREATE OR REPLACE FUNCTION public.fn_lancamento_restaurar(p_tabela text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_company uuid; v_email text := public.fn_user_email_atual();
BEGIN
  IF p_tabela NOT IN ('erp_pagar','erp_receber') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'tabela_invalida'); END IF;
  IF p_tabela = 'erp_pagar' THEN
    SELECT company_id INTO v_company FROM public.erp_pagar WHERE id = p_id;
    IF v_company IS NULL OR NOT (v_company IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
    UPDATE public.erp_pagar SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;
  ELSE
    SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_id;
    IF v_company IS NULL OR NOT (v_company IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
    UPDATE public.erp_receber SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;
  END IF;
  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'RESTAUROU', '{}'::jsonb, p_tabela);
  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_lancamento_restaurar(text, uuid) TO authenticated;
