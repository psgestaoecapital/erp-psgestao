-- #2936 etapa 4 · Página pública "Conferir contrato assinado" (/verificar/contrato).
-- A conferência agora também aceita o hash do PDF ASSINADO (o arquivo com a página de evidências, que é o que as partes
-- guardam), além do código de verificação e do hash do original. Diz qual dos dois arquivos bateu e trata o envio vencido
-- como 'expirado'. Continua só service_role (a rota do servidor é a única porta) e só com o mínimo (LGPD): nome mascarado,
-- papel, situação e data — sem CPF/CNPJ, e-mail, IP, aparelho ou localização.
-- Plano de volta: reaplicar a definição de 20261017070120_contrato_assinatura_eletronica_base.sql (mesma assinatura e
-- mesmos grants); a rota/página só leem campos novos de forma opcional.

CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_verificar(p_codigo_ou_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_q text := lower(btrim(COALESCE(p_codigo_ou_hash, ''))); v_e record; v_arquivo text;
BEGIN
  IF v_q = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o código ou o hash'); END IF;
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio
   WHERE lower(codigo_verificacao) = v_q OR documento_hash = v_q OR documento_assinado_hash = v_q
   ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'encontrado', false); END IF;
  v_arquivo := CASE WHEN v_e.documento_assinado_hash = v_q THEN 'assinado'
                    WHEN v_e.documento_hash = v_q THEN 'original' ELSE NULL END;
  RETURN jsonb_build_object('ok', true, 'encontrado', true,
    'status', CASE WHEN v_e.status = 'aguardando' AND v_e.expira_em < now() THEN 'expirado' ELSE v_e.status END,
    'versao', v_e.versao, 'documento_hash', v_e.documento_hash, 'concluido_em', v_e.concluido_em,
    'arquivo', v_arquivo, 'tem_pdf_assinado', v_e.documento_assinado_hash IS NOT NULL,
    'signatarios', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nome', split_part(s.nome, ' ', 1) || CASE WHEN position(' ' IN btrim(s.nome)) > 0 THEN ' ' || left(split_part(btrim(s.nome), ' ', array_length(string_to_array(btrim(s.nome), ' '), 1)), 1) || '.' ELSE '' END,
        'papel', s.papel, 'status', s.status, 'assinado_em', s.assinado_em) ORDER BY s.ordem), '[]'::jsonb)
      FROM public.erp_contrato_assinatura_signatario s WHERE s.envio_id = v_e.id));
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_verificar(text) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_verificar(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_contrato_assin_envio_hash_assinado
  ON public.erp_contrato_assinatura_envio (documento_assinado_hash) WHERE documento_assinado_hash IS NOT NULL;

-- Conferência pública por código/hash (sem usuário logado): o acesso é só pela rota do servidor com service_role.
-- ci-sem-guarda: fn_contrato_assinatura_verificar — só service_role; conferência pública por código/hash, sem usuário logado (devolve só nome mascarado, papel e situação)
