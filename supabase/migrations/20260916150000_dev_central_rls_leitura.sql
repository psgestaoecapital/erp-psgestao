-- Central de Dev — RLS de leitura (decisão do CEO: não abrir antes de saber quem vê).
-- erp_documento_vertical: leitura só para papéis administrativos (CEO/PS_ADMIN).
-- dev_area_tabela_uso: RLS ligado deny-all (a RPC fn_dev_central_barras é SECURITY DEFINER e não depende de policy).

-- 1) documento vivo: SELECT só admin (CEO). Escrita continua sem policy (só via migration/serviço).
DROP POLICY IF EXISTS erp_doc_vertical_admin_read ON public.erp_documento_vertical;
CREATE POLICY erp_doc_vertical_admin_read ON public.erp_documento_vertical
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('adm','admin','acesso_total','adm_investimentos')
    )
  );

-- 2) mapa de tabelas por vertical: RLS ligado, sem policy (deny-all p/ clientes; a RPC lê como definer)
ALTER TABLE public.dev_area_tabela_uso ENABLE ROW LEVEL SECURITY;
