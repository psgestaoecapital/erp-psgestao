-- Chamado #5404 (parte b) · Banco do Brasil Cobrança v2: variação de carteira e modalidade por configuração.
-- Cada ambiente (homologacao/producao) é UMA linha de erp_banco_provider_config; os dados de cobrança ficam
-- na linha do ambiente, então mudar um não apaga nem sobrescreve o outro. Aditivo: coluna nova + função nova.
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS variacao_carteira text,
  ADD COLUMN IF NOT EXISTS modalidade integer;

COMMENT ON COLUMN public.erp_banco_provider_config.variacao_carteira IS
  'BB Cobrança v2: numeroVariacaoCarteira (ex.: 35 no convênio de teste). Só números.';
COMMENT ON COLUMN public.erp_banco_provider_config.modalidade IS
  'BB Cobrança v2: codigoModalidade (1 = Simples, 4 = Vinculada).';

-- Salva convênio/carteira/variação/modalidade de UMA configuração da empresa do usuário (não toca Vault).
-- Carteira e variação guardam só dígitos ("17/01-9" -> "17"; variação "35").
CREATE OR REPLACE FUNCTION public.fn_banco_config_salvar_bb_cobranca(
  p_company_id uuid, p_config_id uuid, p_convenio text, p_carteira text, p_variacao text, p_modalidade integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_cart text; v_var text;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_modalidade IS NOT NULL AND p_modalidade NOT IN (1, 4) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modalidade deve ser 1 (Simples) ou 4 (Vinculada)'); END IF;
  v_cart := NULLIF(regexp_replace(split_part(coalesce(p_carteira,''), '/', 1), '\D', '', 'g'), '');
  v_var  := NULLIF(regexp_replace(coalesce(p_variacao,''), '\D', '', 'g'), '');

  UPDATE erp_banco_provider_config SET
    convenio         = COALESCE(NULLIF(regexp_replace(coalesce(p_convenio,''), '\D', '', 'g'), ''), convenio),
    carteira         = COALESCE(v_cart, carteira),
    variacao_carteira= COALESCE(v_var, variacao_carteira),
    modalidade       = COALESCE(p_modalidade, modalidade),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_config_id AND company_id = p_company_id AND provider = 'bb'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'config_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_banco_config_salvar_bb_cobranca(uuid,uuid,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_config_salvar_bb_cobranca(uuid,uuid,text,text,text,integer) TO authenticated, service_role;

-- "?" (RD-95) dos campos novos da tela de dados do banco.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('banco.bb_variacao', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Variação da carteira',
  'O número da variação da carteira do convênio de cobrança, só dígitos.',
  'Vai junto com a carteira no registro do boleto. Cada ambiente (homologação e produção) guarda a sua.',
  '35 (convênio de teste do BB) ou a variação do seu convênio real.',
  'Digitar "17/35" na carteira: a carteira é só o 17 e a variação vai neste campo.',
  'financeiro', 'publicado'),
 ('banco.bb_modalidade', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Modalidade da cobrança',
  'Escolha 1 (Simples) ou 4 (Vinculada), conforme o contrato do convênio.',
  'Diz ao banco o tipo de cobrança do boleto registrado.',
  '1 - Simples.',
  'Escolher 4 num convênio que não é vinculado: o banco recusa o registro.',
  'financeiro', 'publicado'),
 ('banco.ambiente_em_uso', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Ambiente em uso',
  'Não se preenche: mostra se esta conexão emite boleto de TESTE (homologação) ou REAL (produção).',
  'Evita emitir boleto real durante os testes. Homologação e produção têm dados separados.',
  'HOMOLOGAÇÃO: o boleto emitido é só de teste.',
  'Achar que o boleto de homologação vale para cobrar o cliente: ele não vale.',
  'financeiro', 'publicado')
ON CONFLICT (chave) DO NOTHING;
