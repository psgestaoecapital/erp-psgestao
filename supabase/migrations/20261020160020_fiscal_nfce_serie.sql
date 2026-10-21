-- #3753 (Gean, piloto) · NFC-e (modelo 65) · etapa 1A: série própria da NFC-e na Configuração Fiscal.
-- A NFC-e não pode sair na série da NF-e (modelo 55): a rota /api/fiscal/nfce/emitir usava serie_nfe_padrao.
-- O número é controlado pela Focus por série (o ERP não envia `numero`); o CSC/ID do token ficam no cadastro da
-- empresa NA FOCUS (habilita_nfce), não no ERP — nenhum segredo novo aqui.
-- ADITIVA: coluna nova (nula = NFC-e desligada, a emissão é recusada com aviso) + função nova de gravação com guarda
-- de empresa e de Master + "?" (RD-95). Nenhuma função, view ou policy existente é alterada; NF-e/NFS-e intactas.

ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS serie_nfce text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_fiscal_cfg_serie_nfce') THEN
    ALTER TABLE public.erp_fiscal_provider_config
      ADD CONSTRAINT ck_fiscal_cfg_serie_nfce
      CHECK (serie_nfce IS NULL OR serie_nfce ~ '^[0-9]{1,3}$');
  END IF;
END $$;

COMMENT ON COLUMN public.erp_fiscal_provider_config.serie_nfce IS
  '#3753 série da NFC-e (modelo 65), 1 a 999, diferente da série da NF-e. NULL = NFC-e não configurada (emissão recusada).';

CREATE OR REPLACE FUNCTION public.fn_fiscal_nfce_serie_salvar(p_company_id uuid, p_serie text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int; v_serie text := nullif(btrim(p_serie), ''); v_serie_nfe text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Empresa obrigatória'); END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn_pagar_usuario_master(p_company_id) THEN
    RAISE EXCEPTION 'Somente Master (sócio/gerente com nível Master) altera a série da NFC-e' USING ERRCODE = '42501';
  END IF;
  IF v_serie IS NOT NULL THEN
    IF v_serie !~ '^[0-9]{1,3}$' OR v_serie::int < 1 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Série da NFC-e: número de 1 a 999 (ou vazia para desligar)');
    END IF;
    v_serie := (v_serie::int)::text;
    SELECT serie_nfe_padrao INTO v_serie_nfe FROM public.erp_fiscal_provider_config
     WHERE company_id = p_company_id AND provider = 'focusnfe' AND ativo = true;
    IF v_serie_nfe ~ '^[0-9]+$' AND v_serie_nfe::int = v_serie::int THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'A série da NFC-e precisa ser diferente da série da NF-e (' || v_serie_nfe || ')');
    END IF;
  END IF;
  UPDATE public.erp_fiscal_provider_config
     SET serie_nfce = v_serie, atualizado_em = now(), atualizado_por = auth.uid()
   WHERE company_id = p_company_id AND provider = 'focusnfe' AND ativo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Configure o emissor Focus antes de informar a série da NFC-e'); END IF;
  RETURN jsonb_build_object('ok', true, 'serie', v_serie);
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_fiscal_nfce_serie_salvar(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_nfce_serie_salvar(uuid, text) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/configuracoes/fiscal', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.serie_nfce', 'Série da NFC-e (cupom fiscal)',
  'O número da série que a empresa vai usar no cupom fiscal eletrônico (NFC-e, modelo 65), de 1 a 999. Tem que ser diferente da série da NF-e. Deixe vazio enquanto a empresa não emite NFC-e.',
  'Sem a série, o ERP não emite NFC-e. A numeração (1, 2, 3...) é controlada pela Focus dentro dessa série. O CSC e o ID do token, que a SEFAZ fornece, são cadastrados na Focus, não aqui.',
  '2', 'Usar a mesma série da NF-e. Trocar a série depois de começar a emitir sem combinar com o contador.', 3),
 ('fiscal.config.salvar_serie_nfce', 'Salvar série da NFC-e',
  'Toque para gravar a série (só usuário Master). Vazio + salvar desliga a emissão de NFC-e.',
  'Vale para as próximas NFC-e; notas já emitidas não mudam. NF-e e NFS-e não são afetadas.',
  '—', 'Salvar antes de cadastrar o CSC na Focus: a nota volta rejeitada pela SEFAZ.', 4)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
