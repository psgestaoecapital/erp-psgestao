-- Fiscal · registro de TODA tentativa de operação na nota (cancelamento/emissão/consulta) — NFS-e e NF-e.
--
-- Bug R.R (NFS-e 56, ca0b5298): o cancelamento falhava e NÃO deixava rastro (webhook_log vazio,
-- cancelado_em/justificativa nulos) — sem log, ninguém sabia por quê. Mesma doutrina "nada de falha
-- silenciosa" dos e-mails e bancos: cada chamada ao provedor grava nota, usuário (auth.uid()), endpoint,
-- status HTTP, código e mensagem devolvidos pela Focus/prefeitura, horário — SEM dado sensível
-- (nada de XML, certificado ou payload completo; só código + mensagem). A tela da nota lê o histórico.
-- Aditivo (RD-55). Escrita pela rota (service_role); leitura por membro da empresa ou admin.

CREATE TABLE IF NOT EXISTS public.erp_fiscal_tentativa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nota_tipo text NOT NULL,                 -- 'nfse' | 'nfe' | 'nfce'
  nota_id uuid,                            -- id em erp_nfse_emitidas / erp_nfe_emitidas (pode faltar em emissão)
  operacao text NOT NULL,                  -- 'cancelamento' | 'emissao' | 'consulta'
  provider text,
  endpoint text,                           -- lógico, ex.: 'cancelarNFSe' / 'DELETE /v2/nfsen'
  referencia text,                         -- provider_reference (não sensível)
  http_status int,
  provider_codigo text,                    -- código devolvido pela Focus/prefeitura
  provider_mensagem text,                  -- mensagem/motivo real devolvido (o que o usuário precisa ver)
  resultado text NOT NULL,                 -- 'ok' | 'erro' | 'rejeitada' | 'ja_cancelada' | 'processando'
  usuario_id uuid,                         -- auth.uid() de quem tentou
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_erp_fiscal_tentativa_nota ON public.erp_fiscal_tentativa(nota_tipo, nota_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_erp_fiscal_tentativa_company ON public.erp_fiscal_tentativa(company_id, criado_em DESC);

ALTER TABLE public.erp_fiscal_tentativa ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_fiscal_tentativa'::regclass AND polname='erp_fiscal_tentativa_read') THEN
    CREATE POLICY erp_fiscal_tentativa_read ON public.erp_fiscal_tentativa FOR SELECT
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.erp_fiscal_tentativa'::regclass AND polname='erp_fiscal_tentativa_write') THEN
    CREATE POLICY erp_fiscal_tentativa_write ON public.erp_fiscal_tentativa FOR ALL
      USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
GRANT SELECT ON public.erp_fiscal_tentativa TO authenticated;
GRANT ALL ON public.erp_fiscal_tentativa TO service_role;

-- Histórico de tentativas de uma nota (para a tela). Gate por empresa/admin.
CREATE OR REPLACE FUNCTION public.fn_fiscal_tentativas(p_nota_tipo text, p_nota_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v jsonb;
BEGIN
  SELECT company_id INTO v_comp FROM erp_fiscal_tentativa WHERE nota_tipo=p_nota_tipo AND nota_id=p_nota_id ORDER BY criado_em LIMIT 1;
  IF v_comp IS NOT NULL AND NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'operacao', operacao, 'endpoint', endpoint, 'resultado', resultado,
      'http_status', http_status, 'provider_codigo', provider_codigo, 'provider_mensagem', provider_mensagem,
      'referencia', referencia, 'usuario_id', usuario_id, 'criado_em', criado_em) ORDER BY criado_em DESC), '[]'::jsonb)
    INTO v FROM erp_fiscal_tentativa WHERE nota_tipo=p_nota_tipo AND nota_id=p_nota_id;
  RETURN jsonb_build_object('ok', true, 'tentativas', v);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_fiscal_tentativas(text, uuid) TO authenticated, service_role;
