-- PM-QW #16 · Anexar contrato/arquivo no cliente. Espelha o padrão erp_contratos_arquivos (RD-26/RD-52):
-- o componente ContratoArquivos faz .from()+storage DIRETO (com RLS), não via RPC → sigo o MESMO padrão
-- (tabela + RLS), em vez de criar RPCs próprias. Soft-only (RD-30): excluir = deleted_at (sem DELETE físico;
-- não concedo DELETE, só UPDATE — a RLS impede apagar de vez). Storage reusa o bucket 'contratos-assinados'
-- (a policy dele libera por 1º folder = company_id → path 'company_id/cliente/cliente_id/...' passa).

CREATE TABLE IF NOT EXISTS public.erp_cliente_arquivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  cliente_id    uuid NOT NULL,
  tipo          text DEFAULT 'contrato',          -- contrato | outro
  nome_arquivo  text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  hash_sha256   text,
  enviado_por   uuid DEFAULT auth.uid(),
  enviado_em    timestamptz DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cliente_arquivos_cliente
  ON public.erp_cliente_arquivos (company_id, cliente_id) WHERE deleted_at IS NULL;

ALTER TABLE public.erp_cliente_arquivos ENABLE ROW LEVEL SECURITY;

-- RLS fail-closed: só membros da empresa (ou admin). Sem policy de DELETE → exclusão é soft (UPDATE).
DROP POLICY IF EXISTS cliente_arquivos_sel ON public.erp_cliente_arquivos;
DROP POLICY IF EXISTS cliente_arquivos_ins ON public.erp_cliente_arquivos;
DROP POLICY IF EXISTS cliente_arquivos_upd ON public.erp_cliente_arquivos;
CREATE POLICY cliente_arquivos_sel ON public.erp_cliente_arquivos FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY cliente_arquivos_ins ON public.erp_cliente_arquivos FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY cliente_arquivos_upd ON public.erp_cliente_arquivos FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

GRANT SELECT, INSERT, UPDATE ON public.erp_cliente_arquivos TO authenticated;
