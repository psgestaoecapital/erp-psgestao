-- /dashboard/ehs/empresa ("Documentos da Empresa") — PDCA aud8 90/95
-- Gap 1 (RD-98 p2/p4): documento enviado NÃO tinha ação "Excluir". Adiciona exclusão
--   RASTREÁVEL: soft-delete (ativo=false, nunca DELETE físico) + registro em audit_log_global.
-- Gap 2 (RD-98 p3): system_screens da rota com origem do dado NÃO documentada.
-- Gap 3 (RD-95): "?" da nova ação "Excluir".
-- Aditiva e idempotente. NÃO apaga dado de cliente (a empresa é a dona do documento; soft-delete reversível).

-- 1) RPC de exclusão (soft-delete) com guarda multi-tenant por company_id e auditoria.
--    Espelha o padrão de fn_epi_excluir (get_user_company_ids()/is_admin(), SECURITY DEFINER, search_path fixo).
CREATE OR REPLACE FUNCTION public.fn_compliance_documento_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_achou boolean := false;
  v_co uuid; v_ativo boolean; v_nome text; v_tipo uuid;
BEGIN
  SELECT true, company_id, ativo, arquivo_nome_original, tipo_documento_id
    INTO v_achou, v_co, v_ativo, v_nome, v_tipo
  FROM compliance_documentos
  WHERE id = p_id;

  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Documento não encontrado');
  END IF;

  -- Guarda de tenant: só quem é das empresas do usuário (ou admin) pode excluir.
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este documento');
  END IF;

  -- Idempotente: já inativo → sucesso, sem novo registro de auditoria.
  IF v_ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true, 'nome', v_nome);
  END IF;

  UPDATE compliance_documentos
     SET ativo = false, updated_at = now()
   WHERE id = p_id;

  INSERT INTO audit_log_global(
    company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo
  )
  VALUES (
    v_co,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'compliance_documentos',
    p_id::text,
    'soft_delete',
    jsonb_build_object('ativo', true, 'arquivo_nome_original', v_nome, 'tipo_documento_id', v_tipo),
    jsonb_build_object('ativo', false)
  );

  RETURN jsonb_build_object('ok', true, 'nome', v_nome);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_compliance_documento_excluir(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_documento_excluir(uuid) TO authenticated;

-- 2) RD-98 p3: documentar origem do dado da rota em system_screens.
--    A tela lê direto compliance_tipos_documento e compliance_documentos; usa a RPC nova de exclusão,
--    o AjudaCampo (fn_ajuda_campo_listar/uso) e as rotas /api/compliance/documentos (upload/download via signed URL).
UPDATE system_screens
   SET views_consumidas = ARRAY['compliance_tipos_documento','compliance_documentos'],
       rpcs_chamadas    = ARRAY['fn_compliance_documento_excluir','fn_ajuda_campo_listar','fn_ajuda_campo_uso'],
       estado_real      = 'parcial',
       observacoes      = COALESCE(NULLIF(observacoes,''),'') ||
         CASE WHEN COALESCE(observacoes,'') = '' THEN '' ELSE ' | ' END ||
         'Upload/Download via API /api/compliance/documentos (signed URL no Storage). Exclusão = soft-delete rastreável (fn_compliance_documento_excluir + audit_log_global).',
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/empresa';

-- 3) RD-95: "?" da ação "Excluir" (idempotente).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, ordem, rotulo, status, versao, vertical,
                             o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES (
  'compliance.empresa.excluir',
  '/dashboard/ehs/empresa',
  'Documentos da Empresa',
  9,
  'Excluir',
  'publicado',
  1,
  'compliance',
  'Toque para remover o documento enviado nesta linha. Confirme antes — a linha volta a pedir "Upload".',
  'Tira do checklist um documento enviado por engano ou já substituído. A exclusão é rastreável: fica no log de auditoria com quem excluiu e quando, e o arquivo não é apagado de vez (soft-delete), então a equipe consegue reverter.',
  'Subiu o PPRA vencido no lugar do PGR novo? Exclua e faça o Upload do documento correto.',
  'Achar que a exclusão é definitiva e some do histórico: a ação fica registrada em auditoria e é reversível pela equipe.'
)
ON CONFLICT (chave) DO NOTHING;
