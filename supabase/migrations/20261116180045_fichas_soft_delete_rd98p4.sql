-- RD-98 p4 · Exclusão rastreável (soft-delete) das fichas técnicas e seus itens.
-- Hoje fn_ficha_tecnica_excluir e fn_ficha_item_excluir fazem DELETE FÍSICO (o audit_log
-- grava o valor anterior, mas o registro some de vez). Passamos para soft-delete:
--   - colunas excluido_em / excluido_por (aditivas, nullable);
--   - as funções marcam excluido_em = now(), excluido_por = auth.uid() (idempotentes);
--   - a listagem (front) filtra excluido_em IS NULL.
-- Aditiva e idempotente. Mantém RLS e o registro em audit_log_global.

-- 1) Colunas de soft-delete (aditivas) ------------------------------------------------
ALTER TABLE public.fichas_tecnicas ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.fichas_tecnicas ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ficha_itens     ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ficha_itens     ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- Índices parciais para a listagem dos vivos (só o que não foi excluído) ---------------
CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_vivas
  ON public.fichas_tecnicas (company_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_ficha_itens_vivos
  ON public.ficha_itens (ficha_id) WHERE excluido_em IS NULL;

-- 2) fn_ficha_item_excluir → soft-delete ----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ficha_item_excluir(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid(); v_old jsonb; v_ja_excluido timestamptz;
BEGIN
  SELECT to_jsonb(fi.*), ft.company_id, fi.excluido_em
    INTO v_old, v_company, v_ja_excluido
    FROM public.ficha_itens fi
    JOIN public.fichas_tecnicas ft ON ft.id = fi.ficha_id
   WHERE fi.id = p_id;
  IF v_company IS NULL OR v_ja_excluido IS NOT NULL THEN
    RETURN; -- não existe ou já excluído: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ficha_itens', p_id::text, 'excluir', v_old);
  UPDATE public.ficha_itens
     SET excluido_em = now(), excluido_por = v_uid
   WHERE id = p_id AND excluido_em IS NULL;
END
$function$;

-- 3) fn_ficha_tecnica_excluir → soft-delete (ficha + itens filhos) ---------------------
CREATE OR REPLACE FUNCTION public.fn_ficha_tecnica_excluir(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid(); v_old jsonb; v_ja_excluido timestamptz;
BEGIN
  SELECT to_jsonb(ft.*), ft.company_id, ft.excluido_em
    INTO v_old, v_company, v_ja_excluido
    FROM public.fichas_tecnicas ft WHERE ft.id = p_id;
  IF v_company IS NULL OR v_ja_excluido IS NOT NULL THEN
    RETURN; -- não existe ou já excluído: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'fichas_tecnicas', p_id::text, 'excluir', v_old);
  -- marca a ficha e, junto, seus itens vivos (para não sobrarem órfãos visíveis)
  UPDATE public.fichas_tecnicas
     SET excluido_em = now(), excluido_por = v_uid
   WHERE id = p_id AND excluido_em IS NULL;
  UPDATE public.ficha_itens
     SET excluido_em = now(), excluido_por = v_uid
   WHERE ficha_id = p_id AND excluido_em IS NULL;
END
$function$;

-- 4) Guardas de execução (SECURITY DEFINER): nunca anon/PUBLIC -------------------------
REVOKE ALL ON FUNCTION public.fn_ficha_item_excluir(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_item_excluir(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) TO authenticated, service_role;
