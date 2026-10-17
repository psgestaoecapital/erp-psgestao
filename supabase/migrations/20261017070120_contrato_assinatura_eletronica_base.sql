-- #2936 (etapa 1) · Assinatura eletrônica de contratos — BASE NO BANCO (todas as empresas; prova na Pdois).
-- Decisão do CEO 16/10 (delegada à Jordana). Etapas seguintes: 2 = botão "Enviar para assinatura" no contrato + página
-- pública de assinatura (rota do servidor) + envio do link/código por WhatsApp/e-mail; 3 = PDF assinado com página de
-- evidências arquivado em erp_contratos_arquivos; 4 = verificação pública; 5 = lembretes. Ponto de integração ICP-Brasil
-- reservado (coluna provedor), sem construir agora.
--
-- ADITIVA: 2 tabelas novas (RLS por empresa, sem escrita direta), funções novas. Nenhuma função/view/policy existente muda.
-- LGPD: o link é um token aleatório guardado só como hash; o código de confirmação (2º fator) idem, com validade e limite
-- de tentativas; geolocalização só é gravada com consentimento expresso; as funções do signatário (abrir, código, assinar,
-- verificar) NÃO são expostas ao anon/authenticated — só a rota do servidor (service_role) as chama.

-- ───────────────────────────── Tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_contrato_assinatura_envio (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  contrato_id          uuid NOT NULL REFERENCES public.erp_contratos(id) ON DELETE CASCADE,
  versao               int  NOT NULL,
  documento_hash       text NOT NULL CHECK (documento_hash ~ '^[0-9a-f]{64}$'),
  documento_path       text,
  status               text NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','assinado','cancelado','expirado')),
  codigo_verificacao   text NOT NULL UNIQUE,
  provedor             text NOT NULL DEFAULT 'interno' CHECK (provedor IN ('interno','icp_brasil')),
  expira_em            timestamptz NOT NULL,
  criado_por           uuid,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  cancelado_em         timestamptz,
  cancelado_motivo     text,
  concluido_em         timestamptz,
  UNIQUE (contrato_id, versao)
);
CREATE INDEX IF NOT EXISTS idx_contrato_assin_envio_contrato ON public.erp_contrato_assinatura_envio (contrato_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_contrato_assin_envio_empresa ON public.erp_contrato_assinatura_envio (company_id, status);

CREATE TABLE IF NOT EXISTS public.erp_contrato_assinatura_signatario (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id              uuid NOT NULL REFERENCES public.erp_contrato_assinatura_envio(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL,
  ordem                 smallint NOT NULL DEFAULT 1,
  papel                 text NOT NULL DEFAULT 'cliente' CHECK (papel IN ('cliente','empresa','testemunha')),
  nome                  text NOT NULL CHECK (length(btrim(nome)) >= 3),
  documento             text NOT NULL CHECK (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  email                 text,
  telefone              text,
  token_hash            text NOT NULL UNIQUE,
  status                text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','visualizado','assinado','cancelado')),
  codigo_hash           text,
  codigo_expira_em      timestamptz,
  codigo_tentativas     smallint NOT NULL DEFAULT 0,
  codigo_enviados       smallint NOT NULL DEFAULT 0,
  visualizado_em        timestamptz,
  visualizado_ip        inet,
  visualizado_user_agent text,
  assinado_em           timestamptz,
  assinatura_metodo     text CHECK (assinatura_metodo IN ('aceite','desenho')),
  assinatura_imagem_path text,
  assinatura_ip         inet,
  assinatura_user_agent text,
  geo_consentido        boolean NOT NULL DEFAULT false,
  geolocalizacao        jsonb,
  documento_hash_assinado text,
  CONSTRAINT ck_assin_geo_so_com_consentimento CHECK (geolocalizacao IS NULL OR geo_consentido),
  CONSTRAINT ck_assin_contato CHECK (email IS NOT NULL OR telefone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_contrato_assin_sig_envio ON public.erp_contrato_assinatura_signatario (envio_id, ordem);

ALTER TABLE public.erp_contrato_assinatura_envio      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_contrato_assinatura_signatario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contrato_assin_envio_select ON public.erp_contrato_assinatura_envio;
CREATE POLICY contrato_assin_envio_select ON public.erp_contrato_assinatura_envio
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS contrato_assin_sig_select ON public.erp_contrato_assinatura_signatario;
CREATE POLICY contrato_assin_sig_select ON public.erp_contrato_assinatura_signatario
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_contrato_assinatura_envio, public.erp_contrato_assinatura_signatario FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.erp_contrato_assinatura_envio, public.erp_contrato_assinatura_signatario FROM authenticated;
GRANT SELECT ON public.erp_contrato_assinatura_envio TO authenticated;
-- o hash do link e do código não sai para a tela (nem por SELECT da própria empresa): SELECT só nas colunas abaixo
REVOKE SELECT ON public.erp_contrato_assinatura_signatario FROM authenticated;
GRANT SELECT (id, envio_id, company_id, ordem, papel, nome, documento, email, telefone, status, codigo_expira_em,
  codigo_tentativas, codigo_enviados, visualizado_em, visualizado_ip, visualizado_user_agent, assinado_em, assinatura_metodo,
  assinatura_imagem_path, assinatura_ip, assinatura_user_agent, geo_consentido, geolocalizacao, documento_hash_assinado)
  ON public.erp_contrato_assinatura_signatario TO authenticated;
GRANT ALL ON public.erp_contrato_assinatura_envio, public.erp_contrato_assinatura_signatario TO service_role;

-- ───────────────────────────── Helpers ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_contrato_assin__sha256(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'extensions' AS $$
  SELECT encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__sha256(text) FROM anon, public, authenticated;

-- Concluir o envio quando todos assinaram (chamada pelas funções abaixo).
CREATE OR REPLACE FUNCTION public.fn_contrato_assin__concluir(p_envio_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e record;
BEGIN
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = p_envio_id FOR UPDATE;
  IF NOT FOUND OR v_e.status <> 'aguardando' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_contrato_assinatura_signatario WHERE envio_id = p_envio_id AND status <> 'assinado') THEN
    RETURN false;
  END IF;
  UPDATE public.erp_contrato_assinatura_envio SET status = 'assinado', concluido_em = now() WHERE id = p_envio_id;
  INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata)
  VALUES (v_e.contrato_id, v_e.company_id, 'assinatura_concluida',
          'Contrato assinado eletronicamente por todos os signatários (versão ' || v_e.versao || ')',
          jsonb_build_object('envio_id', v_e.id, 'versao', v_e.versao, 'documento_hash', v_e.documento_hash,
                             'codigo_verificacao', v_e.codigo_verificacao));
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__concluir(uuid) FROM anon, public, authenticated;

-- ───────────────────────────── Lado da empresa (usuário logado) ─────────────────────────────
-- Cria o envio (nova versão invalida o envio anterior em aberto) e devolve o link (token) de cada signatário UMA vez.
CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_enviar(
  p_contrato_id uuid, p_documento_hash text, p_documento_path text, p_signatarios jsonb, p_validade_dias int DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_c record; v_envio uuid; v_versao int; v_codigo text; v_s jsonb; v_token text; v_doc text; v_links jsonb := '[]'::jsonb;
  v_ordem int := 0; v_sig uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id, status INTO v_c FROM public.erp_contratos WHERE id = p_contrato_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_c.company_id);
  IF v_c.status IN ('cancelado','encerrado','excluido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato cancelado/encerrado não vai para assinatura');
  END IF;
  IF p_documento_hash IS NULL OR p_documento_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Hash SHA-256 do documento inválido');
  END IF;
  IF p_signatarios IS NULL OR jsonb_typeof(p_signatarios) <> 'array' OR jsonb_array_length(p_signatarios) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe pelo menos um signatário');
  END IF;
  IF jsonb_array_length(p_signatarios) > 10 THEN RETURN jsonb_build_object('ok', false, 'erro', 'No máximo 10 signatários'); END IF;
  IF p_validade_dias IS NULL OR p_validade_dias < 1 OR p_validade_dias > 60 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Validade do link entre 1 e 60 dias');
  END IF;

  -- nova versão invalida o envio anterior em aberto (o link antigo deixa de valer)
  UPDATE public.erp_contrato_assinatura_signatario s SET status = 'cancelado'
    FROM public.erp_contrato_assinatura_envio e
   WHERE s.envio_id = e.id AND e.contrato_id = p_contrato_id AND e.status = 'aguardando' AND s.status <> 'assinado';
  UPDATE public.erp_contrato_assinatura_envio SET status = 'cancelado', cancelado_em = now(),
         cancelado_motivo = 'Substituído por nova versão'
   WHERE contrato_id = p_contrato_id AND status = 'aguardando';

  SELECT COALESCE(max(versao), 0) + 1 INTO v_versao FROM public.erp_contrato_assinatura_envio WHERE contrato_id = p_contrato_id;
  v_codigo := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  INSERT INTO public.erp_contrato_assinatura_envio (company_id, contrato_id, versao, documento_hash, documento_path,
         codigo_verificacao, expira_em, criado_por)
  VALUES (v_c.company_id, p_contrato_id, v_versao, p_documento_hash, NULLIF(btrim(COALESCE(p_documento_path, '')), ''),
          v_codigo, now() + make_interval(days => p_validade_dias), auth.uid())
  RETURNING id INTO v_envio;

  FOR v_s IN SELECT * FROM jsonb_array_elements(p_signatarios) LOOP
    v_ordem := v_ordem + 1;
    v_doc := regexp_replace(COALESCE(v_s->>'documento', ''), '\D', '', 'g');
    IF length(btrim(COALESCE(v_s->>'nome', ''))) < 3 THEN RAISE EXCEPTION 'Signatário %: informe o nome', v_ordem USING ERRCODE = '22023'; END IF;
    IF v_doc !~ '^([0-9]{11}|[0-9]{14})$' THEN RAISE EXCEPTION 'Signatário %: CPF/CNPJ inválido', v_ordem USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(COALESCE(v_s->>'email', '')), '') IS NULL AND NULLIF(btrim(COALESCE(v_s->>'telefone', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Signatário %: informe e-mail ou WhatsApp', v_ordem USING ERRCODE = '22023';
    END IF;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.erp_contrato_assinatura_signatario (envio_id, company_id, ordem, papel, nome, documento, email, telefone, token_hash)
    VALUES (v_envio, v_c.company_id, v_ordem, COALESCE(NULLIF(v_s->>'papel', ''), 'cliente'), btrim(v_s->>'nome'), v_doc,
            NULLIF(btrim(COALESCE(v_s->>'email', '')), ''), NULLIF(regexp_replace(COALESCE(v_s->>'telefone', ''), '\D', '', 'g'), ''),
            public.fn_contrato_assin__sha256(v_token))
    RETURNING id INTO v_sig;
    v_links := v_links || jsonb_build_object('signatario_id', v_sig, 'nome', btrim(v_s->>'nome'), 'token', v_token);
  END LOOP;

  INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id)
  VALUES (p_contrato_id, v_c.company_id, 'assinatura_enviada',
          'Enviado para assinatura eletrônica (versão ' || v_versao || ', ' || v_ordem || ' signatário(s))',
          jsonb_build_object('envio_id', v_envio, 'versao', v_versao, 'documento_hash', p_documento_hash), auth.uid());

  RETURN jsonb_build_object('ok', true, 'envio_id', v_envio, 'versao', v_versao, 'codigo_verificacao', v_codigo, 'links', v_links);
END $$;

CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_cancelar(p_envio_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = p_envio_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Envio não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_e.company_id);
  IF v_e.status <> 'aguardando' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só envio aguardando assinatura pode ser cancelado'); END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo'); END IF;
  UPDATE public.erp_contrato_assinatura_signatario SET status = 'cancelado' WHERE envio_id = p_envio_id AND status <> 'assinado';
  UPDATE public.erp_contrato_assinatura_envio SET status = 'cancelado', cancelado_em = now(), cancelado_motivo = btrim(p_motivo)
   WHERE id = p_envio_id;
  INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id)
  VALUES (v_e.contrato_id, v_e.company_id, 'assinatura_cancelada', 'Envio para assinatura cancelado: ' || btrim(p_motivo),
          jsonb_build_object('envio_id', p_envio_id, 'versao', v_e.versao), auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;

-- ───────────────────────────── Lado do signatário (SÓ a rota do servidor, service_role) ─────────────────────────────
-- Signatário válido pelo token: envio aguardando, dentro da validade, signatário não cancelado.
CREATE OR REPLACE FUNCTION public.fn_contrato_assin__por_token(p_token text)
RETURNS public.erp_contrato_assinatura_signatario LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s public.erp_contrato_assinatura_signatario; v_e record;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{48}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM public.erp_contrato_assinatura_signatario WHERE token_hash = public.fn_contrato_assin__sha256(p_token);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT status, expira_em INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = v_s.envio_id;
  IF v_e.status = 'aguardando' AND v_e.expira_em < now() THEN
    UPDATE public.erp_contrato_assinatura_envio SET status = 'expirado' WHERE id = v_s.envio_id;
    RETURN NULL;
  END IF;
  IF v_e.status NOT IN ('aguardando','assinado') OR v_s.status = 'cancelado' THEN RETURN NULL; END IF;
  RETURN v_s;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__por_token(text) FROM anon, public, authenticated;

CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_abrir(p_token text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s public.erp_contrato_assinatura_signatario; v_e record; v_c record;
BEGIN
  v_s := public.fn_contrato_assin__por_token(p_token);
  IF v_s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Link inválido, vencido ou substituído por uma nova versão'); END IF;
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = v_s.envio_id;
  SELECT c.numero, c.nome, co.razao_social AS empresa INTO v_c
    FROM public.erp_contratos c LEFT JOIN public.companies co ON co.id = c.company_id WHERE c.id = v_e.contrato_id;
  IF v_s.status = 'pendente' THEN
    UPDATE public.erp_contrato_assinatura_signatario
       SET status = 'visualizado', visualizado_em = now(), visualizado_ip = p_ip, visualizado_user_agent = left(p_user_agent, 500)
     WHERE id = v_s.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'signatario_id', v_s.id, 'nome', v_s.nome, 'papel', v_s.papel,
    'ja_assinado', v_s.status = 'assinado', 'contrato_numero', v_c.numero, 'contrato_nome', v_c.nome, 'empresa', v_c.empresa,
    'documento_path', v_e.documento_path, 'documento_hash', v_e.documento_hash, 'versao', v_e.versao, 'expira_em', v_e.expira_em,
    'tem_email', v_s.email IS NOT NULL, 'tem_whatsapp', v_s.telefone IS NOT NULL);
END $$;

-- Gera o código de confirmação (2º fator, 6 dígitos, 10 min). Devolve o código e o contato para a ROTA enviar; nunca à tela.
CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_codigo(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_s public.erp_contrato_assinatura_signatario; v_codigo text;
BEGIN
  v_s := public.fn_contrato_assin__por_token(p_token);
  IF v_s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Link inválido, vencido ou substituído por uma nova versão'); END IF;
  IF v_s.status = 'assinado' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Este documento já foi assinado por você'); END IF;
  IF v_s.codigo_enviados >= 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Limite de códigos atingido; peça um novo link à empresa'); END IF;
  v_codigo := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  UPDATE public.erp_contrato_assinatura_signatario
     SET codigo_hash = public.fn_contrato_assin__sha256(v_s.id::text || ':' || v_codigo),
         codigo_expira_em = now() + interval '10 minutes', codigo_tentativas = 0, codigo_enviados = codigo_enviados + 1
   WHERE id = v_s.id;
  RETURN jsonb_build_object('ok', true, 'codigo', v_codigo, 'email', v_s.email, 'telefone', v_s.telefone, 'nome', v_s.nome);
END $$;

-- Assina: confere o código, o CPF/CNPJ do signatário, o aceite dos termos e o hash do documento exibido.
CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_assinar(
  p_token text, p_codigo text, p_documento text, p_aceite boolean, p_documento_hash text,
  p_metodo text DEFAULT 'aceite', p_assinatura_imagem_path text DEFAULT NULL,
  p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL, p_geo_consentido boolean DEFAULT false, p_geolocalizacao jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s public.erp_contrato_assinatura_signatario; v_e record; v_concluiu boolean;
BEGIN
  v_s := public.fn_contrato_assin__por_token(p_token);
  IF v_s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Link inválido, vencido ou substituído por uma nova versão'); END IF;
  IF v_s.status = 'assinado' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Este documento já foi assinado por você'); END IF;
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio WHERE id = v_s.envio_id;
  IF v_s.codigo_hash IS NULL OR v_s.codigo_expira_em < now() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Código vencido: peça um novo código');
  END IF;
  IF v_s.codigo_tentativas >= 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Muitas tentativas: peça um novo código'); END IF;
  IF public.fn_contrato_assin__sha256(v_s.id::text || ':' || COALESCE(btrim(p_codigo), '')) <> v_s.codigo_hash THEN
    UPDATE public.erp_contrato_assinatura_signatario SET codigo_tentativas = codigo_tentativas + 1 WHERE id = v_s.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'Código incorreto');
  END IF;
  IF regexp_replace(COALESCE(p_documento, ''), '\D', '', 'g') <> v_s.documento THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'CPF/CNPJ não confere com o do signatário');
  END IF;
  IF p_aceite IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok', false, 'erro', 'É preciso aceitar os termos para assinar'); END IF;
  IF p_documento_hash IS DISTINCT FROM v_e.documento_hash THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O documento mudou desde que o link foi enviado; peça a versão atual');
  END IF;
  IF COALESCE(p_metodo, 'aceite') NOT IN ('aceite','desenho') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Método de assinatura inválido'); END IF;
  IF p_metodo = 'desenho' AND NULLIF(btrim(COALESCE(p_assinatura_imagem_path, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Desenhe a assinatura');
  END IF;

  UPDATE public.erp_contrato_assinatura_signatario
     SET status = 'assinado', assinado_em = now(), assinatura_metodo = COALESCE(p_metodo, 'aceite'),
         assinatura_imagem_path = CASE WHEN p_metodo = 'desenho' THEN btrim(p_assinatura_imagem_path) END,
         assinatura_ip = p_ip, assinatura_user_agent = left(p_user_agent, 500),
         geo_consentido = COALESCE(p_geo_consentido, false),
         geolocalizacao = CASE WHEN COALESCE(p_geo_consentido, false) THEN p_geolocalizacao END,
         documento_hash_assinado = v_e.documento_hash, codigo_hash = NULL, codigo_expira_em = NULL
   WHERE id = v_s.id;
  INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata)
  VALUES (v_e.contrato_id, v_e.company_id, 'assinatura_signatario',
          v_s.nome || ' assinou eletronicamente (versão ' || v_e.versao || ')',
          jsonb_build_object('envio_id', v_e.id, 'signatario_id', v_s.id, 'documento_hash', v_e.documento_hash));
  v_concluiu := public.fn_contrato_assin__concluir(v_e.id);
  RETURN jsonb_build_object('ok', true, 'todos_assinaram', v_concluiu, 'codigo_verificacao', v_e.codigo_verificacao);
END $$;

-- Verificação pública por código ou hash: só o necessário (LGPD — nome mascarado, sem CPF/CNPJ, IP ou geolocalização).
CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_verificar(p_codigo_ou_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_q text := lower(btrim(COALESCE(p_codigo_ou_hash, ''))); v_e record;
BEGIN
  IF v_q = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o código ou o hash'); END IF;
  SELECT * INTO v_e FROM public.erp_contrato_assinatura_envio
   WHERE lower(codigo_verificacao) = v_q OR documento_hash = v_q
   ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'encontrado', false); END IF;
  RETURN jsonb_build_object('ok', true, 'encontrado', true, 'status', v_e.status, 'versao', v_e.versao,
    'documento_hash', v_e.documento_hash, 'concluido_em', v_e.concluido_em,
    'signatarios', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nome', split_part(s.nome, ' ', 1) || CASE WHEN position(' ' IN btrim(s.nome)) > 0 THEN ' ' || left(split_part(btrim(s.nome), ' ', array_length(string_to_array(btrim(s.nome), ' '), 1)), 1) || '.' ELSE '' END,
        'papel', s.papel, 'status', s.status, 'assinado_em', s.assinado_em) ORDER BY s.ordem), '[]'::jsonb)
      FROM public.erp_contrato_assinatura_signatario s WHERE s.envio_id = v_e.id));
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_enviar(uuid, text, text, jsonb, int) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_cancelar(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_enviar(uuid, text, text, jsonb, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_cancelar(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_abrir(text, inet, text) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_codigo(text) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_assinar(text, text, text, boolean, text, text, text, inet, text, boolean, jsonb) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_verificar(text) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_abrir(text, inet, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_codigo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_assinar(text, text, text, boolean, text, text, text, inet, text, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_verificar(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assin__sha256(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assin__concluir(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assin__por_token(text) TO service_role;

-- Assinatura pelo signatário externo (link com token público, sem usuário logado): a empresa vem do envio que o token
-- identifica, e o acesso é só pela rota do servidor com service_role (REVOKE de anon/authenticated acima).
-- ci-sem-guarda: fn_contrato_assin__concluir — interna, só service_role; chamada pelo assinar depois do último signatário (a empresa vem do envio)
-- ci-sem-guarda: fn_contrato_assin__por_token — interna, só service_role; localiza o signatário pelo hash do token público (sem usuário logado)
-- ci-sem-guarda: fn_contrato_assinatura_abrir — só service_role; signatário externo abre pelo token público, sem usuário logado (a empresa vem do envio)
-- ci-sem-guarda: fn_contrato_assinatura_codigo — só service_role; gera o código OTP do signatário externo pelo token público, sem usuário logado
-- ci-sem-guarda: fn_contrato_assinatura_assinar — só service_role; signatário externo assina pelo token público + OTP, sem usuário logado
