-- Hub · Gestão de Obras · Encerramento (aba Documentos) — exclusão RASTREÁVEL (RD-98 p4).
-- Adendo auditor_pdca_1: o remover() da tela só gravava deleted_at, sem "quem excluiu" nem
-- audit_log_global. Esta migration fecha o gap sem tocar dado de cliente:
--  1) coluna aditiva deleted_motivo (por quê) em erp_obra_arquivos (deleted_at/deleted_by já existem);
--  2) RPC fn_obra_arquivo_excluir — soft-delete com auth.uid() + guarda por empresa + motivo
--     obrigatório + registro em audit_log_global (padrão provado de fn_obra_requisicao_excluir).
-- O storage NÃO é apagado (o blob permanece; só o registro sai da lista). ADITIVA e idempotente.

-- 1) por quê da exclusão (quem/quando já existem: deleted_by/deleted_at) -------------------------
ALTER TABLE public.erp_obra_arquivos ADD COLUMN IF NOT EXISTS deleted_motivo text;

-- 2) exclusão rastreável do documento da obra (soft-delete + audit) -----------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_arquivo_excluir(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE r public.erp_obra_arquivos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.erp_obra_arquivos WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Documento não encontrado (talvez já excluído).'); END IF;
  -- defesa em profundidade: a empresa do registro tem de ser a do usuário (a RLS também cobre)
  PERFORM public.fn__guarda_empresa(r.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;

  UPDATE public.erp_obra_arquivos
     SET deleted_at = now(), deleted_by = auth.uid(), deleted_motivo = btrim(p_motivo)
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (r.company_id, auth.uid(), 'erp_obra_arquivos', p_id::text, 'excluir',
            jsonb_build_object('obra_id', r.obra_id, 'tipo', r.tipo, 'nome_arquivo', r.nome_arquivo, 'storage_path', r.storage_path),
            jsonb_build_object('motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true);
END;
$f$;

REVOKE ALL ON FUNCTION public.fn_obra_arquivo_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_arquivo_excluir(uuid, text) TO authenticated, service_role;

-- 3) RD-95 "?" do motivo da exclusão --------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, 'projetos', v.ordem, 'publicado'
FROM (VALUES
 ('projetos.encerramento.motivo_exclusao', '/dashboard/projetos/obras/[id]/encerramento', 'Documentos da obra', 'Motivo da exclusão',
  'Escreva por que está removendo este documento da lista (ex.: enviado o arquivo errado, versão antiga).',
  'A exclusão é rastreável: o documento sai da lista mas fica registrado quem removeu, quando e por quê — nada é apagado de vez.',
  'Removendo um termo de entrega digitalizado torto: motivo "digitalização ilegível, reenviado".',
  'Deixar o motivo vazio ou genérico: ele precisa de pelo menos 3 letras e explica a remoção na auditoria.',
  90)
) AS v(chave, rota, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
