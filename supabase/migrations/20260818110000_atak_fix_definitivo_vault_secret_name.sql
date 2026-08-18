-- ATAK · fix DEFINITIVO: vault_secret_name nunca era setado (causa raiz do sem_config) + ingest_secret
--          + watermark/full-refresh + checklist de onboarding (RD-41, causa das ~20 tentativas)
--
-- CAUSA RAIZ (auditada): fn_atak_secret_set grava a senha no vault (atak_pwd_{company}) e RETORNA o nome,
-- mas nunca faz o UPDATE do vault_secret_name na config. Quando a senha é salva SEPARADO da conexão
-- (chamada direta a fn_atak_secret_set), a config fica vault_secret_name=NULL → fn_atak_agente_config lê
-- fn_vault_ler_secret(NULL) → vazio → sem_config. (fn_atak_conexao_salvar seta via o retorno, mas o caminho
-- "salvar só a senha" não passa por lá.) É um UPDATE que faltava — não erro de operador.

-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 1 · o elo senha↔config: secret_set passa a setar vault_secret_name (blinda os dois caminhos)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_atak_secret_set(p_company_id uuid, p_senha text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
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
  -- ELO QUE FALTAVA (causa raiz): toda vez que a senha é salva, a config passa a apontar pro secret.
  UPDATE atak_conexao_config SET vault_secret_name = v_name WHERE company_id = p_company_id;
  RETURN v_name;
END $function$;

-- Backfill defensivo: cura quem JÁ salvou a senha (secret existe) mas ficou com vault_secret_name=NULL.
UPDATE public.atak_conexao_config c
   SET vault_secret_name = 'atak_pwd_' || replace(c.company_id::text, '-', '')
 WHERE c.vault_secret_name IS NULL
   AND EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'atak_pwd_' || replace(c.company_id::text, '-', ''));

-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 2 · atak_ingest_secret (global, segredo PS do canal de ingestão) — não existia no vault
--         valor forte gerado no deploy (não fica no repo); só cria se faltar.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'atak_ingest_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'atak_ingest_secret',
      'Canal de ingestao ATAK (global · segredo PS)');
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 3 · domínios sem watermark: declara full-refresh (snapshots/dimensões · coleta cheia por ciclo).
--         Os 4 sem watermark sao dimensao/views-snapshot (tbProduto, vwProdutoSaldoDisponivel,
--         vwWMS_CamaraFriaPosicaoArmazenada, VW_SIFPOA com chave HASH_ROW) → full-refresh e o correto.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.atak_fonte_mapa ADD COLUMN IF NOT EXISTS full_refresh boolean NOT NULL DEFAULT false;
UPDATE public.atak_fonte_mapa
   SET full_refresh = true
 WHERE coluna_watermark IS NULL
   AND dominio IN ('embalagem', 'estoque_disponivel', 'camara_fria', 'sif_condenacao');

-- fn_atak_agente_config passa a expor full_refresh por domínio (o agente pode fazer coleta cheia).
CREATE OR REPLACE FUNCTION public.fn_atak_agente_config(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v RECORD; v_senha text; v_doms json; v_teste boolean;
BEGIN
  SELECT * INTO v FROM atak_conexao_config WHERE agente_token = p_token AND agente_token IS NOT NULL;
  IF NOT FOUND THEN RETURN json_build_object('erro', 'token inválido'); END IF;
  IF NOT v.ativo THEN RETURN json_build_object('erro', 'conexão inativa'); END IF;
  v_senha := public.fn_vault_ler_secret(v.vault_secret_name);
  SELECT json_agg(json_build_object(
      'dominio', fm.dominio, 'tabela_origem', fm.tabela_origem,
      'chave_fato_sql', fm.chave_fato_sql, 'coluna_watermark', fm.coluna_watermark,
      'full_refresh', fm.full_refresh
    ) ORDER BY fm.ordem)
    INTO v_doms
    FROM atak_fonte_mapa fm
   WHERE fm.ativo AND (v.dominios IS NULL OR fm.dominio = ANY(v.dominios));
  SELECT (status = 'solicitado') INTO v_teste FROM atak_teste_conexao WHERE company_id = v.company_id;
  RETURN json_build_object(
    'ok', true, 'company_id', v.company_id,
    'host', v.host, 'porta', v.porta, 'banco', v.banco,
    'cod_filial', v.cod_filial, 'usuario', v.usuario, 'senha', v_senha,
    'sync_minuto', v.sync_minuto, 'dominios', COALESCE(v_doms, '[]'::json),
    'teste_pendente', COALESCE(v_teste, false),
    'ingest_secret', public.fn_vault_ler_secret('atak_ingest_secret'));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GARANTIA · checklist que prova o onboarding ANTES de liberar "Gerar instalador".
--            É o que impede a próxima empresa de repetir os ciclos com um elo solto.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_atak_onboarding_checklist(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v RECORD; v_cfg_ok boolean; v_pwd_ok boolean; v_ingest_ok boolean; v_teste_ok boolean; v_dom_pend text[]; v_tudo boolean;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM atak_conexao_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'tudo_ok', false,
      'checks', jsonb_build_object('config_completa', false, 'senha_vault', false, 'ingest_secret',
        EXISTS(SELECT 1 FROM vault.secrets WHERE name='atak_ingest_secret'), 'dominios_ok', false, 'teste_conexao', false),
      'erro', 'sem_config'); END IF;

  v_cfg_ok := (NULLIF(btrim(v.host),'') IS NOT NULL AND NULLIF(btrim(v.banco),'') IS NOT NULL
               AND NULLIF(btrim(v.cod_filial),'') IS NOT NULL AND NULLIF(btrim(v.usuario),'') IS NOT NULL
               AND v.agente_token IS NOT NULL);
  v_pwd_ok := (v.vault_secret_name IS NOT NULL AND EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = v.vault_secret_name));
  v_ingest_ok := EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'atak_ingest_secret');
  SELECT array_agg(fm.dominio ORDER BY fm.ordem) INTO v_dom_pend
    FROM atak_fonte_mapa fm
   WHERE fm.company_id = p_company_id AND fm.ativo
     AND (v.dominios IS NULL OR fm.dominio = ANY(v.dominios))
     AND (NULLIF(btrim(fm.tabela_origem),'') IS NULL OR NULLIF(btrim(fm.chave_fato_sql),'') IS NULL
          OR (fm.coluna_watermark IS NULL AND NOT COALESCE(fm.full_refresh, false)));
  SELECT (status = 'ok') INTO v_teste_ok FROM atak_teste_conexao WHERE company_id = p_company_id;

  v_tudo := (v_cfg_ok AND v_pwd_ok AND v_ingest_ok AND COALESCE(array_length(v_dom_pend,1),0) = 0 AND COALESCE(v_teste_ok,false));
  RETURN jsonb_build_object(
    'ok', true, 'company_id', p_company_id, 'tudo_ok', v_tudo, 'pode_gerar_instalador', v_tudo,
    'checks', jsonb_build_object(
      'config_completa', v_cfg_ok, 'senha_vault', v_pwd_ok, 'ingest_secret', v_ingest_ok,
      'dominios_ok', (COALESCE(array_length(v_dom_pend,1),0) = 0), 'teste_conexao', COALESCE(v_teste_ok,false)),
    'dominios_pendentes', COALESCE(v_dom_pend, ARRAY[]::text[]));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_atak_onboarding_checklist(uuid) TO authenticated;
