-- Chamado #1673 (R.R) — banco RESPONSÁVEL pelos boletos da empresa. Aditiva: coluna nova + índice + função nova.
-- Hoje cap_boleto diz quais bancos PODEM emitir; nada marca QUAL é o padrão. Com 2+ bancos ligados, a emissão
-- ficava ambígua. Regras: no máximo UM responsável ativo por empresa; ele precisa ter cap_boleto = true e estar ativo.
-- Fallback (no app): um só banco com boleto = ele; vários e nenhum responsável = pedir para definir antes de emitir.

ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS boleto_responsavel boolean NOT NULL DEFAULT false;

-- um responsável por empresa (a linha de produção e a de homologação do mesmo banco não coexistem como responsáveis)
CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_provider_config_boleto_responsavel
  ON public.erp_banco_provider_config (company_id)
  WHERE boleto_responsavel;

CREATE OR REPLACE FUNCTION public.fn_banco_definir_responsavel_boleto(p_company_id uuid, p_config_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa'); END IF;

  SELECT id, ativo, cap_boleto INTO v_cfg
    FROM public.erp_banco_provider_config WHERE id = p_config_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'conexao nao encontrada na empresa'); END IF;
  IF NOT COALESCE(v_cfg.ativo, false) THEN RETURN jsonb_build_object('ok', false, 'erro', 'conexao inativa'); END IF;
  IF NOT COALESCE(v_cfg.cap_boleto, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'este banco nao esta habilitado para boleto'); END IF;

  UPDATE public.erp_banco_provider_config SET boleto_responsavel = false
   WHERE company_id = p_company_id AND boleto_responsavel AND id <> p_config_id;
  UPDATE public.erp_banco_provider_config SET boleto_responsavel = true
   WHERE id = p_config_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'config_id', p_config_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_banco_definir_responsavel_boleto(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_definir_responsavel_boleto(uuid, uuid) TO authenticated, service_role;

-- RD-95: "?" do novo botão
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'banco.responsavel_boleto', 'Conexões bancárias', 'Responsável pelos boletos',
  'Clique em "Definir como responsável" no banco que deve emitir os boletos da empresa.',
  'A emissão de boleto já sai por esse banco. Só um banco por empresa pode ser o responsável; ele precisa estar ativo e com "Boleto" ligado.',
  'Bradesco responsável: todo boleto novo sai pelo Bradesco, mesmo com o Sicoob também conectado.',
  'Esperar que o banco sem "Boleto" ligado possa ser responsável: ligue o Boleto na conexão primeiro.',
  90, '/dashboard/financeiro/conexoes-bancarias', 'financeiro', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
