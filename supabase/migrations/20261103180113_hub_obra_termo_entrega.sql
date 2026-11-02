-- Hub · Gestão de Obras · Encerramento (H8 · HBF-7.x) — Termo de entrega assinado da obra.
-- Segunda fatia da aba Encerramento (mesma construção da erp_obra_arquivos). Registra o termo de entrega
-- assinado, no padrão de assinatura já usado em erp_os_assinatura (RD-52: reuso de padrão).
-- ADITIVA: tabela NOVA, um registro por obra (UNIQUE obra_id), RLS por empresa, REVOKE anon.
--
-- ESCOPO desta fatia = camada de dados do termo. A troca do status da própria obra (projetos_obras)
-- para "entregue" é um passo POSTERIOR, feito na UI/RPC com a devida validação — NÃO toco projetos_obras aqui.
-- O 'status' abaixo é só do termo (rascunho → assinado), não é o status da obra.

CREATE TABLE IF NOT EXISTS public.erp_obra_termo_entrega (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  obra_id         uuid NOT NULL,
  status          text NOT NULL DEFAULT 'rascunho',  -- rascunho | assinado
  data_entrega    date,
  observacoes     text,
  assinatura      text,            -- assinatura capturada (mesmo campo de erp_os_assinatura)
  assinado_por    uuid,
  assinado_em     timestamptz,
  termo_pdf_path  text,            -- PDF do termo no bucket privado da obra (prefixo obra_id/...)
  criado_por      uuid DEFAULT auth.uid(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_obra_termo_entrega_obra_uniq UNIQUE (obra_id),
  CONSTRAINT erp_obra_termo_entrega_status_chk CHECK (status IN ('rascunho','assinado'))
);

COMMENT ON TABLE public.erp_obra_termo_entrega IS
  'Termo de entrega da obra (Hub Gestão de Obras · Encerramento). Um por obra. status = rascunho|assinado (do termo, não da obra).';

CREATE INDEX IF NOT EXISTS idx_obra_termo_entrega_obra
  ON public.erp_obra_termo_entrega (company_id, obra_id);

ALTER TABLE public.erp_obra_termo_entrega ENABLE ROW LEVEL SECURITY;

-- RLS fail-closed: só membros da empresa (ou admin). Sem policy de DELETE (o termo não se apaga).
DROP POLICY IF EXISTS obra_termo_entrega_sel ON public.erp_obra_termo_entrega;
DROP POLICY IF EXISTS obra_termo_entrega_ins ON public.erp_obra_termo_entrega;
DROP POLICY IF EXISTS obra_termo_entrega_upd ON public.erp_obra_termo_entrega;
CREATE POLICY obra_termo_entrega_sel ON public.erp_obra_termo_entrega FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_termo_entrega_ins ON public.erp_obra_termo_entrega FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_termo_entrega_upd ON public.erp_obra_termo_entrega FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Acesso: só usuário logado (sem anon). Sem DELETE.
REVOKE ALL ON public.erp_obra_termo_entrega FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.erp_obra_termo_entrega TO authenticated;
