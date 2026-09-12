-- ============================================================
-- Oficina Onda 2 · DVI — fn_oficina_registro_listar devolve o item da foto (p/ contador por item)
-- ============================================================
-- A câmera-no-item precisa mostrar "N fotos" por item de diagnóstico (§3.2). A listar não devolvia
-- diagnostico_item_id. Mudar o RETURNS TABLE exige DROP + CREATE (não dá CREATE OR REPLACE com tipo
-- de retorno diferente). Aditivo p/ os chamadores JS (ganham colunas novas; nada quebra).
-- Depende de #1422 (colunas diagnostico_item_id + anotacao em erp_os_registro_foto).

DROP FUNCTION IF EXISTS public.fn_oficina_registro_listar(uuid, uuid, text);

CREATE FUNCTION public.fn_oficina_registro_listar(p_company_id uuid, p_os_id uuid, p_etapa text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, foto_path text, descricao text, criado_por_nome text, etapa text,
               created_at timestamptz, diagnostico_item_id uuid, anotacao jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN QUERY SELECT r.id, r.foto_path, r.descricao, r.criado_por_nome, r.etapa, r.created_at,
                      r.diagnostico_item_id, r.anotacao
    FROM erp_os_registro_foto r
    WHERE r.company_id=p_company_id AND r.os_id=p_os_id
      AND (p_etapa IS NULL OR r.etapa = lower(p_etapa))
    ORDER BY r.created_at DESC;
END $function$;
