-- NFS-e #90 / task #64 — PERSISTIR O PAYLOAD ENVIADO. Sem isso, cada rejeição (ex.: E0370 mesmo com
-- obra_id preenchido) é um tiro no escuro: provider_raw só tem a RESPOSTA do Focus, nunca o que
-- ENVIAMOS. Guardamos o corpo JSON enviado (sem cert/token — esses vão no header, não no corpo) para
-- comparar o grupo de obra que montamos com o que o Focus reclama.
ALTER TABLE public.erp_nfse_emitidas
  ADD COLUMN IF NOT EXISTS payload_enviado jsonb;
COMMENT ON COLUMN public.erp_nfse_emitidas.payload_enviado
  IS 'Corpo JSON enviado ao provider (Focus) na emissão — sem certificado nem token. Depuração de rejeições.';

-- Recria o registrador: grava payload_enviado E troca o "·" (ponto médio, hostil ao XSD nacional) por
-- "-" no histórico que anexa em erp_receber.observacoes (esse campo é interno; desde o #1533 não vai
-- mais para a nota, mas mantemos o texto limpo).
CREATE OR REPLACE FUNCTION public.fn_registrar_nfse_emitida(p_company_id uuid, p_erp_receber_id uuid, p_provider_reference text, p_ambiente text, p_dados jsonb, p_provider_raw jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.erp_nfse_emitidas (
    company_id, erp_receber_id, provider_reference, ambiente,
    valor_servicos, valor_iss, aliquota_iss, retem_iss,
    cnae, codigo_servico, descricao_servico,
    prestador_cnpj, prestador_razao_social, prestador_im,
    tomador_cnpj, tomador_cpf, tomador_razao_social, tomador_email, tomador_endereco,
    status, numero, serie, codigo_verificacao,
    xml_url, pdf_url, motivo_rejeicao,
    municipio_prestacao_ibge, municipio_prestacao_nome, municipio_prestacao_uf, iss_fonte_aliquota,
    provider_raw, payload_enviado, emitido_por
  ) VALUES (
    p_company_id, p_erp_receber_id, p_provider_reference, p_ambiente,
    (p_dados->>'valor_servicos')::numeric,
    NULLIF(p_dados->>'valor_iss','')::numeric,
    NULLIF(p_dados->>'aliquota_iss','')::numeric,
    COALESCE((p_dados->>'retem_iss')::boolean, false),
    p_dados->>'cnae', p_dados->>'codigo_servico', p_dados->>'descricao_servico',
    p_dados->>'prestador_cnpj', p_dados->>'prestador_razao_social', p_dados->>'prestador_im',
    p_dados->>'tomador_cnpj', p_dados->>'tomador_cpf', p_dados->>'tomador_razao_social',
    p_dados->>'tomador_email', p_dados->'tomador_endereco',
    COALESCE(p_dados->>'status','processando'),
    p_dados->>'numero', p_dados->>'serie', p_dados->>'codigo_verificacao',
    p_dados->>'xml_url', p_dados->>'pdf_url', p_dados->>'motivo_rejeicao',
    NULLIF(p_dados->>'municipio_prestacao_ibge',''),
    NULLIF(p_dados->>'municipio_prestacao_nome',''),
    NULLIF(p_dados->>'municipio_prestacao_uf',''),
    NULLIF(p_dados->>'iss_fonte_aliquota',''),
    p_provider_raw, p_dados->'payload_enviado', auth.uid()
  )
  RETURNING id INTO v_id;

  IF p_erp_receber_id IS NOT NULL THEN
    UPDATE public.erp_receber
    SET observacoes = COALESCE(observacoes, '') ||
        format(E'\nNFSe emitida em %s - ref %s', NOW()::date, p_provider_reference)
    WHERE id = p_erp_receber_id;
  END IF;

  RETURN v_id;
END;
$function$;
