-- ATAK/Frioeste · diagnóstico de chaves no próprio ATAK + recarga completa sob demanda (CEO 02/10, lista aprovada).
--
-- Achado (Eng. Chefe + erp_sync_log, 02/10): o domínio contabil_dre PERDE DADOS — o ciclo manda 1.163 linhas e grava
-- 24, porque chave_fato_sql = CONVERT(varchar, Num_lancto) não identifica a LINHA (um lançamento tem várias linhas;
-- uma sobrescreve a outra). financeiro_receber (382), financeiro_pagar (110) e compra_gado (9) também colidem.
-- A prova precisa ser feita DENTRO do ATAK (SQL Server do cliente) — só o agente alcança. Esta migration:
--
-- (1) atak_fonte_mapa ganha chaves_teste (expressões candidatas a chave, só para o diagnóstico) e recarga_completa
--     (uma única carga sem a janela de 7 dias; o próprio config desliga a flag ao entregá-la ao agente).
-- (2) atak_diagnostico: pedido → resposta do agente (contagens por domínio). Só PS (service_role / PS admin).
-- (3) fn_atak_agente_config passa a mandar diagnostico_pendente, chaves_teste e recarga_completa.
-- (4) fn_atak_diagnostico_responder(token, resultado): o agente entrega as contagens (só leitura no ATAK — nunca grava fato).
-- (5) fn_atak_diagnostico_solicitar(company): a equipe PS pede o diagnóstico.
-- (6) Candidatas: contabil_dre, financeiro_receber, financeiro_pagar e compra_gado.
-- A troca da chave do contabil_dre e a recarga vêm na PR seguinte, com a chave que o diagnóstico PROVAR única (RD-38).

ALTER TABLE public.atak_fonte_mapa ADD COLUMN IF NOT EXISTS chaves_teste text[];
ALTER TABLE public.atak_fonte_mapa ADD COLUMN IF NOT EXISTS recarga_completa boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.atak_fonte_mapa.chaves_teste IS 'Expressões SQL candidatas a chave_fato, contadas pelo agente no diagnóstico (só leitura).';
COMMENT ON COLUMN public.atak_fonte_mapa.recarga_completa IS 'true = o agente faz UMA carga sem a janela de dias; fn_atak_agente_config desliga ao entregar.';

CREATE TABLE IF NOT EXISTS public.atak_diagnostico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'solicitado' CHECK (status IN ('solicitado', 'respondido')),
  solicitado_em  timestamptz NOT NULL DEFAULT now(),
  solicitado_por uuid,
  respondido_em  timestamptz,
  versao_agente  text,
  resultado      jsonb
);
CREATE INDEX IF NOT EXISTS atak_diagnostico_company_idx ON public.atak_diagnostico (company_id, solicitado_em DESC);
ALTER TABLE public.atak_diagnostico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atak_diagnostico FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS atak_diagnostico_ps ON public.atak_diagnostico;
CREATE POLICY atak_diagnostico_ps ON public.atak_diagnostico FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.atak_diagnostico TO authenticated;

-- (3) config do agente: + diagnostico_pendente, chaves_teste e recarga_completa (entregue uma vez e desligada)
CREATE OR REPLACE FUNCTION public.fn_atak_agente_config(p_token text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault' AS $$
-- ci-sem-guarda: fn_atak_agente_config — o agente não tem sessão; o token do agente (atak_conexao_config.agente_token) é a guarda, conferido antes de qualquer leitura/escrita
DECLARE v RECORD; v_senha text; v_doms json; v_teste boolean; v_diag boolean; v_recarga text[];
BEGIN
  SELECT * INTO v FROM atak_conexao_config WHERE agente_token = p_token AND agente_token IS NOT NULL;
  IF NOT FOUND THEN RETURN json_build_object('erro', 'token inválido'); END IF;
  IF NOT v.ativo THEN RETURN json_build_object('erro', 'conexão inativa'); END IF;
  v_senha := public.fn_vault_ler_secret(v.vault_secret_name);
  SELECT json_agg(json_build_object(
      'dominio', fm.dominio, 'tabela_origem', fm.tabela_origem,
      'chave_fato_sql', fm.chave_fato_sql, 'coluna_watermark', fm.coluna_watermark,
      'full_refresh', fm.full_refresh,
      'chaves_teste', COALESCE(to_json(fm.chaves_teste), '[]'::json),
      'recarga_completa', fm.recarga_completa
    ) ORDER BY fm.ordem)
    INTO v_doms
    FROM atak_fonte_mapa fm
   WHERE fm.ativo AND fm.company_id = v.company_id AND (v.dominios IS NULL OR fm.dominio = ANY(v.dominios));
  -- recarga completa: entregue UMA vez (o upsert por chave é idempotente; se falhar, a equipe religa a flag)
  WITH u AS (UPDATE atak_fonte_mapa SET recarga_completa = false
               WHERE company_id = v.company_id AND recarga_completa RETURNING dominio)
  SELECT array_agg(dominio) INTO v_recarga FROM u;
  SELECT (status = 'solicitado') INTO v_teste FROM atak_teste_conexao WHERE company_id = v.company_id;
  SELECT EXISTS (SELECT 1 FROM atak_diagnostico d WHERE d.company_id = v.company_id AND d.status = 'solicitado') INTO v_diag;
  RETURN json_build_object(
    'ok', true, 'company_id', v.company_id,
    'host', v.host, 'porta', v.porta, 'banco', v.banco,
    'cod_filial', v.cod_filial, 'usuario', v.usuario, 'senha', v_senha,
    'sync_minuto', v.sync_minuto, 'dominios', COALESCE(v_doms, '[]'::json),
    'teste_pendente', COALESCE(v_teste, false),
    'diagnostico_pendente', COALESCE(v_diag, false),
    'ingest_secret', public.fn_vault_ler_secret('atak_ingest_secret'));
END $$;

-- (4) o agente entrega as contagens (token do agente é a guarda)
CREATE OR REPLACE FUNCTION public.fn_atak_diagnostico_responder(p_token text, p_resultado jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_atak_diagnostico_responder — chamada pelo agente instalado no cliente, sem sessão; o token do agente é conferido antes de gravar
DECLARE v_company uuid; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM atak_conexao_config WHERE agente_token = p_token AND agente_token IS NOT NULL;
  IF v_company IS NULL THEN RETURN json_build_object('ok', false, 'erro', 'token inválido'); END IF;
  IF p_resultado IS NULL OR jsonb_typeof(p_resultado) <> 'object' OR pg_column_size(p_resultado) > 1000000 THEN
    RETURN json_build_object('ok', false, 'erro', 'resultado inválido');
  END IF;
  SELECT id INTO v_id FROM atak_diagnostico WHERE company_id = v_company AND status = 'solicitado' ORDER BY solicitado_em DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN json_build_object('ok', false, 'erro', 'nenhum diagnóstico pedido'); END IF;
  UPDATE atak_diagnostico
     SET status = 'respondido', respondido_em = now(), resultado = p_resultado, versao_agente = p_resultado->>'versao_agente'
   WHERE id = v_id;
  -- pedidos antigos ainda abertos da mesma empresa ficam respondidos pela mesma resposta
  UPDATE atak_diagnostico SET status = 'respondido', respondido_em = now(), resultado = jsonb_build_object('respondido_por', v_id)
   WHERE company_id = v_company AND status = 'solicitado';
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;
-- ci-allow-anon: agente ATAK instalado no cliente chama com a chave pública; exige o token do agente (CEO 02/10)
REVOKE ALL ON FUNCTION public.fn_atak_diagnostico_responder(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_atak_diagnostico_responder(text, jsonb) TO anon, service_role;

-- (5) a equipe PS pede o diagnóstico
CREATE OR REPLACE FUNCTION public.fn_atak_diagnostico_solicitar(p_company_id uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'só a equipe PS pede o diagnóstico do ATAK' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM atak_conexao_config WHERE company_id = p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'empresa sem conexão ATAK');
  END IF;
  INSERT INTO atak_diagnostico (company_id, solicitado_por) VALUES (p_company_id, auth.uid()) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_atak_diagnostico_solicitar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_diagnostico_solicitar(uuid) TO authenticated, service_role;

-- (6) candidatas a chave (só para o diagnóstico — a chave em uso NÃO muda nesta migration)
UPDATE public.atak_fonte_mapa SET chaves_teste = ARRAY[
  'CONCAT(Cod_filial,''|'',Chave_fato,''|'',Num_lancto)',
  'CONCAT(Cod_filial,''|'',Chave_fato,''|'',Num_lancto,''|'',Tipo_partida)',
  'CONCAT(Cod_filial,''|'',Chave_fato,''|'',Num_lancto,''|'',Tipo_partida,''|'',cod_reduz_resultad)',
  'CONCAT(Cod_filial,''|'',Chave_fato,''|'',Num_lancto,''|'',Num_parcela,''|'',Tipo_partida,''|'',cod_reduz_resultad)'
] WHERE dominio = 'contabil_dre';
UPDATE public.atak_fonte_mapa SET chaves_teste = ARRAY[
  'CONCAT([TITULO.CHAVE FATO],''|'',[TITULO.NUM_PARCELA])',
  'CONCAT([TITULO.CHAVE FATO],''|'',CONVERT(varchar(30),[DATA RECEBIMENTO],121),''|'',[VALOR RECEBIMENTO])',
  'CONCAT([TITULO.CHAVE FATO],''|'',[TITULO.NUM_PARCELA],''|'',CONVERT(varchar(30),[DATA RECEBIMENTO],121),''|'',[VALOR RECEBIMENTO])'
] WHERE dominio IN ('financeiro_receber', 'financeiro_pagar');
UPDATE public.atak_fonte_mapa SET chaves_teste = ARRAY[
  'CONCAT(COD_FILIAL,''|'',COD_DOCTO,''|'',NUM_DOCTO,''|'',NUM_ITEM,''|'',NUM_SUBITEM)',
  'CONCAT(CHAVE_FATO,''|'',NUM_ITEM,''|'',NUM_SUBITEM)'
] WHERE dominio = 'compra_gado';
