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
