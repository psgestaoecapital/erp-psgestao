-- ============================================================
-- SST · #74 · assinatura da ciência mensal por link público (espelha INTEGRALMENTE o padrão EPI)
-- ============================================================
-- Decisão do CEO: copiar o padrão EPI inteiro, sem simplificar. Ganhos que o SPEC não previa e que
-- dão validade à assinatura eletrônica (Lei 14.063/2020):
--   • token + expires_at + status; envio por WhatsApp (wa.me) já no padrão;
--   • visualizado_em/ip/user_agent — registra a ABERTURA do documento, não só a assinatura
--     (numa fiscalização, "apresentei e ele abriu mas não assinou" vale mais que só a recusa);
--   • código de confirmação (CPF) + geolocalização + foto na confirmação.
-- Mesma arquitetura do EPI: página pública (anon) → RPCs SECURITY DEFINER com GRANT a anon; o token
-- é o segredo portador; nenhuma tabela sensível exposta a anon (o payload de leitura vem da RPC).

CREATE TABLE IF NOT EXISTS public.nr36_ciencia_assinatura_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  ciencia_id     uuid NOT NULL REFERENCES public.nr36_ciencia_mensal(id) ON DELETE CASCADE,
  token          text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado_whatsapp','visualizado','assinado','recusado','expirado','cancelado')),
  whatsapp_telefone        text,
  whatsapp_link_gerado_em  timestamptz,
  whatsapp_link_url        text,
  whatsapp_enviado_em      timestamptz,
  visualizado_em           timestamptz,
  visualizado_ip           inet,
  visualizado_user_agent   text,
  assinado_em    timestamptz,
  criado_por     uuid,
  observacao     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nr36_ciencia_token_ciencia ON public.nr36_ciencia_assinatura_tokens (ciencia_id);
ALTER TABLE public.nr36_ciencia_assinatura_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_ciencia_tok_sel ON public.nr36_ciencia_assinatura_tokens;
CREATE POLICY nr36_ciencia_tok_sel ON public.nr36_ciencia_assinatura_tokens FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- (1) GERAR LINK (autenticado) — cria token e devolve url + link WhatsApp
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar_link(p_ciencia_id uuid, p_whatsapp_telefone text DEFAULT NULL)
 RETURNS TABLE(token text, url_assinatura text, whatsapp_link text, whatsapp_mensagem text, expires_at timestamptz, colaborador_nome text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_c record; v_token text; v_url text; v_msg text; v_fone text; v_exp timestamptz;
BEGIN
  SELECT cm.company_id, cm.colaborador_snapshot->>'nome' AS nome, cm.competencia, cm.status
    INTO v_c FROM public.nr36_ciencia_mensal cm WHERE cm.id = p_ciencia_id;
  IF v_c IS NULL THEN RAISE EXCEPTION 'ciencia_nao_encontrada'; END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'sem_acesso' USING errcode='42501'; END IF;

  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(24),'base64'),'/','_'),'+','-'),'=','');
  v_fone := regexp_replace(COALESCE(p_whatsapp_telefone,''),'[^0-9]','','g');
  IF v_fone <> '' AND length(v_fone) IN (10,11) THEN v_fone := '55'||v_fone; END IF;

  INSERT INTO public.nr36_ciencia_assinatura_tokens (company_id, ciencia_id, token, whatsapp_telefone, criado_por, whatsapp_link_gerado_em, status)
  VALUES (v_c.company_id, p_ciencia_id, v_token, NULLIF(v_fone,''), auth.uid(), now(), CASE WHEN v_fone<>'' THEN 'enviado_whatsapp' ELSE 'pendente' END)
  RETURNING nr36_ciencia_assinatura_tokens.expires_at INTO v_exp;

  v_url := 'https://erp-psgestao.vercel.app/sign/nr36/' || v_token;
  v_msg := 'Ola, ' || COALESCE(v_c.nome,'') || '. Segue o relatorio mensal de pausas termicas (' ||
           to_char(v_c.competencia,'MM/YYYY') || ') para sua ciencia e assinatura: ' || v_url ||
           ' (Lei 14.063/2020 - assinatura eletronica).';
  UPDATE public.nr36_ciencia_assinatura_tokens SET whatsapp_link_url = CASE WHEN v_fone<>'' THEN 'https://wa.me/'||v_fone||'?text='||replace(replace(v_msg,' ','%20'),E'\n','%0A') ELSE NULL END
   WHERE nr36_ciencia_assinatura_tokens.token = v_token;

  RETURN QUERY SELECT v_token, v_url,
    CASE WHEN v_fone<>'' THEN 'https://wa.me/'||v_fone||'?text='||replace(replace(v_msg,' ','%20'),E'\n','%0A') ELSE NULL END,
    v_msg, v_exp, v_c.nome;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar_link(uuid, text) TO authenticated;

-- (2) MARCAR VISUALIZADO (público/anon) — registra a ABERTURA e devolve o documento p/ render
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_marcar_visualizado(p_token text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
 RETURNS TABLE(token_id uuid, company_id uuid, colaborador jsonb, competencia date, periodo_inicio date, periodo_fim date,
               resumo jsonb, detalhe jsonb, documento_hash text, expires_at timestamptz, expirado boolean, ja_assinado boolean, recusado boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_t record; v_cm record;
BEGIN
  SELECT * INTO v_t FROM public.nr36_ciencia_assinatura_tokens WHERE token = p_token;
  IF v_t IS NULL THEN RAISE EXCEPTION 'token_nao_encontrado'; END IF;
  SELECT * INTO v_cm FROM public.nr36_ciencia_mensal WHERE id = v_t.ciencia_id;
  IF v_t.visualizado_em IS NULL THEN
    UPDATE public.nr36_ciencia_assinatura_tokens
       SET visualizado_em = now(), visualizado_ip = p_ip, visualizado_user_agent = p_user_agent,
           status = CASE WHEN status IN ('pendente','enviado_whatsapp') THEN 'visualizado' ELSE status END, updated_at = now()
     WHERE id = v_t.id;
  END IF;
  RETURN QUERY SELECT v_t.id, v_t.company_id, v_cm.colaborador_snapshot, v_cm.competencia, v_cm.periodo_inicio, v_cm.periodo_fim,
    v_cm.resumo, v_cm.detalhe, v_cm.documento_hash, v_t.expires_at,
    (v_t.expires_at < now()), (v_cm.status = 'assinado'), (v_cm.status = 'recusado');
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_marcar_visualizado(text, inet, text) TO anon, authenticated;

-- (3) CONFIRMAR ASSINATURA (público/anon) — CPF confere, hash sha256, grava na ciência
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_confirmar_assinatura(
  p_token text, p_codigo_confirmacao text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL,
  p_geolocalizacao jsonb DEFAULT NULL, p_foto_url text DEFAULT NULL)
 RETURNS TABLE(sucesso boolean, assinatura_hash text, mensagem text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_t record; v_cm record; v_cpf_doc text; v_cpf_in text; v_hash text;
BEGIN
  SELECT * INTO v_t FROM public.nr36_ciencia_assinatura_tokens WHERE token = p_token;
  IF v_t IS NULL THEN RETURN QUERY SELECT false, NULL::text, 'Link inválido.'; RETURN; END IF;
  IF v_t.expires_at < now() THEN RETURN QUERY SELECT false, NULL::text, 'Link expirado. Solicite um novo ao gestor.'; RETURN; END IF;
  SELECT * INTO v_cm FROM public.nr36_ciencia_mensal WHERE id = v_t.ciencia_id;
  IF v_cm.status = 'assinado' THEN RETURN QUERY SELECT false, NULL::text, 'Documento já assinado.'; RETURN; END IF;

  v_cpf_doc := regexp_replace(COALESCE(v_cm.colaborador_snapshot->>'cpf',''),'[^0-9]','','g');
  v_cpf_in  := regexp_replace(COALESCE(p_codigo_confirmacao,''),'[^0-9]','','g');
  IF v_cpf_doc = '' OR v_cpf_in <> v_cpf_doc THEN
    RETURN QUERY SELECT false, NULL::text, 'CPF não confere. Verifique e tente novamente.'; RETURN; END IF;

  v_hash := encode(extensions.digest(v_t.id::text || p_token || v_cm.cpf || v_cm.documento_hash || COALESCE(p_ip::text,'') || COALESCE(p_user_agent,'') || now()::text, 'sha256'),'hex');

  UPDATE public.nr36_ciencia_mensal SET
    status = 'assinado', assinado_em = now(), metodo = 'ciencia_link_token',
    assinatura_dados = jsonb_build_object('token_value', p_token, 'codigo_validado','cpf',
      'lei_aplicavel','14.063/2020', 'tipo_assinatura','eletronica_simples',
      'geolocalizacao', p_geolocalizacao, 'foto_url', p_foto_url, 'documento_hash', v_cm.documento_hash),
    hash_integridade = v_hash, ip_origem = p_ip, user_agent = p_user_agent, updated_at = now()
   WHERE id = v_cm.id;
  UPDATE public.nr36_ciencia_assinatura_tokens SET status = 'assinado', assinado_em = now(), updated_at = now() WHERE id = v_t.id;

  RETURN QUERY SELECT true, v_hash, 'Ciência registrada com sucesso.';
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_confirmar_assinatura(text, text, inet, text, jsonb, text) TO anon, authenticated;

-- (4) ANEXAR ASSINADO (autenticado) — upload do PDF assinado no papel (bucket compliance-pausas)
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_anexar_assinado(p_id uuid, p_arquivo_url text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.nr36_ciencia_mensal WHERE id = p_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.nr36_ciencia_mensal
     SET arquivo_assinado_url = p_arquivo_url,
         status = CASE WHEN status <> 'recusado' THEN 'assinado' ELSE status END,
         assinado_em = COALESCE(assinado_em, now()),
         metodo = COALESCE(metodo, 'upload_assinado_papel'), updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_anexar_assinado(uuid, text) TO authenticated;
