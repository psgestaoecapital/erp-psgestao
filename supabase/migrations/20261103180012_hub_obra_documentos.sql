-- Hub · Gestão de Obras · Encerramento (H8 · HBF-7.x) — Documentos da obra (anexos por tipo, storage privado).
-- Primeira fatia da aba Encerramento: a tabela de documentos. Espelha o padrão já provado de
-- erp_cliente_arquivos / erp_contratos_arquivos (RD-52: reuso de padrão, sem RPC própria — o componente
-- faz .from()+storage com RLS). ADITIVA: tabela NOVA, RLS ligada, policy por empresa, REVOKE anon.
--
-- Exclusão rastreável (RD-30): soft-delete por deleted_at. NÃO concedo DELETE nem crio policy de DELETE,
-- então a RLS impede apagar de vez — o registro (quem enviou/quando) fica para auditoria.
-- storage privado: o storage_path aponta para um bucket privado da obra ('obra_id/...'); o bucket e a aba
-- de UI entram em PRs próprias desta construção (fatias seguintes), sem bloquear esta.

CREATE TABLE IF NOT EXISTS public.erp_obra_arquivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  obra_id       uuid NOT NULL,
  tipo          text NOT NULL DEFAULT 'outro',   -- termo_entrega | art_rrt | as_built | laudo | foto | nota | outro
  nome_arquivo  text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  hash_sha256   text,
  enviado_por   uuid DEFAULT auth.uid(),
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

COMMENT ON TABLE public.erp_obra_arquivos IS
  'Documentos/anexos da obra (Hub Gestão de Obras · Encerramento). Soft-delete por deleted_at; exclusão rastreável.';
COMMENT ON COLUMN public.erp_obra_arquivos.tipo IS
  'Tipo do anexo: termo_entrega | art_rrt | as_built | laudo | foto | nota | outro.';
COMMENT ON COLUMN public.erp_obra_arquivos.storage_path IS
  'Caminho no bucket privado da obra (prefixo obra_id/...).';

CREATE INDEX IF NOT EXISTS idx_obra_arquivos_obra
  ON public.erp_obra_arquivos (company_id, obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_arquivos_tipo
  ON public.erp_obra_arquivos (company_id, obra_id, tipo) WHERE deleted_at IS NULL;

ALTER TABLE public.erp_obra_arquivos ENABLE ROW LEVEL SECURITY;

-- RLS fail-closed: só membros da empresa (ou admin). Sem policy de DELETE → exclusão é soft (UPDATE deleted_at).
DROP POLICY IF EXISTS obra_arquivos_sel ON public.erp_obra_arquivos;
DROP POLICY IF EXISTS obra_arquivos_ins ON public.erp_obra_arquivos;
DROP POLICY IF EXISTS obra_arquivos_upd ON public.erp_obra_arquivos;
CREATE POLICY obra_arquivos_sel ON public.erp_obra_arquivos FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_arquivos_ins ON public.erp_obra_arquivos FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_arquivos_upd ON public.erp_obra_arquivos FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Acesso: só usuário logado (sem anon). Sem DELETE (soft-delete por UPDATE).
REVOKE ALL ON public.erp_obra_arquivos FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.erp_obra_arquivos TO authenticated;

-- RD-98 p4 (exclusão rastreável): a aba exclui por UPDATE deleted_at direto (sem RPC). Para gravar QUEM
-- excluiu e deixar trilha em audit_log_global sem depender do front, um trigger BEFORE UPDATE captura
-- deleted_by = auth.uid() e registra a auditoria quando deleted_at passa de NULL -> preenchido.
ALTER TABLE public.erp_obra_arquivos ADD COLUMN IF NOT EXISTS deleted_by uuid;
COMMENT ON COLUMN public.erp_obra_arquivos.deleted_by IS
  'Quem excluiu (soft-delete). Preenchido pelo trigger trg_obra_arquivos_soft_delete_audit.';

CREATE OR REPLACE FUNCTION public.fn__obra_arquivos_soft_delete_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- só na transição NULL -> excluído; restaurar (preenchido -> NULL) limpa o autor, sem auditar de novo.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    NEW.deleted_by := auth.uid();
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (NEW.company_id, auth.uid(), 'erp_obra_arquivos', NEW.id::text, 'excluir',
              jsonb_build_object('nome_arquivo', NEW.nome_arquivo, 'tipo', NEW.tipo, 'storage_path', NEW.storage_path));
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn__obra_arquivos_soft_delete_audit() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_obra_arquivos_soft_delete_audit ON public.erp_obra_arquivos;
CREATE TRIGGER trg_obra_arquivos_soft_delete_audit
  BEFORE UPDATE ON public.erp_obra_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.fn__obra_arquivos_soft_delete_audit();
