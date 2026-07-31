-- F3 · Conector ATAK config-driven (Agente PS + Tela + Monitor).
-- Transforma o coletor artesanal (.env por máquina) em plug-and-play: a config
-- vive na nuvem (atak_conexao_config), a senha vive no Vault, e um Agente PS puxa
-- tudo por um token. Novo frigorífico entra pela tela; trocar servidor = editar 1
-- campo na nuvem (RD-52: fim do .env como fonte paralela).
--
-- Reusa (RD-26): atak_conexao_config, atak_fonte_mapa, fn_vault_ler_secret,
-- edge atak-ingest (que já grava heartbeat em erp_sync_log) e o detector
-- fn_atak_alerta_silencio. NÃO cria tabela de heartbeat paralela — o monitor lê
-- de erp_sync_log (fonte única).
--
-- Vault (Pilar 2): a senha entra SÓ por fn_atak_secret_set (SECURITY DEFINER);
-- nunca por MCP, nunca por .env, nunca no chat. A tela recebe só o vault_secret_name.

-- ── schema: config-driven precisa de identidade do agente + domínios + teste ──
ALTER TABLE public.atak_conexao_config
  ADD COLUMN IF NOT EXISTS agente_token text,
  ADD COLUMN IF NOT EXISTS dominios text[];
CREATE UNIQUE INDEX IF NOT EXISTS uq_atak_conexao_company ON public.atak_conexao_config(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atak_conexao_token   ON public.atak_conexao_config(agente_token) WHERE agente_token IS NOT NULL;

-- Teste de conexão é MEDIADO pelo agente (o SQL Server do cliente costuma estar em
-- rede privada — a nuvem não alcança 192.168.x.x). A tela solicita, o agente executa
-- SELECT 1 na LAN e responde. Estado honesto enquanto o agente não roda (RD-58).
CREATE TABLE IF NOT EXISTS public.atak_teste_conexao (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'solicitado',   -- solicitado | ok | erro
  resultado      text,
  solicitado_em  timestamptz NOT NULL DEFAULT now(),
  solicitado_por uuid,
  respondido_em  timestamptz
);
ALTER TABLE public.atak_teste_conexao ENABLE ROW LEVEL SECURITY;

-- ── fn_atak_secret_set · ÚNICO caminho da senha (Pilar 2 / Vault) ─────────────
CREATE OR REPLACE FUNCTION public.fn_atak_secret_set(p_company_id uuid, p_senha text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_name text; v_desc text; v_id uuid;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF p_senha IS NULL OR btrim(p_senha) = '' THEN RAISE EXCEPTION 'Senha vazia'; END IF;
  v_name := 'atak_pwd_' || replace(p_company_id::text, '-', '');
  v_desc := 'Senha ATAK (SQL Server) · company ' || p_company_id::text;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(new_secret => p_senha, new_name => v_name, new_description => v_desc);
  ELSE
    PERFORM vault.update_secret(secret_id => v_id, new_secret => p_senha, new_name => v_name, new_description => v_desc);
  END IF;
  RETURN v_name;
END $function$;
REVOKE ALL ON FUNCTION public.fn_atak_secret_set(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_secret_set(uuid, text) TO authenticated;

-- ── fn_atak_conexao_salvar · upsert da config (senha roteada pro Vault) ───────
CREATE OR REPLACE FUNCTION public.fn_atak_conexao_salvar(
  p_company_id uuid, p_host text, p_porta int, p_banco text, p_cod_filial text,
  p_usuario text, p_senha text DEFAULT NULL, p_dominios text[] DEFAULT NULL,
  p_sync_minuto int DEFAULT 15, p_ativo boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_secret text; v_token text; v_existe RECORD;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;

  SELECT vault_secret_name, agente_token INTO v_existe FROM atak_conexao_config WHERE company_id = p_company_id;
  v_secret := v_existe.vault_secret_name;
  v_token  := COALESCE(v_existe.agente_token,
                       replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''));

  IF p_senha IS NOT NULL AND btrim(p_senha) <> '' THEN
    v_secret := public.fn_atak_secret_set(p_company_id, p_senha);   -- senha só por aqui
  END IF;

  INSERT INTO atak_conexao_config
    (company_id, host, porta, banco, cod_filial, usuario, vault_secret_name, dominios, sync_minuto, ativo, agente_token)
  VALUES
    (p_company_id, p_host, p_porta, p_banco, p_cod_filial, p_usuario, v_secret, p_dominios, COALESCE(p_sync_minuto,15), COALESCE(p_ativo,true), v_token)
  ON CONFLICT (company_id) DO UPDATE SET
    host=EXCLUDED.host, porta=EXCLUDED.porta, banco=EXCLUDED.banco, cod_filial=EXCLUDED.cod_filial,
    usuario=EXCLUDED.usuario, vault_secret_name=EXCLUDED.vault_secret_name, dominios=EXCLUDED.dominios,
    sync_minuto=EXCLUDED.sync_minuto, ativo=EXCLUDED.ativo;

  RETURN json_build_object('ok', true, 'company_id', p_company_id, 'agente_token', v_token,
    'tem_senha', (v_secret IS NOT NULL), 'vault_secret_name', v_secret);
END $function$;
REVOKE ALL ON FUNCTION public.fn_atak_conexao_salvar(uuid,text,int,text,text,text,text,text[],int,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_conexao_salvar(uuid,text,int,text,text,text,text,text[],int,boolean) TO authenticated;

-- ── fn_atak_testar_conexao · solicita teste (o agente executa na LAN) ─────────
CREATE OR REPLACE FUNCTION public.fn_atak_testar_conexao(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM atak_conexao_config WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'Salve a conexão antes de testar'; END IF;
  INSERT INTO atak_teste_conexao (company_id, status, resultado, solicitado_em, solicitado_por, respondido_em)
  VALUES (p_company_id, 'solicitado', NULL, now(), auth.uid(), NULL)
  ON CONFLICT (company_id) DO UPDATE SET
    status='solicitado', resultado=NULL, solicitado_em=now(), solicitado_por=auth.uid(), respondido_em=NULL;
  RETURN json_build_object('ok', true, 'status', 'aguardando_agente',
    'mensagem', 'Teste solicitado — o Agente PS executa no próximo ciclo (SELECT 1 na rede do cliente).');
END $function$;
REVOKE ALL ON FUNCTION public.fn_atak_testar_conexao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_testar_conexao(uuid) TO authenticated;

-- ── fn_atak_teste_responder · o AGENTE responde o teste (por token) ──────────
CREATE OR REPLACE FUNCTION public.fn_atak_teste_responder(p_token text, p_ok boolean, p_mensagem text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM atak_conexao_config WHERE agente_token = p_token AND agente_token IS NOT NULL;
  IF v_company IS NULL THEN RETURN json_build_object('ok', false, 'erro', 'token inválido'); END IF;
  INSERT INTO atak_teste_conexao (company_id, status, resultado, respondido_em)
  VALUES (v_company, CASE WHEN p_ok THEN 'ok' ELSE 'erro' END, p_mensagem, now())
  ON CONFLICT (company_id) DO UPDATE SET
    status=EXCLUDED.status, resultado=EXCLUDED.resultado, respondido_em=now();
  RETURN json_build_object('ok', true, 'company_id', v_company);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_atak_teste_responder(text, boolean, text) TO anon, authenticated;

-- ── fn_atak_agente_config · o AGENTE puxa tudo por token (config + Vault) ─────
-- Modelo de credencial de dispositivo: o token É a credencial. Devolve a senha do
-- SQL Server (o agente precisa conectar) + os domínios/de-paras ativos + flag de
-- teste pendente. Token de alta entropia; conexão inativa não devolve nada.
CREATE OR REPLACE FUNCTION public.fn_atak_agente_config(p_token text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v RECORD; v_senha text; v_doms json; v_teste boolean;
BEGIN
  SELECT * INTO v FROM atak_conexao_config WHERE agente_token = p_token AND agente_token IS NOT NULL;
  IF NOT FOUND THEN RETURN json_build_object('erro', 'token inválido'); END IF;
  IF NOT v.ativo THEN RETURN json_build_object('erro', 'conexão inativa'); END IF;

  v_senha := public.fn_vault_ler_secret(v.vault_secret_name);

  SELECT json_agg(json_build_object(
      'dominio', fm.dominio, 'tabela_origem', fm.tabela_origem,
      'chave_fato_sql', fm.chave_fato_sql, 'coluna_watermark', fm.coluna_watermark
    ) ORDER BY fm.ordem)
    INTO v_doms
    FROM atak_fonte_mapa fm
   WHERE fm.ativo
     AND (v.dominios IS NULL OR fm.dominio = ANY(v.dominios));

  SELECT (status = 'solicitado') INTO v_teste FROM atak_teste_conexao WHERE company_id = v.company_id;

  RETURN json_build_object(
    'ok', true, 'company_id', v.company_id,
    'host', v.host, 'porta', v.porta, 'banco', v.banco,
    'cod_filial', v.cod_filial, 'usuario', v.usuario, 'senha', v_senha,
    'sync_minuto', v.sync_minuto, 'dominios', COALESCE(v_doms, '[]'::json),
    'teste_pendente', COALESCE(v_teste, false),
    'ingest_secret', public.fn_vault_ler_secret('atak_ingest_secret')
  );
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_atak_agente_config(text) TO anon, authenticated;

-- ── fn_atak_conexao_listar · tela: config + monitor (semáforo do erp_sync_log) ─
CREATE OR REPLACE FUNCTION public.fn_atak_conexao_listar(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v RECORD; v_last RECORD; v_ok_mx timestamptz; v_horas numeric; v_sem text; v_teste RECORD; v_nome text;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  SELECT * INTO v FROM atak_conexao_config WHERE company_id = p_company_id;
  SELECT COALESCE(nome_fantasia, razao_social) INTO v_nome FROM companies WHERE id = p_company_id;
  IF NOT FOUND OR v.company_id IS NULL THEN
    RETURN json_build_object('company_id', p_company_id, 'nome', v_nome, 'conexao', NULL);
  END IF;

  SELECT fase, iniciado_em, http_response, erro INTO v_last
    FROM erp_sync_log WHERE company_id = p_company_id AND trigger_type = 'coletor_atak'
    ORDER BY iniciado_em DESC LIMIT 1;
  SELECT max(iniciado_em) INTO v_ok_mx
    FROM erp_sync_log WHERE company_id = p_company_id AND trigger_type = 'coletor_atak' AND fase = 'sucesso';

  IF v_ok_mx IS NULL THEN v_sem := 'sem_dados';
  ELSE
    v_horas := round(extract(epoch FROM (now() - v_ok_mx))/3600, 1);
    v_sem := CASE WHEN v_horas <= 12 THEN 'verde' WHEN v_horas <= 26 THEN 'amarelo' ELSE 'vermelho' END;
  END IF;

  SELECT status, resultado, solicitado_em, respondido_em INTO v_teste FROM atak_teste_conexao WHERE company_id = p_company_id;

  RETURN json_build_object(
    'company_id', p_company_id, 'nome', v_nome,
    'conexao', json_build_object(
      'host', v.host, 'porta', v.porta, 'banco', v.banco, 'cod_filial', v.cod_filial,
      'usuario', v.usuario, 'dominios', v.dominios, 'sync_minuto', v.sync_minuto,
      'ativo', v.ativo, 'tem_senha', (v.vault_secret_name IS NOT NULL), 'agente_token', v.agente_token),
    'monitor', json_build_object(
      'semaforo', v_sem, 'ultimo_sucesso', v_ok_mx, 'horas_desde_sucesso', v_horas,
      'ultima_fase', v_last.fase, 'ultimo_erro', v_last.erro,
      'ultimo_host', v_last.http_response->>'host', 'ultima_versao', v_last.http_response->>'collector_version',
      'ultimo_dominio', v_last.http_response->>'dominio', 'ultimos_gravados', (v_last.http_response->>'gravados')),
    'teste', CASE WHEN v_teste IS NULL THEN NULL ELSE json_build_object(
      'status', v_teste.status, 'resultado', v_teste.resultado,
      'solicitado_em', v_teste.solicitado_em, 'respondido_em', v_teste.respondido_em) END
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_atak_conexao_listar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_conexao_listar(uuid) TO authenticated;

-- RLS mínima na tabela de teste: leitura só do próprio escopo (a escrita é via RPCs SECURITY DEFINER).
DROP POLICY IF EXISTS atak_teste_sel ON public.atak_teste_conexao;
CREATE POLICY atak_teste_sel ON public.atak_teste_conexao FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
