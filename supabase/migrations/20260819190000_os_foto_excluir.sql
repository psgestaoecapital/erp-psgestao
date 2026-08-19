-- Oficina · excluir foto do registro fotográfico da OS (pedido Gean).
--
-- Contexto: erp_os_registro_foto guarda as fotos por etapa (ex.: 'diagnostico'). A RLS da tabela
-- só tem policy de LEITURA (os_registro_foto auth read) — não há caminho de exclusão. Por isso a
-- exclusão vai por RPC SECURITY DEFINER com guard de company (mesmo padrão das outras exclusões).
-- A RPC apaga só a linha do banco e devolve o foto_path para o frontend remover o arquivo do storage.
-- Premissas auditadas: colunas id/company_id/foto_path existem; nenhuma RPC de exclusão pré-existente.

CREATE OR REPLACE FUNCTION public.fn_os_foto_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_path text;
BEGIN
  SELECT company_id, foto_path INTO v_company, v_path
    FROM erp_os_registro_foto WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'foto_inexistente');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  DELETE FROM erp_os_registro_foto WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true, 'foto_path', v_path);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_os_foto_excluir(uuid) FROM anon;
