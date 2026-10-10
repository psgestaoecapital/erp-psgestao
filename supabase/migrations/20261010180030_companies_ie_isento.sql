-- Chamado #776 (carteira Rodrigo, R.R Serviços): flag "Isento de inscrição estadual" na empresa.
-- Aditivo: coluna nova (NOT NULL DEFAULT false = ninguém muda) + duas funções novas, sem mexer em RLS/policy existente.
-- Regra: ie_isento = true => inscricao_estadual é limpa (vazia/ignorada). "Isento" é escolha declarada, não campo em branco.
-- A tela de Dados da empresa não lê companies direto (guarda segredos de integração): lê/grava só por RPC, como as demais.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ie_isento boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.companies.ie_isento IS 'Empresa declarada isenta de inscrição estadual (chamado #776). true => inscricao_estadual fica vazia.';

CREATE OR REPLACE FUNCTION public.fn_empresa_obter_ie_isento(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN false;
  END IF;
  RETURN COALESCE((SELECT c.ie_isento FROM public.companies c WHERE c.id = p_company_id), false);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_empresa_salvar_ie_isento(p_company_id uuid, p_ie_isento boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE public.companies SET
    ie_isento = COALESCE(p_ie_isento, false),
    inscricao_estadual = CASE WHEN COALESCE(p_ie_isento, false) THEN NULL ELSE inscricao_estadual END,
    updated_at = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('sucesso', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_empresa_obter_ie_isento(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_empresa_salvar_ie_isento(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_obter_ie_isento(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_empresa_salvar_ie_isento(uuid, boolean) TO authenticated, service_role;

-- RD-95: "?" do checkbox
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('empresa.dados.ie_isento', 'Dados da empresa', 'Isento de inscrição estadual',
  'Marque se a empresa não tem inscrição estadual (comum em prestadores de serviço). O campo da inscrição fica cinza e é apagado ao salvar.',
  'Registra que a isenção é uma decisão da empresa, diferente de esquecer de preencher a inscrição. Empresa isenta emite NFS-e (serviço); NF-e de produto exige inscrição estadual.',
  'Agência de consultoria que só presta serviço: marcar e salvar.',
  'Marcar e esperar emitir NF-e de produto: a nota é recusada com aviso. Desmarque e informe a inscrição se a empresa vende mercadoria.',
  35, '/dashboard/configuracoes/empresa', 'geral', 'publicado')
ON CONFLICT (chave) DO NOTHING;
