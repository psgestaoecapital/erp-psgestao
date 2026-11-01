-- #2936 (etapa 3 · Jordana · prova na Pdois/Proplay): PDF assinado com página de evidências, arquivado no próprio contrato.
-- Quando o último signatário assina, a rota do servidor junta o PDF original + uma página de evidências (quem assinou,
-- quando, IP, aparelho, hash do documento, código de verificação), guarda no bucket privado 'contratos-assinados' e
-- registra aqui: o envio ganha o caminho/hash do PDF assinado e o contrato ganha o arquivo (tipo 'contrato_assinado').
-- ADITIVA: 3 colunas novas no envio, 2 funções internas (só service_role, chamadas pela rota do servidor) e os textos do
-- "?" (RD-95) dos botões novos. Não altera dado de cliente existente nem as funções da etapa 1.

ALTER TABLE public.erp_contrato_assinatura_envio
  ADD COLUMN IF NOT EXISTS documento_assinado_path text,
  ADD COLUMN IF NOT EXISTS documento_assinado_hash text,
  ADD COLUMN IF NOT EXISTS documento_assinado_em   timestamptz;
DO $$ BEGIN
  ALTER TABLE public.erp_contrato_assinatura_envio
    ADD CONSTRAINT ck_assin_envio_hash_assinado CHECK (documento_assinado_hash IS NULL OR documento_assinado_hash ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dados da página de evidências de UM envio (só a rota do servidor; a empresa vem do envio).
CREATE OR REPLACE FUNCTION public.fn_contrato_assin__evidencias(p_envio_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e record; v_c record;
BEGIN
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = p_envio_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Envio não encontrado'); END IF;
  SELECT c.numero, c.nome, co.razao_social, co.nome_fantasia, co.cnpj INTO v_c
    FROM public.erp_contratos c LEFT JOIN public.companies co ON co.id = c.company_id WHERE c.id = v_e.contrato_id;
  RETURN jsonb_build_object('ok', true, 'envio_id', v_e.id, 'company_id', v_e.company_id, 'contrato_id', v_e.contrato_id,
    'status', v_e.status, 'versao', v_e.versao, 'documento_hash', v_e.documento_hash, 'documento_path', v_e.documento_path,
    'documento_assinado_path', v_e.documento_assinado_path, 'codigo_verificacao', v_e.codigo_verificacao,
    'criado_em', v_e.criado_em, 'concluido_em', v_e.concluido_em,
    'contrato_numero', v_c.numero, 'contrato_nome', v_c.nome,
    'empresa', COALESCE(NULLIF(btrim(v_c.razao_social), ''), v_c.nome_fantasia), 'empresa_cnpj', v_c.cnpj,
    'signatarios', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nome', s.nome, 'papel', s.papel, 'documento', s.documento, 'email', s.email, 'status', s.status,
        'visualizado_em', s.visualizado_em, 'assinado_em', s.assinado_em, 'metodo', s.assinatura_metodo,
        'ip', host(s.assinatura_ip), 'user_agent', s.assinatura_user_agent,
        'geo_consentido', s.geo_consentido, 'geolocalizacao', CASE WHEN s.geo_consentido THEN s.geolocalizacao END,
        'documento_hash_assinado', s.documento_hash_assinado) ORDER BY s.ordem), '[]'::jsonb)
      FROM public.erp_contrato_assinatura_signatario s WHERE s.envio_id = v_e.id));
END $$;

-- Registra o PDF assinado gerado pela rota: só envio 'assinado', uma vez só (idempotente), arquivo na pasta da empresa.
CREATE OR REPLACE FUNCTION public.fn_contrato_assin__registrar_pdf(p_envio_id uuid, p_path text, p_hash text, p_tamanho bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e record;
BEGIN
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = p_envio_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Envio não encontrado'); END IF;
  IF v_e.status <> 'assinado' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só envio assinado por todos gera o PDF assinado'); END IF;
  IF v_e.documento_assinado_path IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'path', v_e.documento_assinado_path);
  END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Hash SHA-256 inválido'); END IF;
  IF p_path IS NULL OR p_path NOT LIKE v_e.company_id::text || '/%' OR p_path LIKE '%..%' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Caminho fora da pasta da empresa');
  END IF;
  UPDATE public.erp_contrato_assinatura_envio
     SET documento_assinado_path = p_path, documento_assinado_hash = p_hash, documento_assinado_em = now()
   WHERE id = p_envio_id;
  INSERT INTO public.erp_contratos_arquivos (contrato_id, company_id, tipo, nome_arquivo, storage_path, tamanho_bytes, mime_type, hash_sha256, enviado_por)
  VALUES (v_e.contrato_id, v_e.company_id, 'contrato_assinado', 'Contrato assinado eletronicamente - versao ' || v_e.versao || '.pdf',
          p_path, p_tamanho, 'application/pdf', p_hash, NULL);
  INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata)
  VALUES (v_e.contrato_id, v_e.company_id, 'assinatura_pdf_arquivado',
          'PDF assinado com página de evidências arquivado no contrato (versão ' || v_e.versao || ')',
          jsonb_build_object('envio_id', v_e.id, 'versao', v_e.versao, 'documento_hash', v_e.documento_hash,
                             'documento_assinado_hash', p_hash, 'codigo_verificacao', v_e.codigo_verificacao));
  RETURN jsonb_build_object('ok', true, 'ja_existia', false, 'path', p_path);
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__evidencias(uuid) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__registrar_pdf(uuid, text, text, bigint) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assin__evidencias(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assin__registrar_pdf(uuid, text, text, bigint) TO service_role;

-- A rota logada (/api/contratos/assinatura/pdf) confere antes, com o JWT do usuário, que o envio é visível a ele (RLS da
-- empresa); a rota pública chama depois da assinatura do último signatário (token público, sem usuário logado).
-- ci-sem-guarda: fn_contrato_assin__evidencias — interna, só service_role; a empresa vem do envio (rota confere a RLS antes ou é a do token público)
-- ci-sem-guarda: fn_contrato_assin__registrar_pdf — interna, só service_role; grava o PDF gerado pela rota na pasta da empresa do próprio envio

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Contratos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/contratos-recorrentes', 'gestao_empresarial', 'publicado'
FROM (VALUES
  ('ge.contrato.assinatura.pdf_assinado', 'Contrato assinado (PDF)',
   'Nada a preencher. Quando todos assinam, toque em "Baixar contrato assinado".',
   'É o contrato original com uma página de evidências no fim: quem assinou, data e hora, IP, aparelho, a "impressão digital" (hash SHA-256) do documento e o código de verificação. Fica guardado nos anexos do próprio contrato.',
   'Contrato assinado eletronicamente - versao 1.pdf (anexos do contrato)',
   'Imprimir e assinar à mão por cima: o valor está no arquivo eletrônico e na página de evidências; guarde o PDF.', 11),
  ('ge.contrato.assinatura.gerar_pdf', 'Gerar o PDF assinado de novo',
   'Use só se o contrato aparece "Assinado por todos" mas o PDF assinado ainda não está nos anexos.',
   'O PDF assinado é montado na hora da última assinatura. Se naquele momento algo falhou, este botão monta de novo a partir do mesmo arquivo e dos mesmos registros — não muda nenhuma assinatura.',
   'Assinado por todos às 14:20, mas sem o anexo → Gerar PDF assinado.',
   'Achar que gerar de novo pede nova assinatura: não pede, os registros são os mesmos.', 12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
