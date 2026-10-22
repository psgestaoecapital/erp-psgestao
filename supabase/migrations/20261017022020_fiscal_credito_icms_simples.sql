-- #2876 · Crédito de ICMS do Simples Nacional na NF-e (LC 123/2006 art. 23): CSOSN 101 com pCredSN/vCredICMSSN e o
-- texto obrigatório nas Informações Complementares. Decisão do CEO 16/10 (delegada à Jordana): só quando o emitente é do
-- Simples e o destinatário é contribuinte; alíquota do cadastro de cada empresa (informada pelo contador); homologação
-- antes de nota real; nada muda para quem não cadastrar a alíquota (nem para quem não é do Simples).
-- ADITIVA: coluna nova (nula = desligado) + função nova de gravação com guarda de empresa e de Master + "?" (RD-95).
-- Nenhuma função, view ou policy existente é alterada.

ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS aliquota_credito_icms_sn numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_fiscal_cfg_aliquota_credito_icms_sn') THEN
    ALTER TABLE public.erp_fiscal_provider_config
      ADD CONSTRAINT ck_fiscal_cfg_aliquota_credito_icms_sn
      CHECK (aliquota_credito_icms_sn IS NULL OR (aliquota_credito_icms_sn > 0 AND aliquota_credito_icms_sn <= 5));
  END IF;
END $$;

COMMENT ON COLUMN public.erp_fiscal_provider_config.aliquota_credito_icms_sn IS
  '#2876 pCredSN: alíquota do crédito de ICMS do Simples (LC 123 art. 23), informada pelo contador. NULL = sem crédito na NF-e.';

CREATE OR REPLACE FUNCTION public.fn_fiscal_credito_icms_sn_salvar(p_company_id uuid, p_aliquota numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Empresa obrigatória'); END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn_pagar_usuario_master(p_company_id) THEN
    RAISE EXCEPTION 'Somente Master (sócio/gerente com nível Master) altera a alíquota do crédito de ICMS' USING ERRCODE = '42501';
  END IF;
  IF p_aliquota IS NOT NULL AND (p_aliquota <= 0 OR p_aliquota > 5) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Alíquota do crédito deve ficar entre 0,01% e 5% (ou vazia para desligar)');
  END IF;
  UPDATE public.erp_fiscal_provider_config
     SET aliquota_credito_icms_sn = round(p_aliquota, 2), atualizado_em = now(), atualizado_por = auth.uid()
   WHERE company_id = p_company_id AND provider = 'focusnfe' AND ativo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Configure o emissor Focus (NF-e) antes de informar o crédito'); END IF;
  RETURN jsonb_build_object('ok', true, 'aliquota', round(p_aliquota, 2));
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_fiscal_credito_icms_sn_salvar(uuid, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_credito_icms_sn_salvar(uuid, numeric) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/configuracoes/fiscal', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.aliquota_credito_icms_sn', 'Alíquota do crédito de ICMS (Simples)',
  'A alíquota que o contador informa para o crédito de ICMS do Simples Nacional (parcela de ICMS da faixa da empresa). Deixe vazio se a empresa não destaca crédito.',
  'Na NF-e para cliente contribuinte (que não é consumidor final) o item sai com CSOSN 101 e o valor do crédito = valor do item × alíquota; nas Informações Complementares entra o texto do art. 23 da LC 123/2006. Para consumidor final sai CSOSN 102.',
  '3,80', 'Usar a alíquota total do Simples (DAS): o crédito é só a parcela do ICMS. Emitir nota real sem testar antes em homologação.', 1),
 ('fiscal.config.salvar_credito_icms_sn', 'Salvar alíquota do crédito',
  'Toque para gravar a alíquota (só usuário Master). Vazio + salvar desliga o crédito.',
  'Vale para as próximas NF-e emitidas; notas já emitidas não mudam.',
  '—', 'Esquecer de atualizar quando o contador informar a alíquota da nova faixa.', 2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
